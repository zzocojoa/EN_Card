import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { harness, harnessThrough, NOW, SAMPLE, type Harness } from './helpers';
import { validPng } from './png-fixture';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import { changeSettings } from '../src/automation/settings';
import { startTrial } from '../src/automation/trial';
import { AiError } from '../src/automation/providers';
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
const bad = { ...good, meaning: false, translation: false, issues: ['뜻과 번역 수정 필요'] };
const card = (expression = 'Candidate') => ({
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
    ai: vi.fn(async (r) =>
      r.stage === 'review' ? ((await run()).revision === 3 ? good : bad) : card(),
    ),
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
async function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    await automationTick(env, { ...runtime });
    now += 60000;
  }
}
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY item_index').all<Run>()).results;
const run = async () => (await rows())[0]!;

it.each(['google', 'groq'] as const)(
  'retries rejected correction with the opposite writer and an independent final review (%s first)',
  async (firstWriter) => {
    await start();
    const original = runtime.ai;
    runtime.ai = vi.fn(async (r) => {
      if (firstWriter === 'groq' && r.stage === 'draft' && r.provider === 'google')
        throw new AiError('unavailable', 503);
      return original(r);
    });
    for (let i = 0; i < 15; i++) {
      await tick();
      if ((await run()).status === 'revise' && (await run()).revision === 2) break;
    }
    const pending = await run();
    expect(pending).toMatchObject({
      status: 'revise',
      revision: 2,
      writer: firstWriter === 'google' ? 'groq' : 'google',
      reviewer: firstWriter,
      review_hash: null,
    });
    expect(runtime.render).not.toHaveBeenCalled();
    await tick();
    expect(vi.mocked(runtime.ai).mock.calls.at(-1)![0]).toMatchObject({
      stage: 'revise',
      provider: pending.writer,
      content: card(),
      review: bad,
    });
    expect(await run()).toMatchObject({
      status: 'review',
      revision: 3,
      review: null,
      review_hash: null,
    });
    await tick(5);
    const result = await run();
    expect(result).toMatchObject({
      id: pending.id,
      due_at: pending.due_at,
      deadline: pending.deadline,
      status: 'scheduled',
      revision: 3,
    });
    expect(result.content_hash).toBe(result.review_hash);
    expect(vi.mocked(runtime.ai).mock.calls.at(-1)![0]).toMatchObject({
      stage: 'review',
      provider: firstWriter,
    });
    expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(1);
    const guide = await readFile(
      new URL('../docs/AI_CARD_AUTOMATION_QUANTITY.md', import.meta.url),
      'utf8',
    );
    const evidenceSql = guide.match(/```sql\r?\n([\s\S]*?)```/)![1]!.trim();
    expect(await env.DB.prepare(evidenceSql).bind(result.day, result.kind).first()).toMatchObject({
      final_write_ok: 1,
      final_review_ok: 1,
      independent_review_matches: 1,
    });
  },
);

it('ends repeated quality rejection after two corrections and one fresh candidate without rendering', async () => {
  await start();
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'review'
      ? bad
      : card((await run()).revision === 4 ? 'Fresh candidate' : 'Candidate'),
  );
  await tick(15);
  expect(await run()).toMatchObject({ status: 'skipped', error: 'review_failed', revision: 4 });
  expect(runtime.ai).toHaveBeenCalledTimes(8);
  expect(runtime.render).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(0);
});

it('uses remaining per-provider retries for the additional correction without resetting the old round', async () => {
  await start();
  const original = runtime.ai;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'revise' && (await run()).revision === 2 && r.provider === 'groq')
      throw new AiError('unavailable', 503);
    return original(r);
  });
  await tick(18);
  expect(await run()).toMatchObject({
    status: 'scheduled',
    revision: 3,
    writer: 'google',
    reviewer: 'groq',
  });
  expect(
    (
      await env.DB.prepare(
        "SELECT revision,provider,count(*) n FROM automation_attempts WHERE stage='revise' GROUP BY revision,provider ORDER BY revision,provider",
      ).all()
    ).results,
  ).toEqual([
    { revision: 1, provider: 'google', n: 1 },
    { revision: 2, provider: 'google', n: 1 },
    { revision: 2, provider: 'groq', n: 3 },
  ]);
});

it.each([0, 1])(
  'requires more than six minutes before starting the additional correction (margin=%s ms)',
  async (extra) => {
    await start();
    await tick(3);
    const pending = await run();
    now = pending.deadline - 360000 - extra;
    await tick();
    expect(await run()).toMatchObject({
      status: extra ? 'revise' : 'skipped',
      revision: 2,
      error: extra ? null : 'review_failed',
    });
    expect(runtime.ai).toHaveBeenCalledTimes(4);
  },
);

async function fillAttemptBudget(target: number) {
  const r = await run();
  let total = Number(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n'));
  // Prior failures/render collisions across both writers, never over three per key.
  for (const revision of [1, 2])
    for (const stage of ['draft', 'review', 'revise'])
      for (const provider of ['google', 'groq']) {
        if (revision === 2 && stage !== 'draft') continue;
        const n = Number(
          await env.DB.prepare(
            'SELECT count(*) n FROM automation_attempts WHERE run_id=? AND stage=? AND revision=? AND provider=?',
          )
            .bind(r.id, stage, revision, provider)
            .first('n'),
        );
        for (let i = n; i < 3 && total < target; i++, total++)
          await env.DB.prepare(
            "INSERT INTO automation_attempts(id,run_id,stage,revision,provider,started_at,outcome) VALUES(?,?,?,?,?,?,'started')",
          )
            .bind(crypto.randomUUID(), r.id, stage, revision, provider, now - 1)
            .run();
      }
  expect(total).toBe(target);
}
it.each([22, 24])(
  'counts failed/unknown history and refuses calls beyond the fixed budget (%s used)',
  async (used) => {
    await start();
    await tick(3);
    await fillAttemptBudget(used);
    await tick(4);
    expect(await run()).toMatchObject({ status: 'skipped', error: 'ai_limit' });
    expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(
      used === 22 ? 23 : 24,
    );
    expect(runtime.render).not.toHaveBeenCalled();
  },
);
it.each([true, false])(
  'uses the last two calls for correction and review, preserving the final quality result (passed=%s)',
  async (passed) => {
    await start();
    await tick(3);
    await fillAttemptBudget(21);
    if (!passed) runtime.ai = vi.fn(async (r) => (r.stage === 'review' ? bad : card()));
    await tick(8);
    expect(await run()).toMatchObject({
      status: passed ? 'scheduled' : 'skipped',
      revision: 3,
      error: passed ? null : 'review_failed',
    });
    expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(24);
    if (!passed) expect(runtime.render).not.toHaveBeenCalled();
  },
);

it.each(['auth', 'quota', 'config'] as const)(
  'pauses on %s during additional correction',
  async (code) => {
    await start();
    await tick(4);
    runtime.ai = vi.fn(async () => {
      throw new AiError(code);
    });
    await tick(2);
    expect(await env.DB.prepare('SELECT enabled FROM automation_settings').first('enabled')).toBe(
      0,
    );
    expect(await run()).toMatchObject({ status: 'cancelled', error: code });
    expect(runtime.ai).toHaveBeenCalledTimes(1);
  },
);
it('rejects a late additional correction after the operator pauses', async () => {
  await start();
  await tick(4);
  let release!: (value: unknown) => void;
  runtime.ai = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = automationTick(env, runtime);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await changeSettings(env, 'pause', 2, null, now);
  release(card('Late correction'));
  await pending;
  expect(await run()).toMatchObject({ status: 'cancelled', revision: 2 });
  expect(runtime.render).not.toHaveBeenCalled();
});

it.each(['daily', 'trial'] as const)(
  'prepares and mock-sends all five %s slots when one needs a second correction',
  async (kind) => {
    if (kind === 'daily') await start(5);
    else {
      await changeSettings(env, 'save', 0, settings, now);
      await startTrial(env, 1, now, { cards: 5 });
    }
    const saved = await env.DB.prepare('SELECT settings FROM automation_settings').first(
      'settings',
    );
    const failures = new Set<string>();
    runtime.ai = vi.fn(async (r) => {
      const active = (await rows()).find((x) => x.claim_owner)!;
      now += 1000;
      const key = `${active.item_index}/${r.stage}`;
      if (active.item_index === 4 && r.stage === 'draft' && !failures.has(key)) {
        failures.add(key);
        throw new AiError('unavailable', 503);
      }
      if (r.stage === 'review') return active.item_index === 2 && active.revision < 3 ? bad : good;
      return card(`Unique slot ${active.item_index}`);
    });
    runtime.render = vi.fn(async () => {
      now += 1000;
      return validPng();
    });
    await automationTick(env, runtime);
    const initial = (await rows())[0]!;
    // Daily runs use the schema's not_before=0; never rewind the synthetic clock.
    for (let at = Math.max(NOW, initial.not_before) + 60000; at < initial.deadline; at += 60000) {
      now = at;
      await automationTick(env, runtime);
      if ((await rows()).every((x) => x.status === 'scheduled')) break;
    }
    const all = await rows();
    expect(all).toHaveLength(5);
    expect(all.every((x) => x.status === 'scheduled')).toBe(true);
    expect(all[1]!.revision).toBe(3);
    expect(await env.DB.prepare('SELECT settings FROM automation_settings').first('settings')).toBe(
      saved,
    );
    const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'local only' }));
    now = initial.due_at;
    for (let i = 0; i < 4; i++) {
      await prepareEngine(h.env, now, 'mock');
      await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
      now += 60000;
    }
    expect(sender).toHaveBeenCalledTimes(5);
  },
  60000,
);

it('0020 preserves old revisions, child references and identity protections while allowing revision3 only', async () => {
  const old = await harnessThrough('0019_automation_verification_trials.sql');
  try {
    const db = old.env.DB;
    for (const revision of [1, 2])
      await db
        .prepare(
          "INSERT INTO automation_runs(id,day,dedupe_key,config_version,settings,due_at,deadline,status,writer,reviewer,revision,card_id,asset_id,public_id,schedule_id,updated_at) VALUES(?,?,?,1,?,1,1,'skipped','google','groq',?,?,?,?,?,1)",
        )
        .bind(
          'old' + revision,
          '2026-09-2' + revision,
          'old' + revision,
          JSON.stringify(settings),
          revision,
          'c' + revision,
          'a' + revision,
          'p' + revision,
          's' + revision,
        )
        .run();
    await db.exec(
      "INSERT INTO automation_attempts VALUES('old-attempt','old2','revise',1,'google',1,'ok',200); INSERT INTO automation_expressions VALUES('reserved','old2');",
    );
    const before = (await db.prepare('SELECT * FROM automation_runs ORDER BY id').all()).results;
    const migration = await readFile(
      new URL('../migrations/0020_automation_quality_retry.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration.replaceAll('\n', ' '));
    expect((await db.prepare('SELECT * FROM automation_runs ORDER BY id').all()).results).toEqual(
      before,
    );
    expect(await db.prepare('SELECT run_id FROM automation_attempts').first('run_id')).toBe('old2');
    expect(await db.prepare('SELECT run_id FROM automation_expressions').first('run_id')).toBe(
      'old2',
    );
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await db.prepare("UPDATE automation_runs SET revision=3 WHERE id='old2'").run();
    await expect(
      db.prepare("UPDATE automation_runs SET revision=4 WHERE id='old2'").run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("UPDATE automation_runs SET deadline=2 WHERE id='old2'").run(),
    ).rejects.toThrow();
    expect(
      await db
        .prepare("SELECT count(*) n FROM sqlite_master WHERE name='automation_revision_0020'")
        .first('n'),
    ).toBe(0);
  } finally {
    await old.mf.dispose();
  }
});
