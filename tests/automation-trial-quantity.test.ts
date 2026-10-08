import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  legacyAutomationHarness as harness,
  harnessThrough,
  NOW,
  SAMPLE,
  type Harness,
} from './helpers';
import { validPng } from './png-fixture';
import { registerVerificationTrial, startTrial } from '../src/automation/trial';
import { changeSettings, settingsView } from '../src/automation/settings';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import type { AutomationEnv, Run } from '../src/automation/types';
import { prepareEngine, runEngine } from '../src/worker/engine';

const settings = {
  topic: '일상',
  base_expression: '',
  level: '초급',
  template: 'expression',
  start_date: '2026-09-28',
  end_date: null,
  time: '13:00',
  cards_per_day: 5,
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
    ai: vi.fn(async (r) =>
      r.stage === 'review'
        ? good
        : {
            ...SAMPLE,
            expression: `New trial ${++generated}`,
            note_ko: '',
            base_expression: '',
            base_meaning_ko: '',
          },
    ),
    render: vi.fn(async () => validPng()),
  };
  await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'owner',?,?,1,'connected')",
  )
    .bind(NOW + 86400000, NOW + 86400000)
    .run();
  await changeSettings(env, 'save', 0, settings, now);
});
afterEach(async () => {
  await h.mf.dispose();
});
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY kind,item_index').all<Run>())
    .results;

it('five new trial cards reach separate approved images and mock sends once, preserving saved settings', async () => {
  const before = await env.DB.prepare('SELECT settings FROM automation_settings').first('settings');
  const due = NOW + 70 * 60000;
  await startTrial(env, 1, now, { cards: 5, due_at: due });
  expect((await rows()).map((r) => [r.kind, r.item_index, r.item_count, r.due_at])).toEqual(
    Array.from({ length: 5 }, (_, i) => ['trial', i + 1, 5, due]),
  );
  expect(await env.DB.prepare('SELECT settings FROM automation_settings').first('settings')).toBe(
    before,
  );
  now = due - 60 * 60000 - 1;
  await automationTick(env, runtime);
  expect(runtime.ai).not.toHaveBeenCalled();
  const start = now + 1;
  runtime.render = vi.fn(async () => {
    now += 1000;
    return validPng();
  });
  for (let n = 0; n < 30; n++) {
    now = start + n * 60000;
    await automationTick(env, runtime);
  }
  expect(
    (await rows()).every((r) => r.status === 'scheduled' && r.review_hash === r.content_hash),
  ).toBe(true);
  expect(runtime.render).toHaveBeenCalledTimes(5);
  expect(runtime.ai).toHaveBeenCalledTimes(10);
  now = due;
  const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'test only' }));
  for (let n = 0; n < 5; n++) {
    await prepareEngine(h.env, now, 'mock');
    await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    now += 60000;
  }
  expect(sender).toHaveBeenCalledTimes(5);
  await automationTick(env, runtime);
  expect((await settingsView(env, now)).enabled).toBe(false);
  expect(await env.DB.prepare('SELECT settings FROM automation_settings').first('settings')).toBe(
    before,
  );
});
it('concurrent five-card registration and later replay consume exactly one trial batch', async () => {
  const result = await Promise.allSettled(
    Array.from({ length: 3 }, () => startTrial(env, 1, now, { cards: 5 })),
  );
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await rows()).toHaveLength(5);
  await changeSettings(env, 'pause', 2, null, now);
  await expect(startTrial(env, 3, now, { cards: 5 })).rejects.toMatchObject({ code: 'TRIAL_USED' });
  expect((await rows()).every((r) => r.status === 'cancelled')).toBe(true);
});
it('a middle-slot failure rolls back every slot and activation', async () => {
  await env.DB.exec(
    "CREATE TRIGGER injected_trial BEFORE INSERT ON automation_runs WHEN NEW.kind='trial' AND NEW.item_index=3 BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  await expect(startTrial(env, 1, now, { cards: 5 })).rejects.toThrow();
  expect(await rows()).toHaveLength(0);
  expect(await settingsView(env, now)).toMatchObject({
    version: 1,
    enabled: false,
    trial_used_today: false,
  });
});
it('a consumed daily slot remains immutable and unchanged beside five trial slots', async () => {
  await changeSettings(env, 'save', 1, { ...settings, cards_per_day: 1 }, now);
  await changeSettings(env, 'start', 2, null, now);
  await automationTick(env, runtime);
  await changeSettings(env, 'pause', 3, null, now);
  const daily = (await rows())[0];
  await startTrial(env, 4, now, { cards: 5 });
  expect((await rows()).filter((r) => r.kind === 'trial')).toHaveLength(5);
  expect((await rows()).find((r) => r.kind === 'daily')).toEqual(daily);
  await expect(
    env.DB.prepare('UPDATE automation_runs SET item_count=5 WHERE id=?').bind(daily!.id).run(),
  ).rejects.toThrow();
});
it.each([0, 6, 2.5, '5', null])(
  'rejects invalid trial quantity %s before writing',
  async (cards) => {
    await expect(startTrial(env, 1, now, { cards })).rejects.toThrow();
    expect(await rows()).toHaveLength(0);
  },
);
it('validates lead time, minute precision and the actual Korean day before any allocation', async () => {
  await expect(
    startTrial(env, 1, now, { cards: 5, due_at: NOW + 59 * 60000 }),
  ).rejects.toMatchObject({ code: 'TRIAL_TIME' });
  await expect(
    startTrial(env, 1, now, { cards: 5, due_at: NOW + 60 * 60000 + 1 }),
  ).rejects.toMatchObject({ code: 'TRIAL_TIME' });
  await expect(
    startTrial(env, 1, now, { cards: 5, due_at: Date.parse('2026-09-29T00:00:00+09:00') }),
  ).rejects.toMatchObject({ code: 'TRIAL_DATE' });
  await expect(
    startTrial(env, 1, Date.parse('2026-09-28T22:59:00.001+09:00'), { cards: 5 }),
  ).rejects.toMatchObject({ code: 'TRIAL_DATE' });
  expect(await rows()).toHaveLength(0);
});
it.each([
  [1, 25, 10],
  [2, 21, 16],
  [3, 29, 24],
  [4, 37, 32],
  [5, 60, 55],
])('registers %i trial cards with the expected preparation window', async (cards, lead, usable) => {
  await startTrial(env, 1, now, { cards });
  const registered = await rows();
  expect(registered).toHaveLength(cards);
  for (const run of registered) {
    expect(run.due_at).toBe(NOW + lead * 60000);
    expect(run.deadline).toBe(run.due_at - 5 * 60000);
    expect(run.deadline - run.not_before).toBe(usable * 60000);
  }
});
it('accepts the last same-day five-card slot at exactly sixty minutes', async () => {
  now = Date.parse('2026-09-28T22:59:00+09:00');
  await startTrial(env, 1, now, { cards: 5 });
  expect((await rows()).every((r) => r.due_at === Date.parse('2026-09-28T23:59:00+09:00'))).toBe(
    true,
  );
});
it('an explicitly authorized second trial prepares five new cards without changing prior history', async () => {
  await startTrial(env, 1, now, { cards: 5 });
  await changeSettings(env, 'pause', 2, null, now);
  const previous = await rows();
  const saved = await env.DB.prepare('SELECT settings FROM automation_settings').first('settings');
  await registerVerificationTrial(env.DB, 3, now, crypto.randomUUID());
  const added = (await rows()).filter((r) => r.config_version === 4);
  expect(added).toHaveLength(5);
  expect(added.every((r) => r.day === '2026-09-28' && r.due_at === NOW + 60 * 60000)).toBe(true);
  expect(added.every((r) => r.deadline - r.not_before === 55 * 60000)).toBe(true);
  for (let minute = 0; minute < 55; minute++) {
    now = NOW + minute * 60000;
    await automationTick(env, runtime);
  }
  expect(
    (await rows()).filter((r) => r.config_version === 4).every((r) => r.status === 'scheduled'),
  ).toBe(true);
  expect((await rows()).filter((r) => r.config_version !== 4)).toEqual(previous);
  expect(await env.DB.prepare('SELECT settings FROM automation_settings').first('settings')).toBe(
    saved,
  );
  expect(await settingsView(env, now)).toMatchObject({ trial_used_today: true, next_due_at: null });
  now = NOW + 60 * 60000;
  const sender = vi.fn(async () => ({
    outcome: 'mock_sent' as const,
    detail: 'verification mock',
  }));
  for (let tick = 0; tick < 5; tick++) {
    await prepareEngine(h.env, now, 'mock');
    await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    now += 60000;
  }
  expect(sender).toHaveBeenCalledTimes(5);
  expect((await rows()).filter((r) => r.config_version !== 4)).toEqual(previous);
}, 60000);
it('verification authorization is consumed once even after settings version changes', async () => {
  const authorization = crypto.randomUUID();
  await registerVerificationTrial(env.DB, 1, now, authorization);
  await changeSettings(env, 'pause', 2, null, now);
  await expect(registerVerificationTrial(env.DB, 3, now, authorization)).rejects.toMatchObject({
    code: 'TRIAL_USED',
  });
  await expect(startTrial(env, 3, now, { cards: 5 })).rejects.toMatchObject({ code: 'TRIAL_USED' });
  expect(await rows()).toHaveLength(5);
});
it('concurrent distinct verification authorizations cannot activate two batches', async () => {
  const result = await Promise.allSettled([
    registerVerificationTrial(env.DB, 1, now, crypto.randomUUID()),
    registerVerificationTrial(env.DB, 1, now, crypto.randomUUID()),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await rows()).toHaveLength(5);
});
it('verification rejects invalid identities, short preparation and public API override fields', async () => {
  await expect(
    registerVerificationTrial(env.DB, 1, now, 'verification:override'),
  ).rejects.toMatchObject({ code: 'VERIFICATION_ID' });
  await expect(
    registerVerificationTrial(env.DB, 1, now, crypto.randomUUID(), now + 59 * 60000),
  ).rejects.toMatchObject({ code: 'TRIAL_TIME' });
  await expect(
    startTrial(env, 1, now, { cards: 5, authorizationId: crypto.randomUUID() }),
  ).rejects.toThrow();
  expect(await rows()).toHaveLength(0);
});
it('verification keeps the paused, connected and idle guards and rolls back a middle-slot failure', async () => {
  await changeSettings(env, 'start', 1, null, now);
  await expect(
    registerVerificationTrial(env.DB, 2, now, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: 'AUTOMATION_ACTIVE' });
  await changeSettings(env, 'pause', 2, null, now);
  await env.DB.prepare("UPDATE credentials SET status='needs_reconnect'").run();
  await expect(
    registerVerificationTrial(env.DB, 3, now, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: 'TRIAL_UNAVAILABLE' });
  expect(await rows()).toHaveLength(0);
  await env.DB.prepare("UPDATE credentials SET status='connected'").run();
  await env.DB.exec(
    "CREATE TRIGGER fail_verification BEFORE INSERT ON automation_runs WHEN NEW.item_index=3 BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  await expect(registerVerificationTrial(env.DB, 3, now, crypto.randomUUID())).rejects.toThrow();
  expect(await rows()).toHaveLength(0);
  expect(await settingsView(env, now)).toMatchObject({ version: 3, enabled: false });
});
it('0019 changes indexes only and preserves the existing normal trial uniqueness', async () => {
  const old = await harnessThrough('0018_automation_duplicate_retry.sql');
  try {
    const legacy = { ...env, DB: old.env.DB, CARD_IMAGES: old.env.CARD_IMAGES };
    await legacy.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'owner',?,?,1,'connected')",
    )
      .bind(NOW + 86400000, NOW + 86400000)
      .run();
    await changeSettings(legacy, 'save', 0, settings, now);
    await startTrial(legacy, 1, now, { cards: 5 });
    const before = (await legacy.DB.prepare('SELECT * FROM automation_runs ORDER BY id').all())
      .results;
    await legacy.DB.exec(
      (await readFile('migrations/0019_automation_verification_trials.sql', 'utf8')).replaceAll(
        '\n',
        ' ',
      ),
    );
    expect(
      (await legacy.DB.prepare('SELECT * FROM automation_runs ORDER BY id').all()).results,
    ).toEqual(before);
    await expect(
      legacy.DB.prepare(
        `INSERT INTO automation_runs(id,dedupe_key,day,kind,item_index,item_count,config_version,settings,due_at,not_before,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at)
      SELECT 'illegal-normal','trial:second-normal',day,kind,item_index,item_count,config_version,settings,due_at,not_before,deadline,status,writer,reviewer,'other-card','other-asset','other-public','other-schedule',updated_at FROM automation_runs WHERE item_index=1`,
      ).run(),
    ).rejects.toThrow();
    expect((await legacy.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {
    await old.mf.dispose();
  }
});
it('0017 preserves existing five-card daily rows, single trial, attempts and expression references', async () => {
  const old = await harnessThrough('0016_automation_quantity.sql');
  try {
    const legacy = { ...env, DB: old.env.DB, CARD_IMAGES: old.env.CARD_IMAGES };
    await legacy.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'owner',?,?,1,'connected')",
    )
      .bind(NOW + 86400000, NOW + 86400000)
      .run();
    await changeSettings(legacy, 'save', 0, settings, now);
    await changeSettings(legacy, 'start', 1, null, now);
    await automationTick(legacy, runtime);
    await changeSettings(legacy, 'pause', 2, null, now);
    await startTrial(legacy, 3, now);
    const daily = await legacy.DB.prepare(
      "SELECT id FROM automation_runs WHERE kind='daily' AND item_index=1",
    ).first<{ id: string }>();
    await legacy.DB.prepare('INSERT INTO automation_expressions VALUES(?,?)')
      .bind('migration marker', daily!.id)
      .run();
    const tables = [
      'automation_runs',
      'automation_attempts',
      'automation_expressions',
      'automation_settings',
    ];
    const before = await Promise.all(
      tables.map((t) => legacy.DB.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()),
    );
    await legacy.DB.exec(
      (await readFile('migrations/0017_automation_trial_quantity.sql', 'utf8')).replaceAll(
        '\n',
        ' ',
      ),
    );
    const after = await Promise.all(
      tables.map((t) => legacy.DB.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()),
    );
    expect(after.map((r) => r.results)).toEqual(before.map((r) => r.results));
    expect((await legacy.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await expect(
      legacy.DB.prepare(
        "UPDATE automation_runs SET not_before=not_before+1 WHERE kind='trial'",
      ).run(),
    ).rejects.toThrow();
  } finally {
    await old.mf.dispose();
  }
});
