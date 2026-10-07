import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { harness, harnessThrough, dueSchedule, NOW, SAMPLE, type Harness } from './helpers';
import { validPng } from './png-fixture';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import { changeSettings, settingsView, runHistory } from '../src/automation/settings';
import { startTrial } from '../src/automation/trial';
import { AiError } from '../src/automation/providers';
import { relayClient } from '../src/automation/relay-client';
import type { AutomationEnv, Run } from '../src/automation/types';
import { automationSettings } from '../src/shared/automation';
import { prepareEngine, runEngine, resolveUnknown } from '../src/worker/engine';

const legacySettings = {
  topic: '일상',
  base_expression: '',
  level: '초급',
  template: 'expression',
  start_date: '2026-09-28',
  end_date: '2026-09-28',
  time: '13:00',
};
const good = {
  natural: true,
  meaning: true,
  grammar: true,
  translation: true,
  level: true,
  comparison: true,
  issues: [],
};
const card = (n: number) => ({
  ...SAMPLE,
  expression: `Test expression ${n}`,
  note_ko: '',
  base_expression: '',
  base_meaning_ko: '',
});
let h: Harness, env: AutomationEnv, now: number, runtime: AutomationRuntime, generated: number;
beforeEach(async () => {
  h = await harness();
  now = NOW;
  generated = 0;
  env = {
    ...h.env,
    SEND_MODE: 'live',
    FONT_ASSETS: h.env.ASSETS,
    AUTOMATION_MODE: 'live',
    AI_FREE_CONFIRMED: 'google_groq_free',
    AI_RELAY_KEY: 'a'.repeat(64),
  };
  runtime = {
    clock: () => now,
    ai: vi.fn(async (r) => (r.stage === 'review' ? good : card(++generated))),
    render: vi.fn(async () => validPng()),
  };
  await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'owner',?,?,1,'connected')",
  )
    .bind(now + 86400000, now + 86400000)
    .run();
});
afterEach(async () => {
  await h.mf.dispose();
});
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY day,item_index').all<Run>())
    .results;
async function start(count: number) {
  await changeSettings(env, 'save', 0, { ...legacySettings, cards_per_day: count }, now);
  await changeSettings(env, 'start', 1, null, now);
}
async function tick() {
  await automationTick(env, runtime);
  now += 60000;
}
async function prepare(count: number) {
  await start(count);
  for (let n = 0; n < count * 5; n++) await tick();
}
const mockSender = () =>
  vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'mock only' }));

it('all five images use one due time and their own sequence number', async () => {
  await prepare(5);
  const items = await rows();
  expect(items).toHaveLength(5);
  expect(items.every((r) => r.status === 'scheduled')).toBe(true);
  expect(vi.mocked(runtime.render).mock.calls.map(([, due, number]) => [due, number])).toEqual(
    items.map((r) => [r.due_at, r.item_index]),
  );
});

it.each([3, 5])(
  'waiting automatic cards do not delay a later manual schedule: %i cards',
  async (count) => {
    const manual = await dueSchedule(h.env, 1, NOW);
    await prepare(count);
    now = (await rows())[0]!.due_at;
    await env.DB.prepare('UPDATE schedules SET next_run_at_utc=? WHERE id=?')
      .bind(now + 60000, manual)
      .run();
    // Materialize all automatic cards to isolate claim fairness from the two-schedule tick limit.
    for (let index = 0; index < count; index += 2) await prepareEngine(h.env, now, 'mock');
    const sender = vi.fn(async () =>
      sender.mock.calls.length === 1
        ? { outcome: 'unknown' as const, detail: 'mock timeout' }
        : { outcome: 'mock_sent' as const, detail: 'mock accepted' },
    );
    const send = () =>
      runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    await send();
    now += 60000;
    await send();
    now += 60000;
    await send();
    expect(
      await env.DB.prepare('SELECT state FROM deliveries WHERE schedule_id=?')
        .bind(manual)
        .first('state'),
    ).toBe('mock_sent');
    expect(sender).toHaveBeenCalledTimes(2);
    expect(
      await env.DB.prepare(
        'SELECT started_at FROM delivery_attempts a JOIN deliveries d ON d.id=a.delivery_id WHERE d.schedule_id=?',
      )
        .bind(manual)
        .first('started_at'),
    ).toBe((await rows())[0]!.due_at + 60000);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='unknown'").first('n'),
    ).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) n FROM delivery_attempts').first('n')).toBe(2);
  },
);

it('defaults old settings to one and rejects invalid quantities without coercion', () => {
  expect(automationSettings.parse(legacySettings).cards_per_day).toBe(1);
  for (const count of [0, 6, 1.5, '3', null, -1])
    expect(automationSettings.safeParse({ ...legacySettings, cards_per_day: count }).success).toBe(
      false,
    );
  for (const count of [1, 3, 5])
    expect(
      automationSettings.parse({ ...legacySettings, cards_per_day: count }).cards_per_day,
    ).toBe(count);
});
it('0016 preserves legacy runs, children, history and protection triggers', async () => {
  const old = await harnessThrough('0015_automation_trial.sql');
  try {
    const db = old.env.DB;
    await db
      .prepare(
        "INSERT INTO automation_runs(id,dedupe_key,day,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at) VALUES('old','2026-09-28','2026-09-28',2,?,1,1,'cancelled','google','groq','c','a','p','s',1)",
      )
      .bind(JSON.stringify(legacySettings))
      .run();
    await db.exec(
      "INSERT INTO automation_attempts VALUES('attempt','old','draft',1,'google',1,'ok',200); INSERT INTO automation_expressions VALUES('expression','old');",
    );
    const before = await db.prepare('SELECT * FROM automation_runs').first();
    const triggers = (
      await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
    ).results;
    await db.exec(
      (await readFile('migrations/0016_automation_quantity.sql', 'utf8')).replaceAll('\n', ' '),
    );
    expect(await db.prepare('SELECT * FROM automation_runs').first()).toEqual({
      ...before,
      item_index: 1,
      item_count: 1,
    });
    expect(await db.prepare('SELECT run_id FROM automation_attempts').first('run_id')).toBe('old');
    expect(await db.prepare('SELECT run_id FROM automation_expressions').first('run_id')).toBe(
      'old',
    );
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect(
      (await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all())
        .results,
    ).toEqual(expect.arrayContaining(triggers));
    await expect(db.prepare('UPDATE automation_runs SET item_count=5').run()).rejects.toThrow(
      'automation_item_immutable',
    );
  } finally {
    await old.mf.dispose();
  }
});
it.each([1, 3, 5])(
  'creates %i distinct reviewed cards and mock-sends each once across repeated ticks',
  async (count) => {
    await prepare(count);
    const runs = await rows();
    expect(runs).toHaveLength(count);
    expect(runs.map((r) => r.item_index)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(runs.every((r) => r.item_count === count && r.status === 'scheduled')).toBe(true);
    expect(new Set(runs.map((r) => r.card_id)).size).toBe(count);
    expect(runtime.ai).toHaveBeenCalledTimes(count * 2);
    expect(runtime.render).toHaveBeenCalledTimes(count);
    expect((await runHistory(env)).map((r) => [r.item_index, r.item_count])).toEqual(
      runs.map((r) => [r.item_index, r.item_count]),
    );
    now = runs[0]!.due_at;
    const sender = mockSender();
    for (let i = 0; i < 5; i++) {
      await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
      now += 60000;
    }
    expect(sender).toHaveBeenCalledTimes(count);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
    ).toBe(count);
    await tick();
    expect((await settingsView(env, now)).enabled).toBe(false);
  },
);
it('rolls back the entire daily allocation if a middle slot fails', async () => {
  await start(5);
  const before = await settingsView(env, now);
  await env.DB.exec(
    "CREATE TRIGGER fail_slot BEFORE INSERT ON automation_runs WHEN NEW.item_index=3 BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  await expect(tick()).rejects.toThrow('injected');
  expect(await rows()).toHaveLength(0);
  expect((await settingsView(env, now)).next_due_at).toBe(before.next_due_at);
  expect(runtime.ai).not.toHaveBeenCalled();
  await env.DB.exec('DROP TRIGGER fail_slot;');
  await tick();
  expect(await rows()).toHaveLength(5);
});
it('concurrent ticks allocate one batch and never start another slot during an in-flight call', async () => {
  await start(5);
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  runtime.ai = vi.fn(async () => {
    entered();
    await waiting;
    return card(1);
  });
  const first = automationTick(env, runtime);
  await started;
  await Promise.all(Array.from({ length: 4 }, () => automationTick(env, runtime)));
  expect(await rows()).toHaveLength(5);
  expect(runtime.ai).toHaveBeenCalledTimes(1);
  release();
  await first;
  expect((await rows()).map((r) => r.status)).toEqual([
    'review',
    'draft',
    'draft',
    'draft',
    'draft',
  ]);
});
it('concurrent initial reads allocate exactly one batch and advance the daily cursor once', async () => {
  await changeSettings(
    env,
    'save',
    0,
    { ...legacySettings, end_date: null, cards_per_day: 5 },
    now,
  );
  await changeSettings(env, 'start', 1, null, now);
  let reads = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const db = env.DB;
  env.DB = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (sql !== 'SELECT * FROM automation_settings WHERE singleton=1 AND enabled=1')
            return statement;
          return new Proxy(statement, {
            get(stmt, method) {
              if (method === 'first')
                return async () => {
                  const row = await stmt.first();
                  if (++reads === 5) release();
                  await barrier;
                  return row;
                };
              const value = Reflect.get(stmt, method);
              return typeof value === 'function' ? value.bind(stmt) : value;
            },
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await Promise.all(Array.from({ length: 5 }, () => automationTick(env, runtime)));
  env.DB = db;
  expect(reads).toBe(5);
  expect((await rows()).map((r) => r.item_index)).toEqual([1, 2, 3, 4, 5]);
  expect((await rows()).slice(1).every((r) => r.status === 'draft')).toBe(true);
  expect(generated).toBe(1);
  expect((await settingsView(env, now)).next_due_at).toBe(NOW + 25 * 3600000);
});
it('saving a larger quantity or a later same-day time never replenishes consumed slots', async () => {
  await start(1);
  await tick();
  const before = (await rows())[0]!;
  await changeSettings(env, 'save', 2, { ...legacySettings, time: '14:00', cards_per_day: 5 }, now);
  await changeSettings(env, 'start', 3, null, now);
  now = NOW + 3600000;
  await tick();
  expect(await rows()).toHaveLength(1);
  expect((await rows())[0]).toMatchObject({ id: before.id, item_count: 1, status: 'cancelled' });
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});
it('keeps a trial at one card without changing the saved five-card daily settings', async () => {
  await changeSettings(env, 'save', 0, { ...legacySettings, cards_per_day: 5 }, now);
  await startTrial(env, 1, now);
  const [trial] = await rows();
  expect(trial).toMatchObject({ kind: 'trial', item_index: 1, item_count: 1 });
  expect(JSON.parse(trial!.settings).cards_per_day).toBe(1);
  expect((await settingsView(env, now)).settings?.cards_per_day).toBe(5);
  await changeSettings(env, 'pause', 2, null, now);
  await expect(startTrial(env, 3, now)).rejects.toMatchObject({ code: 'TRIAL_USED' });
});
it('replaces a duplicate and includes completed siblings in recent expressions', async () => {
  const recent: string[][] = [];
  let drafts = 0;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'review') return good;
    recent.push(r.recent);
    return card(++drafts === 2 ? 1 : drafts);
  });
  await prepare(3);
  await tick();
  expect((await rows()).map((r) => [r.status, r.error])).toEqual([
    ['scheduled', null],
    ['scheduled', null],
    ['scheduled', null],
  ]);
  expect(recent[1]).toContain('Test expression 1');
  expect(recent[2]).toContain('Test expression 1');
  expect(runtime.render).toHaveBeenCalledTimes(3);
});
it('pauses the whole batch on quota exhaustion and cancels already prepared pending schedules', async () => {
  await start(5);
  for (let i = 0; i < 5; i++) await tick();
  runtime.ai = vi.fn(async () => {
    throw new AiError('quota', 429);
  });
  await tick();
  expect((await settingsView(env, now)).reason).toBe('quota');
  expect((await rows()).map((r) => r.status)).toEqual([
    'scheduled',
    'cancelled',
    'cancelled',
    'cancelled',
    'cancelled',
  ]);
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules WHERE enabled=1').first('n')).toBe(
    0,
  );
  await tick();
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});
it('allocates the daily batch at the one-hour preparation boundary, not a millisecond early', async () => {
  now = NOW - 30 * 60000;
  await start(3);
  const due = (await settingsView(env, now)).next_due_at;
  expect(due).toBe(NOW + 3600000);
  now = NOW - 1;
  await automationTick(env, runtime);
  expect(await rows()).toHaveLength(0);
  expect(runtime.ai).not.toHaveBeenCalled();
  expect((await settingsView(env, now)).next_due_at).toBe(due);
  now++;
  await automationTick(env, runtime);
  expect(await rows()).toHaveLength(3);
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});
it.each([-1, 0])(
  'honors the five-minute deadline for a late first tick: offset %i ms',
  async (offset) => {
    await start(3);
    now = NOW + 55 * 60000 + offset;
    await automationTick(env, runtime);
    const runs = await rows();
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.deadline === NOW + 55 * 60000)).toBe(true);
    expect(runtime.ai).toHaveBeenCalledTimes(offset < 0 ? 1 : 0);
    expect(runs.map((run) => run.status)).toEqual(
      offset < 0 ? ['review', 'draft', 'draft'] : ['skipped', 'skipped', 'skipped'],
    );
    expect(runtime.render).not.toHaveBeenCalled();
  },
);
it('expires the remaining slots without creating a catch-up burst', async () => {
  await start(5);
  await tick();
  now = NOW + 55 * 60000;
  await tick();
  expect((await rows()).every((r) => r.status === 'skipped' && r.error === 'expired')).toBe(true);
  expect(runtime.ai).toHaveBeenCalledTimes(1);
  expect(runtime.render).not.toHaveBeenCalled();
});
it('an unknown result for one card blocks automatic sending of the other cards', async () => {
  await prepare(5);
  now = (await rows())[0]!.due_at;
  const sender = vi.fn(async () => ({ outcome: 'unknown' as const, detail: 'mock timeout' }));
  for (let i = 0; i < 3; i++) {
    await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    now += 60000;
  }
  expect(sender).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='unknown'").first('n'),
  ).toBe(1);
});
it('preserves the first success when a later card is unknown, without re-sending either', async () => {
  await prepare(5);
  now = (await rows())[0]!.due_at;
  let calls = 0;
  const sender = vi.fn(async () =>
    ++calls === 1
      ? { outcome: 'mock_sent' as const, detail: 'mock accepted' }
      : { outcome: 'unknown' as const, detail: 'mock timeout' },
  );
  for (let i = 0; i < 4; i++) {
    await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    now += 60000;
  }
  expect(sender).toHaveBeenCalledTimes(2);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='unknown'").first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM delivery_attempts a JOIN deliveries d ON d.id=a.delivery_id WHERE d.state='mock_sent'",
    ).first('n'),
  ).toBe(1);
});
it('keeps the relay request compatible with the old strict one-card settings schema', async () => {
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    expect(body.input.settings).toEqual(legacySettings);
    expect(body.input.settings).not.toHaveProperty('cards_per_day');
    return Response.json({ result: card(1) });
  });
  await relayClient(
    env,
    transport,
  )({
    provider: 'google',
    stage: 'draft',
    settings: automationSettings.parse({ ...legacySettings, cards_per_day: 5 }),
    content: null,
    review: null,
    recent: [],
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('expires deferred siblings after the grace period without resetting the original unknown', async () => {
  await prepare(3);
  now = (await rows())[0]!.due_at;
  const sender = vi.fn(async () => ({ outcome: 'unknown' as const, detail: 'mock timeout' }));
  const send = () =>
    runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  await send();
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='pending'").first('n'),
  ).toBe(1);
  now += 16 * 60000;
  await send();
  expect(sender).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='unknown'").first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='missed'").first('n'),
  ).toBe(2);
  expect(await env.DB.prepare('SELECT count(*) n FROM delivery_attempts').first('n')).toBe(1);
});
it('overlapping sending engines defer siblings without permanently blocking a prepared card', async () => {
  await prepare(5);
  now = (await rows())[0]!.due_at;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sender = vi.fn(async () => {
    if (sender.mock.calls.length === 1) {
      entered();
      await waiting;
    }
    return { outcome: 'mock_sent' as const, detail: 'mock accepted' };
  });
  const send = () =>
    runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  const first = send();
  await started;
  try {
    await send();
  } finally {
    release();
  }
  await first;
  for (let i = 0; i < 4; i++) {
    now += 60000;
    await send();
  }
  expect(sender).toHaveBeenCalledTimes(5);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
  ).toBe(5);
  expect(await env.DB.prepare('SELECT count(*) n FROM delivery_attempts').first('n')).toBe(5);
  expect(
    await env.DB.prepare('SELECT sends FROM usage_counters WHERE day=?')
      .bind('2026-09-28')
      .first('sends'),
  ).toBe(5);
});
it('a send barrier appearing after claim safely defers that card without spending a send attempt', async () => {
  await prepare(3);
  now = (await rows())[0]!.due_at;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deferredSender = mockSender();
  const first = runEngine(h.env, {
    mode: 'mock',
    clock: () => now,
    sender: deferredSender,
    token: async () => {
      entered();
      await waiting;
      return 'mock';
    },
  });
  await started;
  try {
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => now,
      token: async () => 'mock',
      sender: async () => ({ outcome: 'unknown', detail: 'mock timeout' }),
    });
  } finally {
    release();
  }
  await first;
  expect(deferredSender).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='retry_wait'").first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='unknown'").first('n'),
  ).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM delivery_attempts').first('n')).toBe(1);
  expect(
    await env.DB.prepare('SELECT sends FROM usage_counters WHERE day=?')
      .bind('2026-09-28')
      .first('sends'),
  ).toBe(1);
});
it.each(['confirm_sent', 'abandon', 'retry'] as const)(
  'resumes waiting siblings after explicit unknown resolution: %s',
  async (action) => {
    await prepare(3);
    now = (await rows())[0]!.due_at;
    const sender = vi.fn(async () =>
      sender.mock.calls.length === 1
        ? { outcome: 'unknown' as const, detail: 'mock timeout' }
        : { outcome: 'mock_sent' as const, detail: 'mock accepted' },
    );
    const send = () =>
      runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    await send();
    const unknown = (await env.DB.prepare(
      "SELECT id FROM deliveries WHERE state='unknown'",
    ).first<string>('id'))!;
    expect(sender).toHaveBeenCalledTimes(1);
    await resolveUnknown(unknown, action, h.env, now);
    for (let i = 0; i < 3; i++) {
      now += 60000;
      await send();
    }
    expect(sender).toHaveBeenCalledTimes(action === 'retry' ? 4 : 3);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='blocked'").first('n'),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
    ).toBe(action === 'abandon' ? 2 : 3);
    expect(
      await env.DB.prepare('SELECT count(*) n FROM manual_decisions WHERE delivery_id=?')
        .bind(unknown)
        .first('n'),
    ).toBe(1);
    await tick();
    expect((await settingsView(env, now)).enabled).toBe(false);
  },
);
