import { z } from 'zod';
import { accessToken } from '../worker/auth';
import { nativeTransport } from '../worker/kakao';
import { isTokenError } from '../worker/token-errors';
import type { TokenReply, TokenSecrets } from '../shared/token-rpc';
import type { AutomationEnv } from './types';
import type { Transport } from '../worker/types';

const secretsSchema = z
  .object({
    TOKEN_ENCRYPTION_KEY: z.string().max(4096),
    KAKAO_REST_API_KEY: z.string().max(4096).optional(),
    KAKAO_CLIENT_SECRET: z.string().max(4096).optional(),
  })
  .strict();

export async function credentialToken(
  env: AutomationEnv,
  input: TokenSecrets,
  now: number,
  transport: Transport = nativeTransport,
): Promise<TokenReply> {
  // AI may be off while existing manual schedules still need Kakao credentials.
  if (env.COST_MODE !== 'free_only' || env.SEND_MODE !== 'live') return { kind: 'unavailable' };
  const parsed = secretsSchema.safeParse(input);
  if (!parsed.success) return { kind: 'unavailable' };
  try {
    return {
      kind: 'grant',
      grant: await accessToken(
        {
          DB: env.DB,
          TOKEN_ENCRYPTION_KEY: parsed.data.TOKEN_ENCRYPTION_KEY,
          ...(parsed.data.KAKAO_REST_API_KEY !== undefined
            ? { KAKAO_REST_API_KEY: parsed.data.KAKAO_REST_API_KEY }
            : {}),
          ...(parsed.data.KAKAO_CLIENT_SECRET !== undefined
            ? { KAKAO_CLIENT_SECRET: parsed.data.KAKAO_CLIENT_SECRET }
            : {}),
        },
        now,
        transport,
      ),
    };
  } catch (error) {
    if (!isTokenError(error)) return { kind: 'unavailable' };
    // RPC exceptions do not preserve custom properties. Transfer only the existing
    // sanitized failure fields, then reconstruct TokenError on the calling Worker.
    return {
      kind: 'failure',
      failure: {
        tokenFailure: error.tokenFailure,
        code: error.code,
        status: error.status,
        message: error.message,
        httpStatus: error.httpStatus,
        providerError: error.providerError,
        providerCode: error.providerCode,
        retryAt: error.retryAt,
      },
    };
  }
}
