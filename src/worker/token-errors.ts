import { appError, type AppError } from './types';

export type TokenFailure =
  'invalid' | 'transient' | 'uncertain' | 'configuration' | 'exhausted' | 'conflict';
export type TokenError = AppError & {
  tokenFailure: TokenFailure;
  httpStatus: number | null;
  providerError: string | null;
  providerCode: string | null;
  retryAt: number | null;
};
export function tokenError(
  kind: TokenFailure,
  code: string,
  status: number,
  message: string,
  httpStatus: number | null,
  providerError: string | null,
  providerCode: string | null,
  retryAt: number | null,
): TokenError {
  return Object.assign(appError(status, code, message), {
    tokenFailure: kind,
    httpStatus,
    providerError,
    providerCode,
    retryAt,
  });
}
export function isTokenError(error: unknown): error is TokenError {
  return error instanceof Error && 'tokenFailure' in error;
}
