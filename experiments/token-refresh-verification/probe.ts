import { scheduledToken } from '../../src/worker/durable-token';
import type { Env } from '../../src/worker/types';

export type Probe = { start: number; end: number; version: number; expiresAt: number };
export const EXPIRE_ONCE = `UPDATE credentials SET expires_at=0
  WHERE singleton=1 AND version=? AND expires_at=? AND status='connected'
  AND access_token IS NOT NULL AND refresh_token IS NOT NULL
  AND refresh_expires_at>? AND lock_owner IS NULL AND lock_until IS NULL
  AND refresh_attempts=0 AND refresh_retry_at IS NULL AND refresh_failure IS NULL
  AND NOT EXISTS(SELECT 1 FROM schedules WHERE enabled=1)
  AND NOT EXISTS(SELECT 1 FROM automation_settings WHERE enabled=1)
  AND NOT EXISTS(SELECT 1 FROM automation_runs WHERE status NOT IN ('scheduled','skipped','cancelled'))
  AND NOT EXISTS(SELECT 1 FROM deliveries WHERE state IN ('pending','claimed','sending','retry_wait') OR (state='unknown' AND resolution IS NULL))
  RETURNING version`;

export function inWindow(probe: Probe, now: number): boolean {
  return (
    Object.values(probe).every(Number.isSafeInteger) &&
    probe.version > 0 &&
    probe.expiresAt > probe.end &&
    probe.start <= now &&
    now < probe.end &&
    probe.end - probe.start > 0 &&
    probe.end - probe.start <= 300_000
  );
}

// Maintenance-only entry: no HTTP trigger, token output, AI call or message send.
// A successful CAS consumes this probe even if the process stops before/after RPC.
// Never restore expires_at or retry an ambiguous refresh; normal auth owns recovery.
export async function probeOnce(env: Env, probe: Probe, now: number) {
  if (
    !inWindow(probe, now) ||
    env.COST_MODE !== 'free_only' ||
    env.SEND_MODE !== 'live' ||
    !env.AUTOMATION
  )
    return { outcome: 'skipped' } as const;
  const claimed = await env.DB.prepare(EXPIRE_ONCE)
    .bind(probe.version, probe.expiresAt, now + 60_000)
    .first();
  if (!claimed) return { outcome: 'skipped' } as const;
  try {
    const grant = await scheduledToken(env, Date.now());
    return {
      outcome: grant.refreshed && grant.version === probe.version + 1 ? 'refreshed' : 'changed',
      version: grant.version,
    } as const;
  } catch {
    // The existing credential row records classified failures. Never log the error.
    return { outcome: 'unconfirmed' } as const;
  }
}
