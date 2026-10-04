import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { probeOnce, inWindow, type Probe } from '../experiments/token-refresh-verification/probe';
import { harness, NOW, dueSchedule, type Harness } from './helpers';
import type { Env } from '../src/worker/types';
import production from '../src/worker/index';
import verification from '../experiments/token-refresh-verification/worker';
import { runEngine } from '../src/worker/engine';

let h: Harness;
let env: Env;
const probe: Probe = { start: NOW, end: NOW + 300_000, version: 1, expiresAt: NOW + 3600_000 };
const rpc = vi.fn();
beforeEach(async () => {
  h = await harness();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  rpc.mockReset().mockResolvedValue({
    kind: 'grant',
    grant: { token: 'MUST_NOT_LEAK', version: 2, refreshed: true },
  });
  env = {
    ...h.env,
    SEND_MODE: 'live',
    AUTOMATION: {
      idFromName: (name: string) => name,
      get: () => ({ credentialToken: rpc }),
    } as unknown as NonNullable<Env['AUTOMATION']>,
  };
  await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'fixture','ciphertext','ciphertext',?,?,1,'connected')",
  )
    .bind(probe.expiresAt, NOW + 86400_000)
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.mf.dispose();
});

it('concurrent and repeated ticks consume only one RPC and never return the grant token', async () => {
  const results = await Promise.all([probeOnce(env, probe, NOW), probeOnce(env, probe, NOW)]);
  expect(results).toContainEqual({ outcome: 'refreshed', version: 2 });
  expect(results).toContainEqual({ outcome: 'skipped' });
  expect(JSON.stringify(results)).not.toContain('MUST_NOT_LEAK');
  expect(await probeOnce(env, probe, NOW + 60_000)).toEqual({ outcome: 'skipped' });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM delivery_attempts').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(0);
});
it('ambiguous RPC is never repeated or rolled back', async () => {
  rpc.mockRejectedValue(new Error('secret-provider-response'));
  expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'unconfirmed' });
  expect(await probeOnce(env, probe, NOW + 60_000)).toEqual({ outcome: 'skipped' });
  expect(await env.DB.prepare('SELECT expires_at FROM credentials').first('expires_at')).toBe(0);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it.each([
  'UPDATE credentials SET version=2',
  'UPDATE credentials SET expires_at=expires_at+1',
  "UPDATE credentials SET lock_owner='another',lock_until=9999999999999",
  "UPDATE credentials SET refresh_attempts=1,refresh_failure='transient'",
  "UPDATE credentials SET status='needs_reconnect'",
  'UPDATE credentials SET refresh_expires_at=0',
])('refuses changed or unsafe credentials: %s', async (sql) => {
  await env.DB.prepare(sql).run();
  expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'skipped' });
  expect(rpc).not.toHaveBeenCalled();
});
it('refuses active schedules', async () => {
  await dueSchedule(env, 1, NOW);
  expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'skipped' });
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects unarmed, expired and oversized windows and missing durable binding', async () => {
  expect(inWindow(probe, NOW - 1)).toBe(false);
  expect(inWindow(probe, probe.end)).toBe(false);
  expect(inWindow({ ...probe, end: NOW + 300_001 }, NOW)).toBe(false);
  expect(inWindow({ ...probe, version: NaN }, NOW)).toBe(false);
  const noDurable = { ...env };
  delete noDurable.AUTOMATION;
  expect(await probeOnce(noDurable, probe, NOW)).toEqual({
    outcome: 'skipped',
  });
  expect(await probeOnce({ ...env, SEND_MODE: 'dry_run' }, probe, NOW)).toEqual({
    outcome: 'skipped',
  });
  expect(rpc).not.toHaveBeenCalled();
});

it('refuses enabled automation independently of schedules', async () => {
  await env.DB.exec(
    "INSERT INTO automation_settings(singleton,settings,version,enabled,updated_at) VALUES(1,'{}',1,1,1)",
  );
  expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'skipped' });
  expect(await env.DB.prepare('SELECT expires_at FROM credentials').first('expires_at')).toBe(
    probe.expiresAt,
  );
  expect(rpc).not.toHaveBeenCalled();
});
it('refuses pending automation independently of enabled settings', async () => {
  await env.DB.exec(
    "INSERT INTO automation_runs(id,day,dedupe_key,kind,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at) VALUES('r','2026-09-28','daily:2026-09-28','daily',1,'{}',1,2,'draft','google','groq','c','a','p','s',1)",
  );
  expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'skipped' });
  expect(await env.DB.prepare('SELECT expires_at FROM credentials').first('expires_at')).toBe(
    probe.expiresAt,
  );
  expect(rpc).not.toHaveBeenCalled();
});
it('refuses unfinished deliveries independently of enabled schedules', async () => {
  await dueSchedule(env, 1, NOW);
  await runEngine(env, {
    mode: 'mock',
    clock: () => NOW,
    sender: async () => ({ outcome: 'sent', detail: 'fixture' }),
    token: async () => 'fixture',
  });
  await env.DB.exec('UPDATE schedules SET enabled=0');
  for (const state of ['pending', 'claimed', 'sending', 'retry_wait', 'unknown']) {
    await env.DB.prepare('UPDATE deliveries SET state=?,resolution=NULL').bind(state).run();
    expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'skipped' });
    expect(await env.DB.prepare('SELECT expires_at FROM credentials').first('expires_at')).toBe(
      probe.expiresAt,
    );
  }
  expect(rpc).not.toHaveBeenCalled();
  // A blocked historical item cannot be claimed by the engine. With its schedule
  // disabled, it must remain intact and does not prevent a credential-only probe.
  await env.DB.exec(
    "UPDATE deliveries SET state='blocked'; UPDATE schedules SET reason='needs_reconnect'",
  );
  expect(await probeOnce(env, probe, NOW)).toEqual({ outcome: 'refreshed', version: 2 });
  expect(await env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('blocked');
});
it('wrapper suppresses all normal work in its window for success, skipped and unconfirmed results', async () => {
  const normal = vi.spyOn(production, 'scheduled').mockResolvedValue();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const armed = { ...env, TOKEN_REFRESH_PROBE: JSON.stringify(probe) };
  await verification.scheduled({} as ScheduledController, armed);
  await verification.scheduled({} as ScheduledController, armed);
  expect(log.mock.calls).toEqual([
    [{ event: 'token_refresh_verification', outcome: 'refreshed', version: 2 }],
  ]);
  await env.DB.prepare('UPDATE credentials SET expires_at=?').bind(probe.expiresAt).run();
  rpc.mockRejectedValue(new Error('secret-provider-response'));
  await verification.scheduled({} as ScheduledController, armed);
  expect(log.mock.calls.at(-1)).toEqual([
    { event: 'token_refresh_verification', outcome: 'unconfirmed' },
  ]);
  expect(normal).not.toHaveBeenCalled();
});
it('wrapper resumes normal Cron for absent, malformed, future and expired configuration', async () => {
  const normal = vi.spyOn(production, 'scheduled').mockResolvedValue();
  for (const config of [
    undefined,
    'not-json',
    'null',
    JSON.stringify({ ...probe, start: NOW + 1 }),
    JSON.stringify({ ...probe, start: NOW - 300_000, end: NOW }),
  ]) {
    await verification.scheduled({} as ScheduledController, {
      ...env,
      ...(config === undefined ? {} : { TOKEN_REFRESH_PROBE: config }),
    });
  }
  expect(normal).toHaveBeenCalledTimes(5);
  expect(rpc).not.toHaveBeenCalled();
  expect(verification.fetch).toBe(production.fetch);
});
