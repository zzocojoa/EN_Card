import { appError, type Env } from './types';

// Bind the version twice, or null twice for isolated non-live operations.
// Reconnection and token rotation also change this version: a stale write must
// be retried explicitly instead of restoring authority after a disconnect.
export const connectionGuard =
  "(? IS NULL OR EXISTS(SELECT 1 FROM credentials WHERE singleton=1 AND status='connected' AND version=?))";

export async function requireConnection(env: Pick<Env, 'DB'>): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT version FROM credentials WHERE singleton=1 AND status='connected'",
  ).first<{ version: number }>();
  if (!row)
    throw appError(409, 'NEEDS_RECONNECT', '먼저 카카오를 다시 연결한 뒤 예약을 활성화하세요.');
  return row.version;
}
