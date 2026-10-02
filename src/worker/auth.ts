import { z } from 'zod';
import { LIMITS } from '../shared/model';
import { studioOrigin, studioSession } from './studio-bridge';
import { isTokenError, tokenError, type TokenError, type TokenFailure } from './token-errors';
import { decrypt, digest, encrypt, randomToken, tokenCipher, type TokenCipher } from './crypto';
import { kakaoOwner, nativeTransport, requestTokens } from './kakao';
import { readJson } from './storage';
import {
  appError,
  type Credentials,
  type Env,
  type Session,
  type TokenGrant,
  type Transport,
} from './types';

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
  const studio = await studioSession(request, env);
  if (studio) return studio;
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
  const setupConfigured: boolean = Boolean(env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 32);
  const validSetupToken: boolean =
    setupConfigured &&
    body.setup_token.length > 0 &&
    (await digest(body.setup_token, env.SESSION_SECRET)) ===
      (await digest(env.SETUP_TOKEN!, env.SESSION_SECRET));
  if (!validSetupToken) {
    if (owner && getCookie(request, 'en_session')) await requireSession(request, env, now);
    else {
      if (!setupConfigured)
        throw appError(503, 'SETUP_CONFIG', 'SETUP_TOKEN에 32자 이상의 난수를 설정하세요.');
      throw appError(403, 'SETUP_TOKEN', '로그인용 SETUP_TOKEN을 확인하세요.');
    }
  }
  return prepareOAuth(env, now);
}
export async function prepareOAuth(env: Env, now: number, studio = false): Promise<Response> {
  if (!env.KAKAO_REST_API_KEY)
    throw appError(503, 'KAKAO_CONFIG', '카카오 REST API 키를 설정하세요.');
  const state: string = randomToken();
  const browser: string = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_state WHERE expires_at<?').bind(now),
    env.DB.prepare(
      "INSERT INTO auth_state(id,kind,browser_hash,expires_at,csrf) VALUES(?,'oauth',?,?,?)",
    ).bind(
      await digest(state, env.SESSION_SECRET),
      await digest(browser, env.SESSION_SECRET),
      now + 10 * 60_000,
      studio ? 'studio-return' : null,
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
  if (studio)
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.toString(),
        'Set-Cookie': cookie('en_oauth', browser, 600, env.APP_ORIGIN),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
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
    "DELETE FROM auth_state WHERE id=? AND kind='oauth' AND browser_hash=? AND expires_at>? RETURNING id,csrf",
  )
    .bind(await digest(state, env.SESSION_SECRET), await digest(browser, env.SESSION_SECRET), now)
    .first<{ id: string; csrf: string | null }>();
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
  if (!tokens.scope?.split(/\s+/).includes('talk_message'))
    throw appError(
      403,
      'KAKAO_SCOPE',
      '카카오톡 메시지 전송 동의가 확인되지 않았습니다. 다시 연결하고 해당 항목을 선택하세요.',
    );
  if (!tokens.refresh_token || !tokens.refresh_token_expires_in)
    throw appError(
      502,
      'REFRESH_MISSING',
      '최초 인증에 리프레시 토큰이 없습니다. 다시 연결하세요.',
    );
  const owner: string = await kakaoOwner(tokens.access_token, transport);
  const saved = await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,?,?,?,?,?,1,'connected') ON CONFLICT(singleton) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,version=credentials.version+1,status='connected',lock_owner=NULL,lock_until=NULL,refresh_attempts=0,refresh_retry_at=NULL,refresh_failure=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL WHERE credentials.owner_id=excluded.owner_id RETURNING owner_id",
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
  const headers: Headers = new Headers({
    Location: consumed.csrf === 'studio-return' ? `${studioOrigin(env)}/cards` : env.APP_ORIGIN,
  });
  headers.append('Set-Cookie', cookie('en_session', session.token, 86400, env.APP_ORIGIN));
  headers.append('Set-Cookie', cookie('en_oauth', '', 0, env.APP_ORIGIN));
  return new Response(null, { status: 303, headers });
}
export async function markReconnect(env: Env, version: number): Promise<boolean> {
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE credentials SET status='needs_reconnect',refresh_failure='invalid',refresh_retry_at=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL,lock_owner=NULL,lock_until=NULL,version=version+1 WHERE singleton=1 AND version=? AND status='connected'",
    ).bind(version),
    reconnectSchedules(env, version + 1),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0;
}
function reconnectSchedules(env: Env, version: number): D1PreparedStatement {
  return env.DB.prepare(
    "UPDATE schedules SET enabled=0,reason='needs_reconnect' WHERE reason IS NOT 'cancelled' AND reason IS NOT 'paused' AND (enabled=1 OR EXISTS(SELECT 1 FROM deliveries d WHERE d.schedule_id=schedules.id AND d.schedule_version=schedules.version AND d.state IN ('pending','claimed','sending','retry_wait','blocked'))) AND EXISTS(SELECT 1 FROM credentials WHERE singleton=1 AND version=? AND status='needs_reconnect')",
  ).bind(version);
}
function tokenChangedError(): TokenError {
  return tokenError(
    'conflict',
    'TOKEN_CHANGED',
    409,
    '인증 상태가 변경되었습니다. 다음 실행에서 새 연결을 확인합니다.',
    null,
    null,
    null,
    null,
  );
}
function storedRefreshError(row: Credentials): TokenError {
  if (row.status === 'needs_reconnect' && row.refresh_failure === 'configuration')
    return storageConfigError();
  const kind: TokenFailure = row.refresh_failure ?? 'invalid';
  const code: string =
    kind === 'transient'
      ? 'TOKEN_TEMPORARY'
      : kind === 'exhausted'
        ? 'TOKEN_RETRY_EXHAUSTED'
        : kind === 'configuration'
          ? 'TOKEN_CONFIGURATION'
          : kind === 'uncertain'
            ? 'TOKEN_UNCERTAIN'
            : 'NEEDS_RECONNECT';
  const message: string =
    kind === 'transient'
      ? '토큰 갱신 일시 오류로 다음 재시도 시각까지 기다립니다.'
      : kind === 'exhausted'
        ? '토큰 갱신 재시도 3회를 소진했습니다. 인증 무효는 아닙니다. 연결 및 설정에서 갱신 재시도를 직접 시작하세요.'
        : kind === 'configuration'
          ? '카카오 앱 설정을 확인한 뒤 연결 및 설정에서 갱신 재시도를 직접 시작하세요.'
          : kind === 'uncertain'
            ? '이전 토큰 갱신 결과를 확인할 수 없습니다. 자동 재시도하지 않으므로 카카오를 다시 연결하세요.'
            : '카카오 연결이 필요합니다. 연결 후 예약을 재개하세요.';
  return tokenError(
    kind,
    code,
    kind === 'invalid' ? 401 : 503,
    message,
    row.refresh_http_status,
    row.refresh_provider_error,
    row.refresh_provider_code,
    row.refresh_retry_at,
  );
}
function storageConfigError(): TokenError {
  return tokenError(
    'configuration',
    'TOKEN_STORAGE_CONFIG',
    503,
    '저장 인증정보를 읽을 수 없어 자동 발송을 중지했습니다. 원래 암호화 설정을 복구한 뒤 설정 복구 확인을 실행하거나 카카오를 다시 연결하세요.',
    null,
    null,
    null,
    null,
  );
}
async function readStoredToken(
  value: string,
  row: Credentials,
  env: Env,
  cipher: TokenCipher,
): Promise<string> {
  try {
    const token = await cipher.decrypt(value);
    if (!token) throw storageConfigError();
    return token;
  } catch {
    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE credentials SET status='needs_reconnect',refresh_failure='configuration',refresh_retry_at=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL,lock_owner=NULL,lock_until=NULL,version=version+1 WHERE singleton=1 AND version=? AND status='connected' AND lock_owner IS NULL AND lock_until IS NULL",
      ).bind(row.version),
      reconnectSchedules(env, row.version + 1),
    ]);
    if (!results[0]?.meta.changes) throw tokenChangedError();
    throw storageConfigError();
  }
}
async function recordRefreshFailure(
  env: Env,
  row: Credentials,
  owner: string,
  error: TokenError,
  now: number,
): Promise<TokenError> {
  const exhausted: boolean =
    error.tokenFailure === 'transient' && row.refresh_attempts >= LIMITS.tokenRefreshAttempts;
  const failure: TokenFailure = exhausted ? 'exhausted' : error.tokenFailure;
  const reconnect: boolean = failure === 'invalid' || failure === 'uncertain';
  const retryAt: number | null =
    failure === 'transient' ? now + 60_000 * 2 ** (row.refresh_attempts - 1) : null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE credentials SET refresh_failure=?,refresh_retry_at=?,refresh_http_status=?,refresh_provider_error=?,refresh_provider_code=?,status=?,version=version+?,lock_owner=NULL,lock_until=NULL WHERE singleton=1 AND version=? AND lock_owner=? AND status='connected'",
    ).bind(
      failure,
      retryAt,
      error.httpStatus,
      error.providerError,
      error.providerCode,
      reconnect ? 'needs_reconnect' : 'connected',
      reconnect ? 1 : 0,
      row.version,
      owner,
    ),
  ];
  if (reconnect) statements.push(reconnectSchedules(env, row.version + 1));
  const results = await env.DB.batch(statements);
  if (!results[0]?.meta.changes) throw tokenChangedError();
  if (failure === 'transient')
    console.warn({
      event: 'token_refresh_retry_scheduled',
      attempt: row.refresh_attempts,
      retry_at: retryAt,
      http_status: error.httpStatus,
      provider_error: error.providerError,
      provider_code: error.providerCode,
    });
  return tokenError(
    failure,
    exhausted ? 'TOKEN_RETRY_EXHAUSTED' : error.code,
    error.status,
    exhausted
      ? `${error.message} 재시도 3회를 소진했습니다. 연결 및 설정에서 갱신 재시도를 직접 시작하세요.`
      : error.message,
    error.httpStatus,
    error.providerError,
    error.providerCode,
    retryAt,
  );
}
export async function accessToken(
  env: Env,
  now: number,
  transport: Transport,
): Promise<TokenGrant> {
  const row: Credentials | null = await env.DB.prepare(
    'SELECT * FROM credentials WHERE singleton=1',
  ).first<Credentials>();
  if (!row || !row.access_token || !row.refresh_token)
    throw tokenError(
      'invalid',
      'NEEDS_RECONNECT',
      401,
      '카카오 연결이 필요합니다. 연결 후 예약을 재개하세요.',
      null,
      null,
      null,
      null,
    );
  if (row.status !== 'connected') throw storedRefreshError(row);
  const cipher: TokenCipher = tokenCipher(env.TOKEN_ENCRYPTION_KEY);
  if (row.expires_at > now + 60_000)
    return {
      token: await readStoredToken(row.access_token, row, env, cipher),
      version: row.version,
      expiresAt: row.expires_at,
    };
  if (row.refresh_expires_at <= now) {
    if (!(await markReconnect(env, row.version))) throw tokenChangedError();
    throw tokenError(
      'invalid',
      'NEEDS_RECONNECT',
      401,
      '리프레시 토큰이 만료되었습니다.',
      null,
      null,
      null,
      null,
    );
  }
  if (row.lock_owner && row.lock_until !== null && row.lock_until < now) {
    throw await recordRefreshFailure(
      env,
      row,
      row.lock_owner,
      tokenError(
        'uncertain',
        'TOKEN_UNCERTAIN',
        502,
        '토큰 갱신 도중 실행이 중단되어 회전 결과가 불명확합니다. 다시 연결하세요.',
        null,
        null,
        null,
        null,
      ),
      now,
    );
  }
  if (
    row.refresh_failure === 'exhausted' ||
    row.refresh_failure === 'configuration' ||
    (row.refresh_retry_at !== null && row.refresh_retry_at > now)
  )
    throw storedRefreshError(row);
  if (row.lock_owner)
    throw tokenError(
      'conflict',
      'TOKEN_BUSY',
      409,
      '다른 실행이 토큰을 갱신하고 있습니다. 다음 실행에서 확인합니다.',
      null,
      null,
      null,
      now + 60_000,
    );
  const refreshToken: string = await readStoredToken(row.refresh_token, row, env, cipher);
  const owner: string = randomToken();
  const locked = await env.DB.prepare(
    "UPDATE credentials SET lock_owner=?,lock_until=?,refresh_attempts=refresh_attempts+1 WHERE singleton=1 AND version=? AND status='connected' AND lock_owner IS NULL AND refresh_attempts=? AND refresh_attempts<? AND (refresh_retry_at IS NULL OR refresh_retry_at<=?) AND (refresh_failure IS NULL OR refresh_failure='transient') RETURNING *",
  )
    .bind(owner, now + 30_000, row.version, row.refresh_attempts, LIMITS.tokenRefreshAttempts, now)
    .first<Credentials>();
  if (!locked)
    throw tokenError(
      'conflict',
      'TOKEN_BUSY',
      409,
      '다른 실행이 토큰을 갱신하고 있습니다. 다음 실행에서 확인합니다.',
      null,
      null,
      null,
      now + 60_000,
    );
  try {
    const tokens = await requestTokens(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      env,
      transport,
    );
    const refresh: string = tokens.refresh_token
      ? await cipher.encrypt(tokens.refresh_token)
      : row.refresh_token;
    if (tokens.refresh_token && !tokens.refresh_token_expires_in)
      throw tokenError(
        'uncertain',
        'REFRESH_EXPIRY',
        502,
        '새 리프레시 토큰의 만료 시간이 누락되었습니다. 다시 연결하세요.',
        200,
        null,
        null,
        null,
      );
    const result = await env.DB.prepare(
      "UPDATE credentials SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,version=version+1,lock_owner=NULL,lock_until=NULL,refresh_attempts=0,refresh_retry_at=NULL,refresh_failure=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL WHERE singleton=1 AND version=? AND lock_owner=? AND status='connected' RETURNING owner_id",
    )
      .bind(
        await cipher.encrypt(tokens.access_token),
        refresh,
        now + tokens.expires_in * 1000,
        tokens.refresh_token
          ? now + tokens.refresh_token_expires_in! * 1000
          : row.refresh_expires_at,
        row.version,
        owner,
      )
      .first<{ owner_id: string }>();
    if (!result) throw tokenChangedError();
    return {
      token: tokens.access_token,
      version: row.version + 1,
      expiresAt: now + tokens.expires_in * 1000,
      refreshed: true,
    };
  } catch (error: unknown) {
    if (isTokenError(error) && error.tokenFailure === 'conflict') throw error;
    const failure: TokenError = isTokenError(error)
      ? error
      : tokenError(
          'uncertain',
          'TOKEN_UNCERTAIN',
          502,
          '토큰 갱신을 확정하지 못했습니다. 카카오를 다시 연결하세요.',
          null,
          null,
          null,
          null,
        );
    throw await recordRefreshFailure(env, locked, owner, failure, now);
  }
}
export async function retryTokenRefresh(
  env: Env,
  version: number,
  now: number = Date.now(),
): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM credentials WHERE singleton=1 AND version=?')
    .bind(version)
    .first<Credentials>();
  if (!row) throw tokenChangedError();
  if (row.status === 'needs_reconnect' && row.refresh_failure === 'configuration') {
    if (row.lock_owner || row.lock_until !== null) throw tokenChangedError();
    try {
      if (!row.access_token || !row.refresh_token) throw storageConfigError();
      if (
        !(await decrypt(row.access_token, env.TOKEN_ENCRYPTION_KEY)) ||
        !(await decrypt(row.refresh_token, env.TOKEN_ENCRYPTION_KEY))
      )
        throw storageConfigError();
    } catch {
      throw storageConfigError();
    }
    const expired: boolean = row.refresh_expires_at <= now;
    const restored = await env.DB.prepare(
      "UPDATE credentials SET status=?,refresh_attempts=0,refresh_retry_at=NULL,refresh_failure=?,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL,version=version+1 WHERE singleton=1 AND version=? AND status='needs_reconnect' AND refresh_failure='configuration' AND lock_owner IS NULL AND lock_until IS NULL RETURNING owner_id",
    )
      .bind(expired ? 'needs_reconnect' : 'connected', expired ? 'invalid' : null, version)
      .first<{ owner_id: string }>();
    if (!restored) throw tokenChangedError();
    if (expired)
      throw tokenError(
        'invalid',
        'TOKEN_RECONNECT_REQUIRED',
        409,
        '암호화 설정은 확인했지만 리프레시 토큰이 만료되었습니다. 카카오를 다시 연결하세요.',
        null,
        null,
        null,
        null,
      );
    return;
  }
  const changed = await env.DB.prepare(
    "UPDATE credentials SET refresh_attempts=0,refresh_retry_at=NULL,refresh_failure=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL,version=version+1 WHERE singleton=1 AND version=? AND status='connected' AND lock_owner IS NULL AND refresh_failure IN ('exhausted','configuration') RETURNING owner_id",
  )
    .bind(version)
    .first<{ owner_id: string }>();
  if (!changed) throw tokenChangedError();
}
export async function disconnect(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE credentials SET access_token=NULL,refresh_token=NULL,status='disconnected',version=version+1,lock_owner=NULL,lock_until=NULL,refresh_attempts=0,refresh_retry_at=NULL,refresh_failure=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL WHERE singleton=1",
    ),
    env.DB.prepare(
      "UPDATE schedules SET enabled=0,reason='disconnected' WHERE reason IS NOT 'cancelled' AND reason IS NOT 'paused' AND (enabled=1 OR EXISTS(SELECT 1 FROM deliveries d WHERE d.schedule_id=schedules.id AND d.schedule_version=schedules.version AND d.state IN ('pending','claimed','sending','retry_wait','blocked')))",
    ),
    env.DB.prepare(
      "UPDATE deliveries SET state='cancelled',cancellation_reason='disconnected',error='자동 발송 연결 해제',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE state IN ('pending','claimed','retry_wait','blocked')",
    ).bind(now),
  ]);
}
export const liveToken = (env: Env, now: number): Promise<TokenGrant> =>
  accessToken(env, now, nativeTransport);
