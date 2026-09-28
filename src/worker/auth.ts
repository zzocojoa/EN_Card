import { z } from 'zod';
import { decrypt, digest, encrypt, randomToken } from './crypto';
import { kakaoOwner, nativeTransport, requestTokens } from './kakao';
import { readJson } from './storage';
import { appError, type Credentials, type Env, type Session, type Transport } from './types';

export function getCookie(request: Request, name: string): string | null {
  const pair: string | undefined = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}
export function cookie(name: string, value: string, maxAge: number, origin: string): string {
  const secure: string = new URL(origin).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function requireOrigin(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== env.APP_ORIGIN)
    throw appError(403, 'ORIGIN', '허용되지 않은 출처입니다. 앱 주소에서 다시 시도하세요.');
}
export async function createSession(
  env: Env,
  now: number,
): Promise<{ token: string; csrf: string }> {
  const token: string = randomToken();
  const csrf: string = randomToken();
  await env.DB.prepare("INSERT INTO auth_state(id,kind,csrf,expires_at) VALUES(?,'session',?,?)")
    .bind(await digest(token, env.SESSION_SECRET), csrf, now + 24 * 60 * 60_000)
    .run();
  return { token, csrf };
}
export async function requireSession(request: Request, env: Env, now: number): Promise<Session> {
  const token: string | null = getCookie(request, 'en_session');
  if (!token) throw appError(401, 'LOGIN_REQUIRED', '로그인이 필요합니다.');
  const session: Session | null = await env.DB.prepare(
    "SELECT id,csrf,expires_at FROM auth_state WHERE id=? AND kind='session' AND expires_at>?",
  )
    .bind(await digest(token, env.SESSION_SECRET), now)
    .first<Session>();
  if (!session) throw appError(401, 'SESSION_EXPIRED', '세션이 만료되었습니다. 다시 로그인하세요.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    requireOrigin(request, env);
    if (request.headers.get('X-CSRF-Token') !== session.csrf)
      throw appError(403, 'CSRF', '요청 확인 값이 다릅니다. 페이지를 새로 고치세요.');
  }
  return session;
}
export async function beginOAuth(request: Request, env: Env, now: number): Promise<Response> {
  requireOrigin(request, env);
  const body = z
    .object({ setup_token: z.string().max(200) })
    .strict()
    .parse(await readJson(request));
  const owner = await env.DB.prepare('SELECT owner_id FROM credentials WHERE singleton=1').first<{
    owner_id: string;
  }>();
  if (
    !owner &&
    (!env.SETUP_TOKEN ||
      (await digest(body.setup_token, env.SESSION_SECRET)) !==
        (await digest(env.SETUP_TOKEN, env.SESSION_SECRET)))
  )
    throw appError(403, 'SETUP_TOKEN', '최초 운영자 등록용 SETUP_TOKEN을 확인하세요.');
  if (!env.KAKAO_REST_API_KEY)
    throw appError(503, 'KAKAO_CONFIG', '카카오 REST API 키를 설정하세요.');
  const state: string = randomToken();
  const browser: string = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_state WHERE expires_at<?').bind(now),
    env.DB.prepare(
      "INSERT INTO auth_state(id,kind,browser_hash,expires_at) VALUES(?,'oauth',?,?)",
    ).bind(
      await digest(state, env.SESSION_SECRET),
      await digest(browser, env.SESSION_SECRET),
      now + 10 * 60_000,
    ),
  ]);
  const url: URL = new URL('https://kauth.kakao.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: env.KAKAO_REST_API_KEY,
    redirect_uri: `${env.APP_ORIGIN}/auth/callback`,
    response_type: 'code',
    scope: 'talk_message',
    state,
  }).toString();
  return Response.json(
    { url: url.toString() },
    { headers: { 'Set-Cookie': cookie('en_oauth', browser, 600, env.APP_ORIGIN) } },
  );
}
export async function finishOAuth(
  request: Request,
  env: Env,
  now: number,
  transport: Transport,
): Promise<Response> {
  const url: URL = new URL(request.url);
  const state: string | null = url.searchParams.get('state');
  const code: string | null = url.searchParams.get('code');
  const browser: string | null = getCookie(request, 'en_oauth');
  if (!state || !browser || !code)
    throw appError(
      400,
      'OAUTH_CALLBACK',
      '인증 응답이 누락되었거나 취소되었습니다. 다시 로그인하세요.',
    );
  const consumed = await env.DB.prepare(
    "DELETE FROM auth_state WHERE id=? AND kind='oauth' AND browser_hash=? AND expires_at>? RETURNING id",
  )
    .bind(await digest(state, env.SESSION_SECRET), await digest(browser, env.SESSION_SECRET), now)
    .first<{ id: string }>();
  if (!consumed)
    throw appError(
      403,
      'OAUTH_STATE',
      '인증 요청이 만료·재사용되었거나 다른 브라우저에서 시작되었습니다.',
    );
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.APP_ORIGIN}/auth/callback`,
    }),
    env,
    transport,
  );
  if (!tokens.refresh_token || !tokens.refresh_token_expires_in)
    throw appError(
      502,
      'REFRESH_MISSING',
      '최초 인증에 리프레시 토큰이 없습니다. 다시 연결하세요.',
    );
  const owner: string = await kakaoOwner(tokens.access_token, transport);
  const saved = await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,?,?,?,?,?,1,'connected') ON CONFLICT(singleton) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,version=credentials.version+1,status='connected',lock_owner=NULL,lock_until=NULL WHERE credentials.owner_id=excluded.owner_id RETURNING owner_id",
  )
    .bind(
      owner,
      await encrypt(tokens.access_token, env.TOKEN_ENCRYPTION_KEY),
      await encrypt(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY),
      now + tokens.expires_in * 1000,
      now + tokens.refresh_token_expires_in * 1000,
    )
    .first<{ owner_id: string }>();
  if (!saved) throw appError(403, 'NOT_OWNER', '등록된 운영자 계정만 사용할 수 있습니다.');
  const session = await createSession(env, now);
  const headers: Headers = new Headers({ Location: env.APP_ORIGIN });
  headers.append('Set-Cookie', cookie('en_session', session.token, 86400, env.APP_ORIGIN));
  headers.append('Set-Cookie', cookie('en_oauth', '', 0, env.APP_ORIGIN));
  return new Response(null, { status: 303, headers });
}
export async function markReconnect(env: Env): Promise<void> {
  await env.DB.prepare(
    "UPDATE credentials SET status='needs_reconnect',lock_owner=NULL,lock_until=NULL,version=version+1 WHERE singleton=1",
  ).run();
}
export async function accessToken(env: Env, now: number, transport: Transport): Promise<string> {
  const row: Credentials | null = await env.DB.prepare(
    'SELECT * FROM credentials WHERE singleton=1',
  ).first<Credentials>();
  if (!row || row.status !== 'connected' || !row.access_token || !row.refresh_token)
    throw appError(401, 'NEEDS_RECONNECT', '카카오 연결이 필요합니다. 연결 후 예약을 재개하세요.');
  if (row.expires_at > now + 60_000) return decrypt(row.access_token, env.TOKEN_ENCRYPTION_KEY);
  if (row.refresh_expires_at <= now) {
    await markReconnect(env);
    throw appError(401, 'NEEDS_RECONNECT', '리프레시 토큰이 만료되었습니다.');
  }
  const owner: string = randomToken();
  const locked = await env.DB.prepare(
    'UPDATE credentials SET lock_owner=?,lock_until=? WHERE singleton=1 AND version=? AND (lock_until IS NULL OR lock_until<?) RETURNING owner_id',
  )
    .bind(owner, now + 30_000, row.version, now)
    .first<{ owner_id: string }>();
  if (!locked)
    throw appError(
      409,
      'TOKEN_BUSY',
      '다른 실행이 토큰을 갱신하고 있습니다. 다음 실행에서 재시도합니다.',
    );
  try {
    const tokens = await requestTokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: await decrypt(row.refresh_token, env.TOKEN_ENCRYPTION_KEY),
      }),
      env,
      transport,
    );
    const refresh: string = tokens.refresh_token
      ? await encrypt(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY)
      : row.refresh_token;
    if (tokens.refresh_token && !tokens.refresh_token_expires_in)
      throw appError(502, 'REFRESH_EXPIRY', '새 리프레시 토큰의 만료 시간이 누락되었습니다.');
    const result = await env.DB.prepare(
      "UPDATE credentials SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,version=version+1,lock_owner=NULL,lock_until=NULL WHERE singleton=1 AND version=? AND lock_owner=? AND status='connected' RETURNING owner_id",
    )
      .bind(
        await encrypt(tokens.access_token, env.TOKEN_ENCRYPTION_KEY),
        refresh,
        now + tokens.expires_in * 1000,
        tokens.refresh_token
          ? now + tokens.refresh_token_expires_in! * 1000
          : row.refresh_expires_at,
        row.version,
        owner,
      )
      .first<{ owner_id: string }>();
    if (!result)
      throw appError(409, 'TOKEN_CHANGED', '갱신 중 인증 상태가 변경되었습니다. 다시 연결하세요.');
    return tokens.access_token;
  } catch (error: unknown) {
    await env.DB.prepare(
      "UPDATE credentials SET status='needs_reconnect',lock_owner=NULL,lock_until=NULL,version=version+1 WHERE singleton=1 AND lock_owner=?",
    )
      .bind(owner)
      .run();
    throw error;
  }
}
export async function disconnect(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE credentials SET access_token=NULL,refresh_token=NULL,status='disconnected',version=version+1,lock_owner=NULL,lock_until=NULL WHERE singleton=1",
    ),
    env.DB.prepare("UPDATE schedules SET enabled=0,reason='disconnected' WHERE enabled=1"),
    env.DB.prepare(
      "UPDATE deliveries SET state='cancelled',error='자동 발송 연결 해제',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE state IN ('pending','claimed','retry_wait','blocked')",
    ).bind(now),
  ]);
}
export const liveToken = (env: Env, now: number): Promise<string> =>
  accessToken(env, now, nativeTransport);
