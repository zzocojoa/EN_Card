import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { legacyAutomationHarness as harness, NOW, SAMPLE, type Harness } from './helpers';
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
const bad = { ...good, translation: false, issues: ['번역 수정 필요'] };
const card = (expression = 'Original candidate') => ({
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
async function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    await automationTick(env, { ...runtime });
    now += 60000;
  }
}
const rows = async () =>
  (await env.DB.prepare('SELECT * FROM automation_runs ORDER BY item_index').all<Run>()).results;
const run = async () => (await rows())[0]!;
async function existing(expression: string) {
  await env.DB.prepare(
    "INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,'draft',?)",
  )
    .bind(crypto.randomUUID(), JSON.stringify(card(expression)), now)
    .run();
}
function unavailableCorrections(firstWriter: 'google' | 'groq' = 'google') {
  runtime.ai = vi.fn(async (r) => {
    if (r.stage === 'draft' && firstWriter === 'groq' && r.provider === 'google')
      throw new AiError('unavailable', 503);
    if (r.stage === 'review')
      return (r.content as { expression: string }).expression === 'Original candidate' ? bad : good;
    if (r.stage === 'revise') {
      if (r.provider === firstWriter) throw new AiError('unavailable', 503);
      return card('Fallback correction');
    }
    return card();
  });
}

it.each(['google', 'groq'] as const)(
  'switches exhausted %s corrections and requires a fresh independent review',
  async (firstWriter) => {
    await start();
    unavailableCorrections(firstWriter);
    for (let i = 0; i < 20; i++) {
      await tick();
      if (
        (await run()).content &&
        JSON.parse((await run()).content!).expression === 'Fallback correction'
      )
        break;
    }
    const pending = await run();
    expect(pending).toMatchObject({
      status: 'review',
      revision: 2,
      writer: firstWriter === 'google' ? 'groq' : 'google',
      reviewer: firstWriter,
      review: null,
      review_hash: null,
    });
    expect(runtime.render).not.toHaveBeenCalled();
    const input = vi
      .mocked(runtime.ai)
      .mock.calls.filter(([r]) => r.stage === 'revise')
      .at(-1)![0];
    expect(input).toMatchObject({ content: card(), review: bad });
    await tick(5);
    const result = await run();
    expect(result).toMatchObject({ id: pending.id, status: 'scheduled', revision: 2 });
    expect(result.review_hash).toBe(result.content_hash);
    expect(vi.mocked(runtime.ai).mock.calls.at(-1)![0]).toMatchObject({
      stage: 'review',
      provider: firstWriter,
      content: card('Fallback correction'),
    });
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM automation_attempts WHERE stage='revise' AND outcome='unavailable'",
      ).first('n'),
    ).toBe(3);
    expect(await env.DB.prepare('SELECT count(*) n FROM assets').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(1);
    // The operator query must prove the final writer's correction even when that
    // provider never produced a successful initial draft.
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
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM automation_attempts WHERE run_id=? AND provider=? AND stage='draft' AND outcome='ok'",
      )
        .bind(result.id, result.writer)
        .first('n'),
    ).toBe(0);
  },
);

it.each(['unavailable', 'invalid'] as const)(
  'stops after three corrections per provider across restarts (%s fallback)',
  async (failure) => {
    await start();
    runtime.ai = vi.fn(async (r) => {
      if (r.stage === 'revise') {
        if (r.provider === 'groq' && failure === 'invalid') return { invalid: 'not a card' };
        throw new AiError('unavailable', 503);
      }
      return r.stage === 'review' ? bad : card();
    });
    await tick(24);
    expect(await run()).toMatchObject({ status: 'skipped', error: 'unavailable', revision: 1 });
    const counts = await env.DB.prepare(
      "SELECT provider,count(*) n FROM automation_attempts WHERE stage='revise' GROUP BY provider ORDER BY provider",
    ).all();
    expect(counts.results).toEqual([
      { provider: 'google', n: 3 },
      { provider: 'groq', n: 3 },
    ]);
    expect(runtime.ai).toHaveBeenCalledTimes(8);
    expect(runtime.render).not.toHaveBeenCalled();
  },
);

it.each(['rejected', 'unavailable'] as const)(
  'never self-approves a fallback correction when its independent review is %s',
  async (outcome) => {
    await start();
    unavailableCorrections();
    const original = runtime.ai;
    runtime.ai = vi.fn(async (r) => {
      if (r.stage === 'review' && r.provider === 'google') {
        if (outcome === 'unavailable') throw new AiError('unavailable', 503);
        return bad;
      }
      return original(r);
    });
    for (let i = 0; i < 24; i++) {
      const active = await run();
      if (active?.status === 'review' && active.revision === 3) now = active.deadline - 360000;
      await tick();
    }
    expect(await run()).toMatchObject({
      status: 'skipped',
      revision: outcome === 'rejected' ? 3 : 2,
      error: outcome === 'rejected' ? 'review_failed' : 'unavailable',
    });
    const reviews = vi
      .mocked(runtime.ai)
      .mock.calls.filter(
        ([r]) =>
          r.stage === 'review' &&
          (r.content as { expression: string }).expression === 'Fallback correction',
      );
    expect(reviews).toHaveLength(outcome === 'rejected' ? 2 : 3);
    expect(reviews.every(([r]) => r.provider === 'google')).toBe(true);
    expect(runtime.render).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(0);
  },
);

it.each([false, true])(
  'preserves duplicate history and correction feedback across fallback (duplicate limit=%s)',
  async (reachLimit) => {
    await start();
    await existing('Already used');
    let google = 0,
      groq = 0;
    const inputs: AiRequest[] = [];
    runtime.ai = vi.fn(async (r) => {
      inputs.push(r);
      if (r.stage === 'review')
        return (r.content as { expression: string }).expression === 'Original candidate'
          ? bad
          : good;
      if (r.stage === 'draft') return card();
      if (r.provider === 'google') {
        if (++google === 1) return card('Already used');
        throw new AiError('unavailable', 503);
      }
      return card(++groq === 1 || reachLimit ? 'Already used' : 'Unique replacement');
    });
    await tick(20);
    const result = await run();
    expect(result).toMatchObject({
      status: reachLimit ? 'skipped' : 'scheduled',
      error: reachLimit ? 'duplicate_limit' : null,
    });
    expect(JSON.parse(result.rejected_expressions)).toHaveLength(reachLimit ? 3 : 2);
    expect(google).toBe(3);
    expect(groq).toBe(2);
    const replacements = inputs.filter((r) => r.stage === 'revise' && r.provider === 'groq');
    replacements.forEach((r) =>
      expect(r).toMatchObject({
        content: card(),
        review: bad,
        recent: expect.arrayContaining(['Already used']),
      }),
    );
    expect(
      await env.DB.prepare("SELECT count(*) n FROM automation_attempts WHERE stage='revise'").first(
        'n',
      ),
    ).toBe(5);
    expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(
      reachLimit ? 0 : 1,
    );
  },
);

it.each(['auth', 'quota', 'config'] as const)(
  'pauses on %s in the fallback without further provider calls',
  async (code) => {
    await start();
    unavailableCorrections();
    const original = runtime.ai;
    runtime.ai = vi.fn(async (r) => {
      if (r.stage === 'revise' && r.provider === 'groq') throw new AiError(code);
      return original(r);
    });
    await tick(18);
    expect(await env.DB.prepare('SELECT enabled,reason FROM automation_settings').first()).toEqual({
      enabled: 0,
      reason: code,
    });
    expect(await run()).toMatchObject({ status: 'cancelled' });
    expect(runtime.ai).toHaveBeenCalledTimes(6);
    expect(runtime.render).not.toHaveBeenCalled();
  },
);

it('does not switch providers or call AI after the preparation deadline', async () => {
  await start();
  unavailableCorrections();
  await tick(5);
  expect(vi.mocked(runtime.ai).mock.calls.filter(([r]) => r.stage === 'revise')).toHaveLength(3);
  now = (await run()).deadline;
  await tick(3);
  expect(await run()).toMatchObject({ status: 'skipped', error: 'expired', writer: 'google' });
  expect(runtime.ai).toHaveBeenCalledTimes(5);
});

it.each(['cancel', 'claim takeover', 'deadline'] as const)(
  'discards a stale fallback response after %s without creating an asset',
  async (boundary) => {
    await start();
    unavailableCorrections();
    await tick(6);
    expect(await run()).toMatchObject({ status: 'revise', writer: 'groq' });
    let release!: (value: unknown) => void;
    runtime.ai = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = automationTick(env, runtime);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (boundary === 'cancel') await changeSettings(env, 'pause', 2, null, now);
    else {
      now = boundary === 'deadline' ? (await run()).deadline : (await run()).claim_until! + 1;
      runtime.ai = vi.fn(async () => card('New owner correction'));
      await automationTick(env, runtime);
    }
    const expected = await run();
    release(card('Late fallback'));
    await pending;
    expect(await run()).toEqual(expected);
    expect(expected.status).toBe(
      boundary === 'cancel' ? 'cancelled' : boundary === 'deadline' ? 'skipped' : 'review',
    );
    expect(await env.DB.prepare('SELECT count(*) n FROM assets').first('n')).toBe(0);
  },
);

it('expires a single-card trial at its original deadline even after a successful fallback review', async () => {
  await changeSettings(env, 'save', 0, settings, now);
  await startTrial(env, 1, now);
  unavailableCorrections();
  const trial = await run();
  for (let at = trial.not_before; at <= trial.deadline; at += 60000) {
    now = at;
    await automationTick(env, runtime);
  }
  expect(await run()).toMatchObject({
    status: 'skipped',
    error: 'expired',
    writer: 'groq',
    reviewer: 'google',
    revision: 2,
  });
  expect(runtime.ai).toHaveBeenCalledTimes(7);
  expect(await env.DB.prepare('SELECT count(*) n FROM schedules').first('n')).toBe(0);
});

it.each(['daily', 'trial'] as const)(
  'respects the %s preparation window under the observed five-slot failure pattern',
  async (kind) => {
    if (kind === 'daily') await start(5);
    else {
      await changeSettings(env, 'save', 0, settings, now);
      await startTrial(env, 1, now, { cards: 5 });
    }
    const attempts = new Map<string, number>();
    runtime.ai = vi.fn(async (r) => {
      const active = (await rows()).find((row) => row.claim_owner)!;
      const key = `${active.item_index}/${r.stage}/${active.revision}/${r.provider}`;
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      now += 1000;
      if (r.stage === 'draft' && [4, 5].includes(active.item_index) && count === 1)
        throw new AiError('unavailable', 503);
      if (r.stage === 'revise' && [1, 3].includes(active.item_index) && r.provider === 'google')
        throw new AiError('unavailable', 503);
      if (r.stage === 'review')
        return [1, 3, 4].includes(active.item_index) && active.revision === 1 ? bad : good;
      return card(`Unique slot ${active.item_index}`);
    });
    runtime.render = vi.fn(async () => {
      now += 1000;
      return validPng();
    });
    const preparationMinutes = 55;
    for (let at = NOW; at <= NOW + preparationMinutes * 60000; at += 60000) {
      now = at;
      await automationTick(env, runtime);
    }
    const result = await rows();
    // New five-card trials retain the same 55-minute window as daily runs.
    // The two-minute image wait and fixed deadline remain enforced.
    const expectedCount = 5;
    expect(result.map((r) => r.status)).toEqual(Array(5).fill('scheduled'));
    const prepared = result.filter((r) => r.status === 'scheduled');
    expect(new Set(prepared.map((r) => JSON.parse(r.content!).expression)).size).toBe(
      expectedCount,
    );
    now = result[0]!.due_at;
    const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'mock only' }));
    for (let i = 0; i < 5; i++) {
      await prepareEngine(h.env, now, 'mock');
      await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
      now += 60000;
    }
    expect(sender).toHaveBeenCalledTimes(expectedCount);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE state='mock_sent'").first('n'),
    ).toBe(expectedCount);
  },
  60000,
);
