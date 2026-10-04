import { liveToken } from './auth';
import { tokenError } from './token-errors';
import type { Env, TokenGrant } from './types';
import type { TokenReply } from '../shared/token-rpc';

export async function scheduledToken(env: Env, now: number): Promise<TokenGrant> {
  // Compatibility for installations without the optional automation product.
  if (!env.AUTOMATION) return liveToken(env, now);
  let reply: TokenReply;
  try {
    const stub = env.AUTOMATION.get(env.AUTOMATION.idFromName('credentials'));
    reply = await stub.credentialToken({
      TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
      ...(env.KAKAO_REST_API_KEY ? { KAKAO_REST_API_KEY: env.KAKAO_REST_API_KEY } : {}),
      ...(env.KAKAO_CLIENT_SECRET ? { KAKAO_CLIENT_SECRET: env.KAKAO_CLIENT_SECRET } : {}),
    });
  } catch {
    // The remote refresh may have completed. Never retry here or fall back locally.
    reply = { kind: 'unavailable' };
  }
  if (reply?.kind === 'grant') return reply.grant;
  if (reply?.kind === 'failure') {
    const e = reply.failure;
    throw tokenError(
      e.tokenFailure,
      e.code,
      e.status,
      e.message,
      e.httpStatus,
      e.providerError,
      e.providerCode,
      e.retryAt,
    );
  }
  throw tokenError(
    'conflict',
    'TOKEN_BUSY',
    503,
    '인증 처리 결과를 확인하지 못했습니다. 다음 실행에서 저장된 상태를 확인합니다.',
    null,
    null,
    null,
    now + 60_000,
  );
}
