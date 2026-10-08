import { digest, randomToken } from './crypto';
import { appError, type Env, type Session } from './types';

// A server credential, never a frontend value, URL parameter or forwarded cookie.
export async function studioSession(request: Request, env: Env): Promise<Session | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  if (!env.STUDIO_BRIDGE_SECRET || env.STUDIO_BRIDGE_SECRET.length < 32 || !env.STUDIO_OWNER_ID)
    throw appError(403, 'STUDIO_FORBIDDEN', '허용되지 않은 작업실 연결입니다.');
  const expected = `Bearer ${env.STUDIO_BRIDGE_SECRET}`;
  if (
    authorization.length > 512 ||
    (await digest(authorization, env.SESSION_SECRET)) !==
      (await digest(expected, env.SESSION_SECRET)) ||
    request.headers.get('X-Studio-User') !== env.STUDIO_OWNER_ID ||
    request.headers.get('Origin') !== env.APP_ORIGIN
  )
    throw appError(403, 'STUDIO_FORBIDDEN', '허용되지 않은 작업실 연결입니다.');
  return { id: 'studio-bridge', csrf: 'studio-bridge', expires_at: Date.now() + 60_000 };
}

export function studioOrigin(env: Env): string {
  try {
    const url = new URL(env.STUDIO_ORIGIN ?? '');
    if (url.protocol !== 'https:' || url.origin !== env.STUDIO_ORIGIN) throw new Error();
    return url.origin;
  } catch {
    throw appError(503, 'STUDIO_CONFIG', '하루단어 연결 설정을 확인해 주세요.');
  }
}

// A one-use permission to start OAuth, not a browser login. Kakao owner checking
// still happens in the existing callback before a session can be created.
export async function issueStudioOAuth(env: Env, now: number): Promise<Response> {
  studioOrigin(env);
  const token = randomToken();
  await env.DB.prepare(
    "INSERT INTO auth_state(id,kind,browser_hash,csrf,expires_at,credential_version) VALUES(?,'oauth',NULL,'studio-ticket',?,(SELECT version FROM credentials WHERE singleton=1))",
  )
    .bind(await digest(`studio-ticket:${token}`, env.SESSION_SECRET), now + 60_000)
    .run();
  return Response.json({ url: `${env.APP_ORIGIN}/auth/studio?ticket=${token}` });
}

export async function consumeStudioOAuth(
  request: Request,
  env: Env,
  now: number,
): Promise<{ credentialVersion: number | null }> {
  studioOrigin(env);
  if (!env.STUDIO_BRIDGE_SECRET || !env.STUDIO_OWNER_ID)
    throw appError(403, 'STUDIO_FORBIDDEN', '하루단어 연결을 확인해 주세요.');
  const token = new URL(request.url).searchParams.get('ticket') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw appError(
      403,
      'STUDIO_TICKET',
      '연결 요청이 만료되었습니다. 하루단어에서 다시 연결하세요.',
    );
  const row = await env.DB.prepare(
    "DELETE FROM auth_state WHERE id=? AND kind='oauth' AND csrf='studio-ticket' AND expires_at>? AND credential_version IS (SELECT version FROM credentials WHERE singleton=1) RETURNING credential_version",
  )
    .bind(await digest(`studio-ticket:${token}`, env.SESSION_SECRET), now)
    .first<{ credential_version: number | null }>();
  if (!row)
    throw appError(
      403,
      'STUDIO_TICKET',
      '연결 요청이 만료되었습니다. 하루단어에서 다시 연결하세요.',
    );
  return { credentialVersion: row.credential_version };
}
