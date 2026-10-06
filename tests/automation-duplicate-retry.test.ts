import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { harness, harnessThrough, NOW, SAMPLE, type Harness } from './helpers';
import { validPng } from './png-fixture';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import { changeSettings } from '../src/automation/settings';
import { startTrial } from '../src/automation/trial';
import { AiError, type AiRequest } from '../src/automation/providers';
import type { AutomationEnv, Run } from '../src/automation/types';
import { prepareEngine, runEngine } from '../src/worker/engine';

const settings = {
  topic: '일상',
  base_expression: '',
  level: '초급',
  template: 'expression',
  start_date: '2026-09-28',
  end_date: '2026-09-28',
  time: '13:00',
  cards_per_day: 1,
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
const card = (expression = 'Fresh candidate') => ({
  ...SAMPLE,
  expression,
  note_ko: '',
  base_expression: '',
  base_meaning_ko: '',
});
let h: Harness, env: AutomationEnv, now: number, runtime: AutomationRuntime;
beforeEach(async () => {
  h = await harness();
  now = NOW;
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
    ai: vi.fn(async (r) => (r.stage === 'review' ? good : card())),
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
async function start(count = 1) {
  await changeSettings(env, 'save', 0, { ...settings, cards_per_day: count }, now);
  await changeSettings(env, 'start', 1, null, now);
}
async function tick() {
  await automationTick(env, runtime);
  now += 60000;
}
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY item_index').all<Run>()).results;
async function existing(expression: string, created = now) {
  await env.DB.prepare(
    "INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,'draft',?)",
  )
    .bind(crypto.randomUUID(), JSON.stringify(card(expression)), created)
    .run();
}

it('replaces a duplicate in the same slot and independently reviews the new candidate', async () => {
  await existing('Already used');
  await start();
  let drafts = 0;
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'review' ? good : card(++drafts === 1 ? 'Already used' : 'New unique phrase'),
  );
  await tick();
  const first = (await rows())[0]!;
  expect(first).toMatchObject({ status: 'draft', error: 'duplicate_retry' });
  expect(runtime.render).not.toHaveBeenCalled();
  for (let i = 0; i < 5; i++) await tick();
  const result = (await rows())[0]!;
  expect(result).toMatchObject({
    id: first.id,
    item_index: 1,
    item_count: 1,
    status: 'scheduled',
    error: null,
  });
  expect(JSON.parse(result.content!).expression).toBe('New unique phrase');
  expect(runtime.ai).toHaveBeenCalledTimes(3);
  expect(vi.mocked(runtime.ai).mock.calls[2]![0]).toMatchObject({
    stage: 'review',
    provider: 'groq',
    content: { expression: 'New unique phrase' },
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(3);
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(1);
});

it('prioritizes rejected expressions outside the latest 50 cards within the relay limit', async () => {
  await existing('Old repeated phrase', now - 100000);
  for (let i = 0; i < 50; i++) await existing(`Recent ${i}`, now + i);
  await start();
  let drafts = 0;
  const inputs: AiRequest[] = [];
  runtime.ai = vi.fn(async (r) => {
    inputs.push(r);
    return card(++drafts === 1 ? 'Old repeated phrase' : 'Different phrase');
  });
  await tick();
  await tick();
  expect(inputs[0]!.recent).not.toContain('Old repeated phrase');
  expect(inputs[1]!.recent).toContain('Old repeated phrase');
  expect(inputs[1]!.recent.length).toBeLessThanOrEqual(50);
  expect(inputs[1]!.content).toBeNull();
  expect((await rows())[0]!.status).toBe('review');
});

it('persists the duplicate budget across restarts and stops after three rejected candidates', async () => {
  await existing('Always duplicate');
  await start();
  runtime.ai = vi.fn(async () => card('Always duplicate'));
  for (let i = 0; i < 8; i++) {
    // Fresh runtime objects cannot reset durable counters or attempt history.
    await automationTick(env, { ...runtime });
    now += 60000;
  }
  const result = (await rows())[0]!;
  expect(result).toMatchObject({ status: 'skipped', error: 'duplicate_limit' });
  expect(
    JSON.parse((result as Run & { rejected_expressions: string }).rejected_expressions),
  ).toHaveLength(3);
  expect(runtime.ai).toHaveBeenCalledTimes(3);
  expect(runtime.render).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(3);
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(0);
});

it('preserves revision feedback when a correction repeats another existing expression', async () => {
  await existing('Duplicate correction');
  await start();
  let revisions = 0,
    reviews = 0;
  const inputs: AiRequest[] = [];
  runtime.ai = vi.fn(async (r) => {
    inputs.push(r);
    if (r.stage === 'review')
      return ++reviews === 1 ? { ...good, translation: false, issues: ['번역 수정'] } : good;
    if (r.stage === 'revise')
      return card(++revisions === 1 ? 'Duplicate correction' : 'Unique correction');
    return card('Original candidate');
  });
  for (let i = 0; i < 8; i++) await tick();
  expect((await rows())[0]).toMatchObject({ status: 'scheduled', revision: 2 });
  const retry = inputs.filter((r) => r.stage === 'revise')[1]!;
  expect(retry.content).toMatchObject({ expression: 'Original candidate' });
  expect(retry.review).toMatchObject({ translation: false });
  expect(retry.recent).toContain('Duplicate correction');
  expect(inputs.filter((r) => r.stage === 'review').at(-1)!.content).toMatchObject({
    expression: 'Unique correction',
  });
});

it('regenerates and re-reviews a render-time duplicate without creating an extra asset', async () => {
  await start();
  let drafts = 0;
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'review' ? good : card(++drafts === 1 ? 'Racing phrase' : 'Replacement phrase'),
  );
  await tick();
  await tick();
  await existing('Racing phrase');
  await tick();
  expect((await rows())[0]).toMatchObject({
    status: 'draft',
    error: 'duplicate_retry',
    content: null,
    review_hash: null,
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM assets').first('n')).toBe(0);
  for (let i = 0; i < 5; i++) await tick();
  expect((await rows())[0]).toMatchObject({ status: 'scheduled', render_attempts: 2 });
  expect(await env.DB.prepare('SELECT count(*) n FROM assets').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_expressions').first('n')).toBe(1);
  expect(runtime.ai).toHaveBeenCalledTimes(4);
});

it('cancellation while a duplicate response is pending cannot restart the card', async () => {
  await existing('Duplicate pending');
  await start();
  let release!: (value: unknown) => void;
  runtime.ai = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = tick();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await changeSettings(env, 'pause', 2, null, now);
  release(card('Duplicate pending'));
  await pending;
  const result = (await rows())[0]!;
  expect(result.status).toBe('cancelled');
  expect(
    JSON.parse((result as Run & { rejected_expressions: string }).rejected_expressions),
  ).toEqual([]);
  await tick();
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});

it('a late duplicate cannot overwrite a newer candidate after same-version claim takeover', async () => {
  await existing('Late duplicate');
  await start();
  let release!: (value: unknown) => void;
  runtime.ai = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = automationTick(env, runtime);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  now = (await rows())[0]!.claim_until! + 1;
  runtime.ai = vi.fn(async () => card('New owner candidate'));
  await automationTick(env, runtime);
  const newer = (await rows())[0]!;
  expect(newer.status).toBe('review');
  release(card('Late duplicate'));
  await pending;
  expect((await rows())[0]).toEqual(newer);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(2);
});

it('a render collision cannot reset the two-correction allowance', async () => {
  await start();
  let reviews = 0,
    drafts = 0,
    corrections = 0;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'review')
      return ++reviews === 2 ? good : { ...good, translation: false, issues: ['번역 수정'] };
    if (r.stage === 'revise')
      return card(++corrections === 1 ? 'Corrected candidate' : 'Second corrected candidate');
    return card(++drafts === 1 ? 'Original candidate' : 'Replacement candidate');
  });
  for (let i = 0; i < 4; i++) await tick();
  expect((await rows())[0]).toMatchObject({ status: 'render', revision: 2 });
  await existing('Corrected candidate');
  for (let i = 0; i < 4; i++) await tick();
  now = (await rows())[0]!.deadline - 360000;
  await tick();
  expect((await rows())[0]).toMatchObject({
    status: 'skipped',
    revision: 3,
    error: 'review_failed',
  });
  expect(vi.mocked(runtime.ai).mock.calls.filter(([r]) => r.stage === 'revise')).toHaveLength(2);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(8);
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(0);
});

it('duplicate retries do not reset provider attempts before fallback', async () => {
  await existing('Fallback duplicate');
  await start();
  let google = 0;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'review') return good;
    if (r.provider === 'groq') return card('Fallback unique');
    if (++google === 2) return card('Fallback duplicate');
    throw new AiError('unavailable', 503);
  });
  for (let i = 0; i < 12; i++) await tick();
  expect((await rows())[0]).toMatchObject({
    status: 'scheduled',
    writer: 'groq',
    reviewer: 'google',
  });
  expect(google).toBe(3);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM automation_attempts WHERE stage='draft'").first(
      'n',
    ),
  ).toBe(4);
});

it('duplicate retries respect both the preparation deadline and quota failure', async () => {
  await existing('Duplicate then quota');
  await start();
  runtime.ai = vi.fn(async () => card('Duplicate then quota'));
  await tick();
  runtime.ai = vi.fn(async () => {
    throw new AiError('quota', 429);
  });
  await tick();
  expect(await env.DB.prepare('SELECT reason FROM automation_settings').first('reason')).toBe(
    'quota',
  );
  expect((await rows())[0]!.status).toBe('cancelled');
  expect(runtime.render).not.toHaveBeenCalled();
});

it('an expired duplicate retry cannot make another AI call', async () => {
  await existing('Duplicate at deadline');
  await start();
  runtime.ai = vi.fn(async () => card('Duplicate at deadline'));
  await tick();
  now = (await rows())[0]!.deadline;
  await tick();
  expect((await rows())[0]).toMatchObject({ status: 'skipped', error: 'expired' });
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});

it('keeps five unique slots and mock deliveries after replacing a sibling duplicate', async () => {
  await start(5);
  let drafts = 0;
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'review' ? good : card(`Batch expression ${++drafts === 2 ? 1 : drafts}`),
  );
  for (let i = 0; i < 30; i++) await tick();
  const result = await rows();
  expect(result).toHaveLength(5);
  expect(result.every((r) => r.status === 'scheduled')).toBe(true);
  expect(new Set(result.map((r) => JSON.parse(r.content!).expression)).size).toBe(5);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(11);
  now = result[0]!.due_at;
  const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'mock only' }));
  for (let i = 0; i < 5; i++) {
    await prepareEngine(h.env, now, 'mock');
    await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
    now += 60000;
  }
  expect(sender).toHaveBeenCalledTimes(5);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
  ).toBe(5);
});

it('finishes a five-card trial after two duplicate drafts per slot with fixed Cron and render time', async () => {
  await existing('Existing trial expression');
  await changeSettings(env, 'save', 0, settings, now);
  await startTrial(env, 1, now, { cards: 5 });
  const trial = (await rows())[0]!;
  let drafts = 0;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'review') return good;
    drafts++;
    return card(drafts % 3 ? 'Existing trial expression' : `Trial replacement ${drafts / 3}`);
  });
  runtime.render = vi.fn(async () => {
    now += 1000;
    return validPng();
  });
  for (let at = trial.not_before; at <= trial.deadline; at += 60000) {
    now = at;
    await automationTick(env, runtime);
  }
  expect((await rows()).map((r) => r.status)).toEqual(Array(5).fill('scheduled'));
  expect(runtime.ai).toHaveBeenCalledTimes(20);
  expect(runtime.render).toHaveBeenCalledTimes(5);
});

it('0018 adds bounded rejection history without changing old runs or attempt references', async () => {
  const old = await harnessThrough('0017_automation_trial_quantity.sql');
  try {
    const db = old.env.DB;
    await db
      .prepare(
        "INSERT INTO automation_runs(id,day,dedupe_key,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at) VALUES('old','2026-09-28','old',1,?,1,1,'skipped','google','groq','c','a','p','s',1)",
      )
      .bind(JSON.stringify(settings))
      .run();
    await db.exec(
      "INSERT INTO automation_attempts VALUES('attempt','old','draft',1,'google',1,'ok',200); INSERT INTO automation_expressions VALUES('reserved','old');",
    );
    const before = await db
      .prepare('SELECT * FROM automation_runs')
      .first<Record<string, unknown>>();
    const sql = await readFile(
      new URL('../migrations/0018_automation_duplicate_retry.sql', import.meta.url),
      'utf8',
    );
    await db.exec(sql.replaceAll('\n', ' '));
    const after = await db
      .prepare('SELECT * FROM automation_runs')
      .first<Record<string, unknown>>();
    const { rejected_expressions, ...preserved } = after!;
    expect(preserved).toEqual(before);
    expect(rejected_expressions).toBe('[]');
    expect(await db.prepare('SELECT run_id FROM automation_attempts').first('run_id')).toBe('old');
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await expect(
      db
        .prepare("UPDATE automation_runs SET rejected_expressions=? WHERE id='old'")
        .bind(JSON.stringify(['a', 'b', 'c', 'd']))
        .run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("UPDATE automation_runs SET rejected_expressions='{}' WHERE id='old'").run(),
    ).rejects.toThrow();
  } finally {
    await old.mf.dispose();
  }
});
