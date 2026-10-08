import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { harness, harnessThrough, NOW, SAMPLE, type Harness } from './helpers';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import { changeSettings } from '../src/automation/settings';
import { allocateDailyRuns } from '../src/automation/run-queue';
import { selectExpression, storeCandidates } from '../src/automation/expression-selection';
import { startTrial } from '../src/automation/trial';
import { AiError, type AiRequest } from '../src/automation/providers';
import type { AutomationEnv, Run, SettingsRow } from '../src/automation/types';
import { expressionCandidatesSchema } from '../src/shared/automation';
import { validPng } from './png-fixture';
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
const bad = { ...good, translation: false, issues: ['번역 수정 필요'] };
const card = (expression: string) => ({
  ...SAMPLE,
  expression,
  note_ko: '',
  base_expression: '',
  base_meaning_ko: '',
});
const suggestions = () => ({
  expressions: Array.from({ length: 10 }, (_, i) => `Fresh expression ${i}`),
});
let h: Harness, env: AutomationEnv, now: number, runtime: AutomationRuntime;
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY item_index').all<Run>()).results;
const run = async () => (await rows())[0]!;
async function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    await automationTick(env, runtime);
    now += 60_000;
  }
}
async function start(count = 5) {
  await changeSettings(env, 'save', 0, { ...settings, cards_per_day: count }, now);
  await changeSettings(env, 'start', 1, null, now);
}
async function existing(expression: string, at = now) {
  await env.DB.prepare(
    "INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,'draft',?)",
  )
    .bind(crypto.randomUUID(), JSON.stringify(card(expression)), at)
    .run();
}
async function claimed(count = 2) {
  await start(count);
  await allocateDailyRuns(
    env.DB,
    (await env.DB.prepare('SELECT * FROM automation_settings').first<SettingsRow>())!,
    now,
  );
  await env.DB.prepare("UPDATE automation_runs SET claim_owner='test-claim',claim_until=?")
    .bind(now + 120_000)
    .run();
  return rows();
}
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
      r.stage === 'select' ? suggestions() : r.stage === 'review' ? good : card(r.expression!),
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

it.each(['daily', 'trial'])(
  'shares one bounded selection call across five %s cards and independently reviews every reserved expression',
  async (kind) => {
    await existing('Old expression', now - 100_000);
    for (let i = 0; i < 50; i++) await existing(`Recent ${i}`, now + i);
    runtime.ai = vi.fn(async (r) =>
      r.stage === 'select'
        ? {
            expressions: [
              ' Old expression ',
              'OLD EXPRESSION',
              ...suggestions().expressions.slice(0, 8),
            ],
          }
        : r.stage === 'review'
          ? good
          : card(r.expression!),
    );
    if (kind === 'daily') await start();
    else {
      await changeSettings(env, 'save', 0, settings, now);
      await startTrial(env, 1, now, { cards: 5 });
    }
    await tick(32);
    const all = await rows();
    expect(all).toHaveLength(5);
    expect(
      all.every(
        (r) =>
          r.expression_selection === 1 &&
          r.status === 'scheduled' &&
          r.content_hash === r.review_hash,
      ),
    ).toBe(true);
    expect(new Set(all.map((r) => r.selected_expression)).size).toBe(5);
    const calls = vi.mocked(runtime.ai).mock.calls.map(([r]) => r);
    expect(calls.filter((r) => r.stage === 'select')).toHaveLength(1);
    expect(calls).toHaveLength(11);
    expect(
      calls.filter((r) => r.stage === 'draft').every((r) => r.expression?.startsWith('Fresh')),
    ).toBe(true);
    expect(calls.filter((r) => r.stage === 'review').every((r) => r.provider === 'groq')).toBe(
      true,
    );
    expect(runtime.render).toHaveBeenCalledTimes(5);
    expect(
      await env.DB.prepare(
        'SELECT count(*) n FROM automation_expression_candidates WHERE claim_run_id IS NOT NULL',
      ).first('n'),
    ).toBe(0);
    expect(
      await env.DB.prepare('SELECT count(*) n FROM automation_expression_candidates').first('n'),
    ).toBe(3);
    expect(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(11);
    now = all[0]!.due_at;
    const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'local only' }));
    for (let i = 0; i < 4; i++) {
      await prepareEngine(h.env, now, 'mock');
      await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
      now += 60_000;
    }
    expect(sender).toHaveBeenCalledTimes(5);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
    ).toBe(5);
  },
  60_000,
);

it('reuses unclaimed suggestions on the next day without another selection call', async () => {
  await start(1);
  await tick(7);
  now = NOW + 86400000;
  await tick(6);
  expect((await rows()).every((r) => r.status === 'scheduled')).toBe(true);
  expect(vi.mocked(runtime.ai).mock.calls.filter(([r]) => r.stage === 'select')).toHaveLength(1);
  expect(runtime.ai).toHaveBeenCalledTimes(5);
});

it('atomically allocates different targets to competing runs and persists them across retries', async () => {
  const [a, b] = await claimed();
  await storeCandidates(env.DB, a!, ['Candidate A', 'Candidate B'], now);
  const selected = await Promise.all([
    selectExpression(env.DB, a!, now),
    selectExpression(env.DB, b!, now),
  ]);
  expect(new Set(selected).size).toBe(2);
  expect(selected.every(Boolean)).toBe(true);
  expect(await selectExpression(env.DB, a!, now)).toBe(selected[0]);
  expect((await rows()).map((r) => r.selected_expression)).toEqual(selected);
});

it('rolls back a pool reservation if the paired run update fails', async () => {
  const [r] = await claimed(1);
  await storeCandidates(env.DB, r!, ['Candidate'], now);
  await env.DB.exec(
    "CREATE TRIGGER fail_selection BEFORE UPDATE OF selected_expression ON automation_runs BEGIN SELECT RAISE(ABORT,'synthetic'); END;",
  );
  await expect(selectExpression(env.DB, r!, now)).rejects.toThrow();
  expect(
    await env.DB.prepare('SELECT claim_run_id FROM automation_expression_candidates').first(
      'claim_run_id',
    ),
  ).toBeNull();
  await env.DB.exec('DROP TRIGGER fail_selection;');
  expect(await selectExpression(env.DB, r!, now)).toBe('Candidate');
});

it.each(['cancel', 'expire', 'claim'])(
  'discards late selection results after %s without a full-card call',
  async (kind) => {
    await start(1);
    runtime.ai = vi.fn(async () => {
      if (kind === 'cancel') await changeSettings(env, 'pause', 2, null, now);
      if (kind === 'expire') now = (await run()).deadline;
      if (kind === 'claim')
        await env.DB.prepare("UPDATE automation_runs SET claim_owner='replacement'").run();
      return suggestions();
    });
    await tick();
    expect(
      await env.DB.prepare('SELECT count(*) n FROM automation_expression_candidates').first('n'),
    ).toBe(0);
    expect((await run()).selected_expression).toBeNull();
    expect(runtime.ai).toHaveBeenCalledTimes(1);
    expect(runtime.render).not.toHaveBeenCalled();
  },
);

it.each(['cancel', 'expire'])(
  'releases a reserved expression on %s and cannot commit an in-flight draft',
  async (kind) => {
    await start(1);
    await tick();
    const selected = (await run()).selected_expression;
    runtime.ai = vi.fn(async () => {
      if (kind === 'cancel') await changeSettings(env, 'pause', 2, null, now);
      else now = (await run()).deadline;
      return card(selected!);
    });
    await tick(2);
    expect((await run()).content).toBeNull();
    expect(
      await env.DB.prepare(
        'SELECT count(*) n FROM automation_expression_candidates WHERE claim_run_id IS NOT NULL',
      ).first('n'),
    ).toBe(0);
    expect(runtime.render).not.toHaveBeenCalled();
  },
);

it('replaces a newly duplicated target before writing the full card', async () => {
  await start(1);
  await tick();
  const original = (await run()).selected_expression!;
  await existing(original);
  await tick();
  expect(runtime.ai).toHaveBeenCalledTimes(1);
  expect(await run()).toMatchObject({
    selected_expression: null,
    status: 'draft',
    error: 'duplicate_retry',
  });
  await tick(6);
  expect((await run()).status).toBe('scheduled');
  expect((await run()).selected_expression).not.toBe(original);
  expect(runtime.ai).toHaveBeenCalledTimes(3);
});

it('rechecks concurrent manual duplicates after writing and again before PNG rendering', async () => {
  await start(1);
  await tick();
  let original = (await run()).selected_expression!;
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'draft' && r.expression === original) await existing(original);
    return r.stage === 'review' ? good : card(r.expression!);
  });
  await tick();
  expect((await run()).selected_expression).toBeNull();
  original = 'no longer collide';
  await tick(2);
  const reviewed = await run();
  expect(reviewed.status).toBe('render');
  await existing(reviewed.selected_expression!);
  await tick();
  expect(runtime.render).not.toHaveBeenCalled();
  expect((await run()).render_attempts).toBe(0);
  expect((await run()).status).toBe('draft');
  await tick(6);
  expect((await run()).status).toBe('scheduled');
});

it('rejects a model substituting its own expression without reviewing or rendering it', async () => {
  await start(1);
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'select' ? suggestions() : card('Unreserved substitution'),
  );
  await tick(12);
  expect((await run()).status).toBe('skipped');
  expect((await run()).content).toBeNull();
  expect(runtime.ai).toHaveBeenCalledTimes(7);
  expect(vi.mocked(runtime.ai).mock.calls.some(([r]) => r.stage === 'review')).toBe(false);
  expect(runtime.render).not.toHaveBeenCalled();
});

it('bounds all-duplicate selection batches without spending full-card calls or resetting attempts', async () => {
  await existing('Used');
  await start(1);
  runtime.ai = vi.fn(async () => ({ expressions: [' Used ', 'USED'] }));
  await tick(12);
  expect((await run()).status).toBe('skipped');
  expect((await run()).error).toBe('candidate_limit');
  expect(runtime.ai).toHaveBeenCalledTimes(6);
  expect(vi.mocked(runtime.ai).mock.calls.every(([r]) => r.stage === 'select')).toBe(true);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM automation_expression_candidates').first('n'),
  ).toBe(0);
});

it('remembers rejected old suggestions outside the most recent 50 before the next selection call', async () => {
  await existing('Old duplicate', now - 100_000);
  for (let i = 0; i < 50; i++) await existing(`Recent ${i}`, now + i);
  await start(1);
  const inputs: AiRequest[] = [];
  runtime.ai = vi.fn(async (r) => {
    inputs.push(r);
    return { expressions: inputs.length === 1 ? ['Old duplicate'] : ['New candidate'] };
  });
  await tick(2);
  expect(inputs[0]!.recent).not.toContain('Old duplicate');
  expect(inputs[1]!.recent).toContain('old duplicate');
  expect(inputs[1]!.recent.length).toBeLessThanOrEqual(50);
  expect((await run()).selected_expression).toBe('New candidate');
  expect(runtime.render).not.toHaveBeenCalled();
});

it('counts selection calls in the unchanged 24-call durable budget', async () => {
  await start(1);
  await tick();
  const r = await run();
  for (let i = 1; i < 24; i++)
    await env.DB.prepare(
      "INSERT INTO automation_attempts(id,run_id,stage,revision,provider,started_at,outcome) VALUES(?,?,'select',1,'google',?,'unavailable')",
    )
      .bind(`budget${i}`, r.id, now)
      .run();
  await tick();
  expect(await run()).toMatchObject({ status: 'skipped', error: 'ai_limit' });
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});

it.each(['auth', 'quota', 'config'] as const)(
  'pauses on selection %s without trying another paid/provider path',
  async (code) => {
    await start(1);
    runtime.ai = vi.fn(async () => {
      throw new AiError(code);
    });
    await tick(3);
    expect(await env.DB.prepare('SELECT reason FROM automation_settings').first('reason')).toBe(
      code,
    );
    expect(runtime.ai).toHaveBeenCalledTimes(1);
  },
);

it('retains the chosen expression through correction provider fallback and requires an opposite review', async () => {
  await start(1);
  const requests: AiRequest[] = [];
  runtime.ai = vi.fn(async (r) => {
    requests.push(r);
    if (r.stage === 'select') return suggestions();
    if (r.stage === 'revise' && r.provider === 'google') throw new AiError('unavailable', 503);
    if (r.stage === 'review') return (await run()).revision === 1 ? bad : good;
    return card(r.expression!);
  });
  await tick(15);
  expect(await run()).toMatchObject({
    status: 'scheduled',
    writer: 'groq',
    reviewer: 'google',
    revision: 2,
  });
  expect(new Set(requests.filter((r) => r.stage !== 'select').map((r) => r.expression)).size).toBe(
    1,
  );
  expect(requests.at(-1)).toMatchObject({ stage: 'review', provider: 'google' });
});

it('abandons a quality-failed expression once and excludes it from later slots in the same batch', async () => {
  await start(2);
  let failed = '';
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'select') return suggestions();
    const active = (await rows()).find((row) => row.claim_owner)!;
    if (r.stage === 'review') return active.item_index === 1 && active.revision < 4 ? bad : good;
    if (active.item_index === 1 && active.revision === 1) failed = r.expression!;
    return card(r.expression!);
  });
  await tick(22);
  expect(
    (await rows()).every((r) => r.status === 'scheduled' && r.selected_expression !== failed),
  ).toBe(true);
  const first = await run();
  expect(first.revision).toBe(4);
  expect(JSON.parse(first.replacement_origin!).content.expression).toBe(failed);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM automation_expression_rejections').first('n'),
  ).toBe(1);
  expect(vi.mocked(runtime.ai).mock.calls.filter(([r]) => r.stage === 'select')).toHaveLength(1);
});

it('preserves historical jobs, attempts and permanent expressions in migration 0023', async () => {
  const old = await harnessThrough('0022_oauth_credential_generation.sql');
  try {
    const db = old.env.DB;
    await db
      .prepare(
        "INSERT INTO automation_runs(id,day,dedupe_key,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at) VALUES('old','2026-09-28','old',1,?,1,1,'skipped','google','groq','c','a','p','s',1)",
      )
      .bind(JSON.stringify(settings))
      .run();
    await db.exec(
      "INSERT INTO automation_attempts VALUES('attempt','old','draft',1,'google',1,'ok',200); INSERT INTO automation_expressions VALUES('used','old');",
    );
    const before = await db.prepare('SELECT * FROM automation_runs').first();
    await db.exec(
      (
        await readFile(
          new URL('../migrations/0023_automation_expression_selection.sql', import.meta.url),
          'utf8',
        )
      ).replaceAll('\n', ' '),
    );
    const { expression_selection, selected_expression, ...preserved } = (await db
      .prepare('SELECT * FROM automation_runs')
      .first<Record<string, unknown>>())!;
    expect(preserved).toEqual(before);
    expect(expression_selection).toBe(0);
    expect(selected_expression).toBeNull();
    expect(await db.prepare('SELECT count(*) n FROM automation_attempts').first('n')).toBe(1);
    expect(
      await db.prepare('SELECT expression_key FROM automation_expressions').first('expression_key'),
    ).toBe('used');
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {
    await old.mf.dispose();
  }
});

it.each([2, 3])(
  'requires candidate selection room as well as drafting/review: %i remaining calls',
  async (remaining) => {
    await start(1);
    runtime.ai = vi.fn(async (r) =>
      r.stage === 'select'
        ? suggestions()
        : r.stage === 'review'
          ? (await run()).revision === 4
            ? good
            : bad
          : card(r.expression!),
    );
    await tick(6);
    const r = await run();
    expect(r).toMatchObject({ revision: 3, status: 'review' });
    const extra = 24 - remaining - 1 - 6;
    for (let i = 0; i < extra; i++)
      await env.DB.prepare(
        "INSERT INTO automation_attempts(id,run_id,stage,revision,provider,started_at,outcome) VALUES(?,?,'select',1,'google',?,'unavailable')",
      )
        .bind(`prior${i}`, r.id, now)
        .run();
    await tick();
    expect((await run()).replacement_origin !== null).toBe(remaining === 3);
    await tick(6);
    expect((await run()).status).toBe(remaining === 3 ? 'scheduled' : 'skipped');
    expect(
      Number(await env.DB.prepare('SELECT count(*) n FROM automation_attempts').first('n')),
    ).toBeLessThanOrEqual(24);
  },
);

it('does not begin a replacement at the seven-minute cutoff', async () => {
  await start(1);
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'select' ? suggestions() : r.stage === 'review' ? bad : card(r.expression!),
  );
  await tick(6);
  now = (await run()).deadline - 7 * 60_000;
  await tick();
  expect(await run()).toMatchObject({ status: 'skipped', replacement_origin: null });
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM automation_expression_candidates WHERE claim_run_id IS NOT NULL',
    ).first('n'),
  ).toBe(0);
});

it('replenishes only suggestions for the requested scope while preserving published cards', async () => {
  await start(1);
  await tick(7);
  await changeSettings(env, 'pause', 2, null, now);
  await changeSettings(env, 'save', 3, { ...settings, topic: '여행', cards_per_day: 1 }, now);
  await changeSettings(env, 'start', 4, null, now);
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'select'
      ? { expressions: ['Travel expression'] }
      : r.stage === 'review'
        ? good
        : card(r.expression!),
  );
  now = NOW + 86400000;
  await tick(7);
  expect((await rows()).every((r) => r.status === 'scheduled')).toBe(true);
  expect(runtime.ai).toHaveBeenCalledTimes(3);
  expect(await env.DB.prepare('SELECT count(*) n FROM cards').first('n')).toBe(2);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_expressions').first('n')).toBe(2);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM automation_expression_candidates').first('n'),
  ).toBe(0);
});

it('bounds untrusted candidate output before storing it', () => {
  for (const value of [
    { expressions: [] },
    { expressions: Array(11).fill('x') },
    { expressions: [' '] },
    { expressions: ['x'.repeat(121)] },
    { expressions: ['x'], extra: true },
  ])
    expect(expressionCandidatesSchema.safeParse(value).success).toBe(false);
});
