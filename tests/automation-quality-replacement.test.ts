import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { harness, harnessThrough, NOW, SAMPLE, type Harness } from './helpers';
import { validPng } from './png-fixture';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import { changeSettings, runHistory } from '../src/automation/settings';
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
const bad = { ...good, comparison: false, issues: ['비교 표현을 바꾸세요'] };
const card = (expression: string) => ({
  ...SAMPLE,
  expression,
  note_ko: '',
  base_expression: '',
  base_meaning_ko: '',
});
let h: Harness, env: AutomationEnv, now: number, runtime: AutomationRuntime;
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY item_index').all<Run>()).results;
const run = async () => (await rows())[0]!;
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
      r.stage === 'review'
        ? (await run()).revision === 4
          ? good
          : bad
        : card((await run()).revision === 4 ? 'Fresh candidate' : 'Failed candidate'),
    ),
    render: vi.fn(async () => validPng()),
  };
  await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'owner',?,?,1,'connected')",
  )
    .bind(now + 86400000, now + 86400000)
    .run();
  await changeSettings(env, 'save', 0, settings, now);
});
afterEach(async () => {
  await h.mf.dispose();
});
async function start() {
  await changeSettings(env, 'start', 1, null, now);
}
async function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    await automationTick(env, { ...runtime });
    now += 60000;
  }
}

it('preserves the failed review/history and replaces once in the same slot with a fresh independent review', async () => {
  await start();
  await tick(5);
  const original = await run();
  expect(original).toMatchObject({ status: 'review', revision: 3 });
  const attempts = (await env.DB.prepare('SELECT * FROM automation_attempts ORDER BY id').all())
    .results;
  await tick();
  const replacement = await run();
  expect(replacement).toMatchObject({
    id: original.id,
    card_id: original.card_id,
    asset_id: original.asset_id,
    schedule_id: original.schedule_id,
    due_at: original.due_at,
    deadline: original.deadline,
    item_index: 1,
    item_count: 1,
    status: 'draft',
    revision: 4,
    error: 'quality_replacement',
    content: null,
    content_hash: null,
    review: null,
    review_hash: null,
    writer: 'google',
    reviewer: 'groq',
  });
  expect(JSON.parse(replacement.replacement_origin!)).toEqual({
    content: JSON.parse(original.content!),
    content_hash: original.content_hash,
    review: bad,
    writer: original.writer,
    reviewer: original.reviewer,
    revision: 3,
    rejected_at: now - 60000,
  });
  for (const attempt of attempts)
    expect(
      await env.DB.prepare('SELECT * FROM automation_attempts WHERE id=?').bind(attempt.id).first(),
    ).toEqual(attempt);
  await tick();
  expect(vi.mocked(runtime.ai).mock.calls.at(-1)![0]).toMatchObject({
    stage: 'draft',
    provider: 'google',
    content: null,
    review: null,
    recent: ['Failed candidate'],
  });
  expect(runtime.render).not.toHaveBeenCalled();
  await tick(5);
  const final = await run();
  expect(final).toMatchObject({
    status: 'scheduled',
    revision: 4,
    replacement_origin: replacement.replacement_origin,
  });
  expect(final.content_hash).toBe(final.review_hash);
  expect(vi.mocked(runtime.ai).mock.calls.at(-1)![0]).toMatchObject({
    stage: 'review',
    provider: 'groq',
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_runs').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(8);
  expect((await runHistory(env))[0]).not.toHaveProperty('replacement_origin');
});

it('terminates if the one replacement fails quality, without resetting corrections or looping', async () => {
  await start();
  const original = runtime.ai;
  runtime.ai = vi.fn(async (r) => (r.stage === 'review' ? bad : original(r)));
  await tick(18);
  expect(await run()).toMatchObject({ status: 'skipped', revision: 4, error: 'review_failed' });
  expect(runtime.ai).toHaveBeenCalledTimes(8);
  expect(vi.mocked(runtime.ai).mock.calls.filter(([r]) => r.stage === 'revise')).toHaveLength(2);
  expect(runtime.render).not.toHaveBeenCalled();
});

it.each([0, 1])('requires more than six minutes to replace (margin %s ms)', async (extra) => {
  await start();
  await tick(5);
  now = (await run()).deadline - 360000 - extra;
  await tick();
  expect(await run()).toMatchObject({
    status: extra ? 'draft' : 'skipped',
    revision: extra ? 4 : 3,
    error: extra ? 'quality_replacement' : 'review_failed',
  });
});

it.each([21, 22, 24])(
  'preserves the whole-run call budget when %s calls were already reserved',
  async (used) => {
    await start();
    await tick(5);
    const current = await run();
    let count = 5;
    for (const revision of [1, 2, 3])
      for (const stage of ['draft', 'review', 'revise'])
        for (const provider of ['google', 'groq']) {
          if (revision === 3 && stage === 'review') continue;
          const existing = Number(
            await env.DB.prepare(
              'SELECT count(*) n FROM automation_attempts WHERE run_id=? AND stage=? AND revision=? AND provider=?',
            )
              .bind(current.id, stage, revision, provider)
              .first('n'),
          );
          for (let i = existing; i < 3 && count < used; i++, count++)
            await env.DB.prepare(
              "INSERT INTO automation_attempts VALUES(?,?,?,?,?,?,'started',NULL)",
            )
              .bind(crypto.randomUUID(), current.id, stage, revision, provider, now)
              .run();
        }
    expect(count).toBe(used);
    await tick(8);
    expect(await run()).toMatchObject({
      status: used === 21 ? 'scheduled' : 'skipped',
      revision: used === 21 ? 4 : 3,
      error: used === 21 ? null : used === 24 ? 'ai_limit' : 'review_failed',
    });
    expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(
      used === 22 ? 23 : 24,
    );
  },
);

it('rejects the failed expression even when absent from the library, then reviews a different candidate', async () => {
  await start();
  await tick(6);
  let drafts = 0;
  const original = runtime.ai;
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'draft' && drafts++ === 0 ? card(' FAILED CANDIDATE ') : original(r),
  );
  await tick();
  expect(await run()).toMatchObject({ status: 'draft', revision: 4, error: 'duplicate_retry' });
  await tick(7);
  expect(await run()).toMatchObject({ status: 'scheduled', revision: 4 });
  expect(JSON.parse((await run()).rejected_expressions)).toHaveLength(1);
});

it('keeps the original duplicate and render budgets across replacement', async () => {
  await start();
  await tick(5);
  await env.DB.prepare(
    'UPDATE automation_runs SET rejected_expressions=\'["Old one","Old two"]\',render_attempts=2',
  ).run();
  await tick();
  runtime.ai = vi.fn(async () => card('Failed candidate'));
  await tick(5);
  expect(await run()).toMatchObject({
    status: 'skipped',
    error: 'duplicate_limit',
    revision: 4,
    render_attempts: 2,
  });
  expect(JSON.parse((await run()).rejected_expressions)).toHaveLength(3);
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});

it('falls back after replacement draft provider failures without reusing old attempt counts', async () => {
  await start();
  await tick(6);
  const original = runtime.ai;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'draft' && r.provider === 'google') throw new AiError('unavailable', 503);
    return original(r);
  });
  await tick(15);
  expect(await run()).toMatchObject({
    status: 'scheduled',
    revision: 4,
    writer: 'groq',
    reviewer: 'google',
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM automation_attempts WHERE stage='draft' AND revision=4 AND provider='google'",
    ).first('n'),
  ).toBe(3);
});

it.each(['auth', 'quota', 'config'] as const)(
  'pauses instead of replacing again on %s',
  async (code) => {
    await start();
    await tick(6);
    runtime.ai = vi.fn(async () => {
      throw new AiError(code);
    });
    await tick(2);
    expect(await run()).toMatchObject({ status: 'cancelled', revision: 4, error: code });
    expect(runtime.ai).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT enabled FROM automation_settings').first('enabled')).toBe(
      0,
    );
  },
);

it.each(['pause', 'deadline', 'claim'] as const)(
  'rejects a delayed final review after %s changes',
  async (change) => {
    await start();
    await tick(5);
    let release!: (v: unknown) => void;
    runtime.ai = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = automationTick(env, runtime);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (change === 'pause') await changeSettings(env, 'pause', 2, null, now);
    if (change === 'deadline') now = (await run()).deadline;
    if (change === 'claim')
      await env.DB.prepare("UPDATE automation_runs SET claim_owner='new-owner'").run();
    release(bad);
    await pending;
    expect((await run()).revision).toBe(3);
    expect((await run()).replacement_origin).toBeNull();
    expect(runtime.render).not.toHaveBeenCalled();
  },
);

it.each(['before-transition', 'after-transition', 'attempt-result'] as const)(
  'recovers a database failure at %s without losing history or making a second replacement',
  async (point) => {
    await start();
    await tick(5);
    const original = await run();
    const db = env.DB;
    let injected = false;
    env.DB = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const eligible =
              point === 'attempt-result'
                ? sql === "UPDATE automation_attempts SET outcome='ok' WHERE id=?"
                : sql.startsWith('UPDATE automation_runs SET replacement_origin=');
            const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
              new Proxy(statement, {
                get(stmt, method) {
                  if (method === 'bind') return (...args: unknown[]) => wrap(stmt.bind(...args));
                  if (method === 'run' && eligible)
                    return async () => {
                      const fail = !injected;
                      injected = true;
                      if (fail && point !== 'after-transition')
                        throw new Error('injected database interruption');
                      const result = await stmt.run();
                      if (fail) throw new Error('injected lost acknowledgement');
                      return result;
                    };
                  const value: unknown = Reflect.get(stmt, method);
                  return typeof value === 'function' ? value.bind(stmt) : value;
                },
              });
            return wrap(target.prepare(sql));
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await tick();
    env.DB = db;
    expect(injected).toBe(true);
    await tick(10);
    const result = await run();
    expect(result).toMatchObject({
      id: original.id,
      card_id: original.card_id,
      asset_id: original.asset_id,
      schedule_id: original.schedule_id,
      due_at: original.due_at,
      deadline: original.deadline,
      revision: 4,
      status: 'scheduled',
    });
    expect(JSON.parse(result.replacement_origin!)).toMatchObject({
      content_hash: original.content_hash,
      review: bad,
      revision: 3,
    });
    expect(result.review_hash).toBe(result.content_hash);
    expect(await db.prepare('SELECT count(*) n FROM automation_runs').first('n')).toBe(1);
    expect(await db.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(1);
    expect(
      await db
        .prepare("SELECT count(*) n FROM automation_attempts WHERE stage='draft' AND revision=4")
        .first('n'),
    ).toBe(1);
    expect(
      Number(await db.prepare('SELECT count(*) n FROM automation_attempts').first('n')),
    ).toBeLessThanOrEqual(24);
    expect(runtime.render).toHaveBeenCalledTimes(1);
  },
);

it('does not replace an already materialized card', async () => {
  await start();
  await tick(5);
  const r = await run();
  await env.DB.prepare(
    "INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,'draft',?)",
  )
    .bind(r.card_id, r.content, now)
    .run();
  await tick();
  expect(await run()).toMatchObject({
    status: 'skipped',
    revision: 3,
    replacement_origin: null,
    error: 'changed',
  });
  expect(await env.DB.prepare('SELECT content FROM cards').first('content')).toBe(r.content);
});

it.each(['daily', 'trial'] as const)(
  'fills and mock-sends five %s slots with a replacement needed in slot five',
  async (kind) => {
    if (kind === 'daily') {
      await changeSettings(env, 'save', 1, { ...settings, cards_per_day: 5 }, now);
      await changeSettings(env, 'start', 2, null, now);
    } else await startTrial(env, 1, now, { cards: 5 });
    const failures = new Set<string>();
    runtime.ai = vi.fn(async (r) => {
      const active = (await rows()).find((x) => x.claim_owner)!;
      now += 1000;
      const key = `${active.item_index}:${r.stage}:${active.revision}`;
      if (
        r.provider === 'google' &&
        !failures.has(key) &&
        ((r.stage === 'draft' && active.item_index === 5 && active.revision === 1) ||
          (r.stage === 'revise' && [2, 5].includes(active.item_index) && active.revision === 1))
      ) {
        failures.add(key);
        throw new AiError('unavailable', 503);
      }
      if (
        r.stage === 'revise' &&
        active.item_index === 5 &&
        active.revision === 1 &&
        !failures.has('duplicate')
      ) {
        failures.add('duplicate');
        return card('Slot 1 initial');
      }
      if (r.stage === 'review')
        return ([2, 3].includes(active.item_index) && active.revision < 3) ||
          (active.item_index === 4 && active.revision < 2) ||
          (active.item_index === 5 && active.revision < 4)
          ? bad
          : good;
      return card(`Slot ${active.item_index} ${active.revision === 4 ? 'replacement' : 'initial'}`);
    });
    runtime.render = vi.fn(async () => {
      now += 1000;
      return validPng();
    });
    await automationTick(env, runtime);
    const initial = await run();
    for (let at = Math.max(NOW, initial.not_before) + 60000; at < initial.deadline; at += 60000) {
      now = at;
      await automationTick(env, runtime);
      if ((await rows()).every((r) => r.status === 'scheduled')) break;
    }
    expect((await rows()).map((r) => r.status)).toEqual(Array(5).fill('scheduled'));
    expect((await rows())[4]).toMatchObject({ revision: 4 });
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

it('0021 preserves existing rows and references and adds bounded revision and private evidence', async () => {
  const old = await harnessThrough('0020_automation_quality_retry.sql');
  try {
    const db = old.env.DB;
    for (const rev of [1, 2, 3])
      await db
        .prepare(
          "INSERT INTO automation_runs(id,day,dedupe_key,config_version,settings,due_at,deadline,status,writer,reviewer,revision,card_id,asset_id,public_id,schedule_id,updated_at) VALUES(?,?,?,1,?,1,1,'skipped','google','groq',?,?,?,?,?,1)",
        )
        .bind(
          'old' + rev,
          '2026-09-2' + rev,
          'old' + rev,
          JSON.stringify(settings),
          rev,
          'c' + rev,
          'a' + rev,
          'p' + rev,
          's' + rev,
        )
        .run();
    await db.exec(
      "INSERT INTO automation_attempts VALUES('attempt','old3','review',3,'groq',1,'ok',200); INSERT INTO automation_expressions VALUES('reserved','old3');",
    );
    const before = (await db.prepare('SELECT * FROM automation_runs ORDER BY id').all()).results;
    const sql = await readFile(
      new URL('../migrations/0021_automation_quality_replacement.sql', import.meta.url),
      'utf8',
    );
    await db.exec(sql.replaceAll('\n', ' '));
    expect((await db.prepare('SELECT * FROM automation_runs ORDER BY id').all()).results).toEqual(
      before.map((r) => ({ ...r, replacement_origin: null })),
    );
    expect(await db.prepare('SELECT run_id FROM automation_attempts').first('run_id')).toBe('old3');
    expect(await db.prepare('SELECT run_id FROM automation_expressions').first('run_id')).toBe(
      'old3',
    );
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await db.prepare("UPDATE automation_runs SET revision=4 WHERE id='old3'").run();
    await expect(
      db.prepare("UPDATE automation_runs SET revision=5 WHERE id='old3'").run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("UPDATE automation_runs SET replacement_origin='[]' WHERE id='old3'").run(),
    ).rejects.toThrow();
    await expect(
      db.prepare("UPDATE automation_runs SET deadline=2 WHERE id='old3'").run(),
    ).rejects.toThrow();
  } finally {
    await old.mf.dispose();
  }
});
