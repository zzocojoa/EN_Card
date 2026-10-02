import type { Delivery, FeedPayload, SendMode, SendResult } from '../shared/model';
import type { TokenFailure } from './token-errors';

export type Env = {
  DB: D1Database;
  CARD_IMAGES: KVNamespace;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  COST_MODE: string;
  SEND_MODE: SendMode;
  SETUP_TOKEN: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  DELIVERY_SERVICE?: Fetcher;
};
export type Credentials = {
  owner_id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number;
  refresh_expires_at: number;
  version: number;
  status: 'connected' | 'needs_reconnect' | 'disconnected';
  lock_owner: string | null;
  lock_until: number | null;
  refresh_attempts: number;
  refresh_retry_at: number | null;
  refresh_failure: Exclude<TokenFailure, 'conflict'> | null;
  refresh_http_status: number | null;
  refresh_provider_error: string | null;
  refresh_provider_code: string | null;
};
export type Session = { id: string; csrf: string; expires_at: number };
export type Sender = (payload: FeedPayload, token: string) => Promise<SendResult>;
export type TokenGrant = {
  token: string;
  version: number;
  expiresAt?: number;
  refreshed?: boolean;
};
export type DeliveryJob = {
  item: Delivery;
  owner: string;
  payload?: FeedPayload;
  grant: TokenGrant;
};
export type DeliveryReport = { processed: 0 | 1; reuseGrant: boolean; stop: boolean };
export type Transport = (input: string, init: RequestInit) => Promise<Response>;
export type AppError = Error & { status: number; code: string };
export function appError(status: number, code: string, message: string): AppError {
  return Object.assign(new Error(message), { name: code, status, code });
}
