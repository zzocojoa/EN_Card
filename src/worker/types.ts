import type { FeedPayload, SendMode, SendResult } from '../shared/model';

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
};
export type Session = { id: string; csrf: string; expires_at: number };
export type Sender = (payload: FeedPayload, token: string) => Promise<SendResult>;
export type TokenGrant = { token: string; version: number };
export type Transport = (input: string, init: RequestInit) => Promise<Response>;
export type AppError = Error & { status: number; code: string };
export function appError(status: number, code: string, message: string): AppError {
  return Object.assign(new Error(message), { name: code, status, code });
}
