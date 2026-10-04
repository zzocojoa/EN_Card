import type { TokenGrant, TokenEnv } from '../worker/types';
import type { TokenError } from '../worker/token-errors';

// Private binding only. Supplied per call, never persisted in DO storage or fields.
export type TokenSecrets = Omit<TokenEnv, 'DB'>;
export type TokenReply =
  | { kind: 'grant'; grant: TokenGrant }
  | {
      kind: 'failure';
      failure: Pick<
        TokenError,
        | 'tokenFailure'
        | 'code'
        | 'status'
        | 'message'
        | 'httpStatus'
        | 'providerError'
        | 'providerCode'
        | 'retryAt'
      >;
    }
  | { kind: 'unavailable' };
