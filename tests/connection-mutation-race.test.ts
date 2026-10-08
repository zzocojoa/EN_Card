import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { disconnect, markReconnect } from '../src/worker/auth';
import { prepareEngine, runEngine } from '../src/worker/engine';
import { decideRecovery } from '../src/worker/pause-recovery';
import { resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import type { ScheduleInput } from '../src/shared/model';
import type { Env } from '../src/worker/types';
import { harness, NOW, readyCard, type Harness } from './helpers';

let h: Harness;
let env: Env;
beforeEach(async () => {
  h = await harness();
  env = { ...h.env, SEND_MODE: 'live' };
  await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'race-owner',?,?,1,'connected')",
  )
    .bind(NOW + 3600000, NOW + 86400000)
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.mf.dispose();
});

type Operation = 'create' | 'edit' | 'resume' | 'recover';
async function prepared(operation: Operation): Promise<() => Promise<unknown>> {
  const asset = await readyCard(env, NOW - 300000);
  const input: ScheduleInput = {
    name: '연결 해제 경합',
    kind: 'daily',
    date: '2026-09-28',
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: 1,
    asset_ids: [asset.assetId],
  };
  if (operation === 'create') return () => saveSchedule(input, null, null, env, NOW);
  const { id } = await saveSchedule(input, null, null, env, NOW);
  if (operation === 'edit')
    return () => saveSchedule({ ...input, time: '12:10' }, id, { version: 1, cursor: 0 }, env, NOW);
  if (operation === 'recover') {
    await prepareEngine(env, NOW + 300000, 'live');
    await stopSchedule(id, 1, 'paused', env, NOW + 300000);
    const deliveryId = await env.DB.prepare('SELECT id FROM deliveries WHERE schedule_id=?')
      .bind(id)
      .first<string>('id');
    return () =>
      decideRecovery(
        id,
        {
          version: 1,
          recover_ids: [deliveryId!],
          exclude_ids: [],
          date: '2026-09-28',
          time: '12:15',
          warning_accepted: true,
        },
        env,
        NOW + 300000,
      );
  }
  await stopSchedule(id, 1, 'paused', env, NOW);
  return () => resumeSchedule(id, 1, env, NOW);
}

function beforeNextBatch(action: () => Promise<void>): void {
  const original = env.DB;
  let pending = true;
  env = {
    ...env,
    DB: new Proxy(original, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            if (pending) {
              pending = false;
              await action();
            }
            return target.batch(statements);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
}

it('a credential rotation rejects a stale create but a fresh explicit request succeeds', async () => {
  const create = await prepared('create');
  const original = env.DB;
  beforeNextBatch(async () => {
    await original.prepare('UPDATE credentials SET version=version+1 WHERE singleton=1').run();
  });
  await expect(create()).rejects.toMatchObject({ status: 409, code: 'SCHEDULE_CHANGED' });
  expect(await original.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(0);
  expect(await original.prepare('SELECT count(*) AS n FROM schedule_items').first('n')).toBe(0);
  await create();
  expect(
    await original.prepare('SELECT count(*) AS n FROM schedules WHERE enabled=1').first('n'),
  ).toBe(1);
  expect(await original.prepare('SELECT count(*) AS n FROM schedule_items').first('n')).toBe(1);
});

it('outstanding delivery resume cannot undo a renewed reconnect requirement', async () => {
  await (
    await prepared('create')
  )();
  const id = (await env.DB.prepare('SELECT id FROM schedules').first<string>('id'))!;
  await prepareEngine(env, NOW + 300000, 'live');
  await markReconnect(env, 1, NOW + 300000);
  await env.DB.prepare(
    "UPDATE credentials SET status='connected',version=version+1 WHERE singleton=1",
  ).run();
  const originalEnv = env;
  beforeNextBatch(async () => {
    await markReconnect(originalEnv, 3, NOW + 300001);
  });
  await expect(resumeSchedule(id, 1, env, NOW + 300000)).rejects.toMatchObject({
    status: 409,
    code: 'SCHEDULE_CHANGED',
  });
  expect(
    await env.DB.prepare('SELECT enabled,reason,version FROM schedules WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ enabled: 0, reason: 'needs_reconnect', version: 1 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first('n')).toBe(0);
  await env.DB.prepare(
    "UPDATE credentials SET status='connected',version=version+1 WHERE singleton=1",
  ).run();
  await resumeSchedule(id, 1, env, NOW + 300000);
  const sender = vi.fn(async () => ({ outcome: 'sent' as const, detail: 'synthetic' }));
  await runEngine(env, {
    mode: 'live',
    clock: () => NOW + 300000,
    token: async () => ({ token: 'synthetic', version: 5 }),
    sender,
  });
  expect(sender).toHaveBeenCalledTimes(1);
});

it('excluding a paused card remains available after disconnect without creating a send', async () => {
  await prepared('recover');
  const row = (await env.DB.prepare('SELECT id,schedule_id FROM deliveries').first<{
    id: string;
    schedule_id: string;
  }>())!;
  await disconnect(env, NOW + 300001);
  const result = await decideRecovery(
    row.schedule_id,
    {
      version: 1,
      recover_ids: [],
      exclude_ids: [row.id],
      date: null,
      time: null,
      warning_accepted: true,
    },
    env,
    NOW + 300002,
  );
  expect(result).toEqual({ schedule_ids: [], recovered: 0, excluded: 1 });
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM schedules WHERE enabled=1').first('n'),
  ).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first('n')).toBe(0);
});

it.each<Operation>(['create', 'edit', 'resume', 'recover'])(
  '%s succeeds with an unchanged connected credential',
  async (operation) => {
    const mutate = await prepared(operation);
    await mutate();
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM schedules WHERE enabled=1').first('n'),
    ).toBe(1);
  },
);

for (const reconnect of [false, true]) {
  it.each<Operation>(['create', 'edit', 'resume', 'recover'])(
    `%s cannot authorize a future send after disconnect${reconnect ? ' and reconnect' : ''} during its write`,
    async (operation) => {
      const mutate = await prepared(operation);
      const originalEnv = env;
      let fenced = false;
      env = {
        ...env,
        DB: new Proxy(env.DB, {
          get(target, key) {
            if (key === 'batch')
              return async (statements: D1PreparedStatement[]) => {
                // Interleave the real disconnect immediately before the real atomic
                // write. No authorization or SQL result is replaced by a mock.
                if (!fenced) {
                  fenced = true;
                  await disconnect(originalEnv, NOW + 300001);
                  if (reconnect)
                    await originalEnv.DB.prepare(
                      "UPDATE credentials SET status='connected',version=version+1 WHERE singleton=1",
                    ).run();
                }
                return target.batch(statements);
              };
            const value: unknown = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
      };
      const result = await Promise.allSettled([mutate()]);
      expect(fenced).toBe(true);
      const active = await env.DB.prepare(
        'SELECT count(*) AS n FROM schedules WHERE enabled=1',
      ).first('n');
      const recovered = await env.DB.prepare(
        "SELECT count(*) AS n FROM pause_recoveries WHERE decision='reschedule'",
      ).first('n');
      if (!reconnect)
        await env.DB.prepare(
          "UPDATE credentials SET status='connected',version=version+1 WHERE singleton=1",
        ).run();
      const sender = vi.fn(async () => ({ outcome: 'sent' as const, detail: 'synthetic' }));
      await runEngine(env, {
        mode: 'live',
        clock: () => NOW + 900000,
        token: async () => ({ token: 'synthetic', version: 3 }),
        sender,
      });
      expect(sender).not.toHaveBeenCalled();
      expect(result[0]?.status).toBe('rejected');
      expect(active).toBe(0);
      expect(recovered).toBe(0);
      expect(await env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first('n')).toBe(
        0,
      );
    },
  );
}
