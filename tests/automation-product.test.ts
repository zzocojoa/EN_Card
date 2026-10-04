import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { harness, harnessThrough, NOW, SAMPLE, type Harness } from './helpers';
import { readFile } from 'node:fs/promises';
import { validPng } from './png-fixture';
import { automationTick, type AutomationRuntime } from '../src/automation/engine';
import { changeSettings, settingsView, runHistory } from '../src/automation/settings';
import { AiError, providerClient, type AiRequest } from '../src/automation/providers';
import type { AutomationEnv, Run } from '../src/automation/types';
import {
  automationSettings,
  nextAutomationDue,
  type AutomationSettings,
} from '../src/shared/automation';
import { runEngine, resolveUnknown } from '../src/worker/engine';
import { saveCard, deleteImage } from '../src/worker/storage';
import { route } from '../src/worker/index';
import { automationApi, automationCron } from '../src/worker/automation';
import { startTrial } from '../src/automation/trial';
import { saveSchedule } from '../src/worker/schedules';
import { accessToken, disconnect, markReconnect } from '../src/worker/auth';
import { encrypt } from '../src/worker/crypto';
let h: Harness;
let env: AutomationEnv;
let now: number;
let runtime: AutomationRuntime;
const settings: AutomationSettings = {
  topic: '일상',
  base_expression: '',
  level: '초급',
  template: 'expression',
  start_date: '2026-09-28',
  end_date: null,
  time: '13:00',
};
const draft = { ...SAMPLE, note_ko: '', base_expression: '', base_meaning_ko: '' };
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
    ai: vi.fn(async (r: AiRequest) => (r.stage === 'review' ? good : draft)),
    render: vi.fn(async () => validPng()),
  };
  await env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'owner',?,?,1,'connected')",
  )
    .bind(NOW + 86400000, NOW + 86400000)
    .run();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function start() {
  await changeSettings(env, 'save', 0, settings, now);
  await changeSettings(env, 'start', 1, null, now);
}
async function tick(advance = 0) {
  now += advance;
  await automationTick(env, runtime);
}
async function run() {
  return (await env.DB.prepare(
    'SELECT * FROM automation_runs ORDER BY day DESC LIMIT 1',
  ).first<Run>())!;
}
async function completed() {
  await start();
  await tick();
  await tick(60000);
  await tick(60000);
  await tick(120000);
  return run();
}
it.each(['disconnect', 'invalid'] as const)(
  '%s revokes future automation even after reconnecting before creation',
  async (reason) => {
    now = NOW - 60000;
    await start();
    if (reason === 'disconnect') await disconnect(h.env, now);
    else await markReconnect(h.env, 1, now);
    expect(await settingsView(env)).toMatchObject({
      enabled: false,
      reason: 'connection',
      version: 3,
    });
    await env.DB.prepare("UPDATE credentials SET status='connected',version=version+1").run();
    await tick(120000);
    expect(runtime.ai).not.toHaveBeenCalled();
    expect(await run()).toBeNull();
    await expect(changeSettings(env, 'start', 2, null, now)).rejects.toMatchObject({ status: 409 });
    // Reconnection alone is insufficient; the user must explicitly start the current settings.
    await changeSettings(env, 'start', 3, null, now);
    expect((await settingsView(env)).enabled).toBe(true);
  },
);
it('a stale credential failure preserves a newer connected automation', async () => {
  await start();
  await env.DB.prepare('UPDATE credentials SET version=2').run();
  expect(await markReconnect(h.env, 1, now)).toBe(false);
  expect(await settingsView(env)).toMatchObject({ enabled: true, version: 2 });
});
it.each(['invalid', 'uncertain', 'cipher', 'transient'] as const)(
  'credential %s failure only revokes automation when reconnection is required',
  async (failure) => {
    await start();
    await env.DB.prepare('UPDATE credentials SET expires_at=0,access_token=?,refresh_token=?')
      .bind(
        await encrypt('mock-access', h.env.TOKEN_ENCRYPTION_KEY),
        failure === 'cipher'
          ? 'broken-cipher'
          : await encrypt('mock-refresh', h.env.TOKEN_ENCRYPTION_KEY),
      )
      .run();
    const transport = vi.fn(async () => {
      if (failure === 'uncertain') throw new Error('mock connection loss');
      return Response.json(
        {
          error: failure === 'transient' ? 'temporarily_unavailable' : 'invalid_grant',
          error_code: 'KOE322',
        },
        { status: failure === 'transient' ? 503 : 400 },
      );
    });
    await expect(accessToken(h.env, now, transport)).rejects.toHaveProperty('tokenFailure');
    expect(await settingsView(env)).toMatchObject(
      failure === 'transient'
        ? { enabled: true, version: 2, reason: null }
        : { enabled: false, version: 3, reason: 'connection' },
    );
  },
);
it('disconnect during an AI call prevents its late result from continuing after reconnect', async () => {
  await start();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  runtime.ai = vi.fn(async () => {
    started();
    await waiting;
    return draft;
  });
  const pending = tick();
  await entered;
  await disconnect(h.env, now);
  await env.DB.prepare("UPDATE credentials SET status='connected',version=version+1").run();
  release();
  await pending;
  await tick(60000);
  expect(await run()).toMatchObject({
    status: 'cancelled',
    error: 'connection',
    content: null,
    claim_owner: null,
  });
  expect(runtime.ai).toHaveBeenCalledTimes(1);
  expect(runtime.render).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(0);
});
it('0015 preserves legacy run identifiers, child records, original fields and trigger protections', async () => {
  const legacy = await harnessThrough('0014_card_automation.sql');
  try {
    const db = legacy.env.DB;
    await db
      .prepare(
        "INSERT INTO automation_runs(id,day,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at) VALUES('old','2026-09-28',2,?,1,1,'cancelled','google','groq','c','a','p','s',1)",
      )
      .bind(JSON.stringify(settings))
      .run();
    await db.exec(
      "INSERT INTO automation_attempts VALUES('attempt','old','draft',1,'google',1,'ok',200); INSERT INTO automation_expressions VALUES('expression','old');",
    );
    const before = await db.prepare('SELECT * FROM automation_runs').first();
    const triggers = (
      await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
    ).results;
    await db.exec(
      (await readFile('migrations/0015_automation_trial.sql', 'utf8')).replaceAll('\n', ' '),
    );
    const after = await db.prepare('SELECT * FROM automation_runs').first();
    expect(after).toEqual({ ...before, dedupe_key: before!.day, kind: 'daily', not_before: 0 });
    expect(await db.prepare('SELECT run_id FROM automation_attempts').first('run_id')).toBe('old');
    expect(await db.prepare('SELECT run_id FROM automation_expressions').first('run_id')).toBe(
      'old',
    );
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    expect(
      (await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all())
        .results,
    ).toEqual(triggers);
    expect(
      (
        await db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT * FROM automation_runs ORDER BY day DESC,due_at DESC LIMIT 30',
          )
          .all()
      ).results.some((r) => String(r.detail).includes('automation_history')),
    ).toBe(true);
  } finally {
    await legacy.mf.dispose();
  }
});
it('an extra trial preserves sent history and saved daily settings, waits, and sends exactly once', async () => {
  const daily = await completed();
  now = daily.due_at;
  const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'mock only' }));
  await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  await changeSettings(env, 'pause', 2, null, now);
  const before = await env.DB.prepare('SELECT * FROM schedules WHERE id=?')
    .bind(daily.schedule_id)
    .first();
  const delivery = await env.DB.prepare('SELECT * FROM deliveries').first();
  expect(before?.reason).toBe('completed');
  await startTrial(env, 3, now);
  const trial = (await env.DB.prepare(
    "SELECT * FROM automation_runs WHERE kind='trial'",
  ).first<Run>())!;
  expect(JSON.parse(trial.settings)).toMatchObject({
    topic: settings.topic,
    start_date: '2026-09-28',
    end_date: '2026-09-28',
    time: '13:25',
  });
  expect((await settingsView(env, now)).settings).toEqual(settings);
  expect((await settingsView(env, now)).next_due_at).toBeNull();
  expect(trial.not_before).toBe(now + 10 * 60000);
  runtime.ai = vi.fn(async (r) =>
    r.stage === 'review' ? good : { ...draft, expression: 'See you soon' },
  );
  await tick(9 * 60000 + 59999);
  expect(runtime.ai).not.toHaveBeenCalled();
  expect((await settingsView(env, now)).enabled).toBe(true);
  await tick(1);
  await tick(60000);
  await tick(60000);
  await tick(120000);
  expect(
    await env.DB.prepare('SELECT status FROM automation_runs WHERE id=?')
      .bind(trial.id)
      .first('status'),
  ).toBe('scheduled');
  now = trial.due_at;
  await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  await tick();
  expect(sender).toHaveBeenCalledTimes(2);
  expect((await settingsView(env, now)).enabled).toBe(false);
  expect((await settingsView(env, now)).trial_used_today).toBe(true);
  expect(
    await env.DB.prepare('SELECT * FROM schedules WHERE id=?').bind(daily.schedule_id).first(),
  ).toEqual(before);
  expect(
    await env.DB.prepare('SELECT * FROM deliveries WHERE id=?').bind(delivery!.id).first(),
  ).toEqual(delivery);
  expect(
    await env.DB.prepare('SELECT * FROM automation_runs WHERE id=?').bind(daily.id).first(),
  ).toEqual(daily);
  expect((await runHistory(env)).map((r) => r.kind)).toEqual(['trial', 'daily']);
});
it('concurrent and replayed trials use only one quota, even after cancellation and saving settings', async () => {
  await changeSettings(env, 'save', 0, settings, now);
  const results = await Promise.allSettled([startTrial(env, 1, now), startTrial(env, 1, now)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_runs').first('n')).toBe(1);
  await changeSettings(env, 'pause', 2, null, now);
  await changeSettings(env, 'save', 3, { ...settings, topic: '영화 대사' }, now);
  await expect(startTrial(env, 4, now)).rejects.toMatchObject({ code: 'TRIAL_USED' });
  await tick(12 * 60000);
  expect(runtime.ai).not.toHaveBeenCalled();
  expect((await run()).status).toBe('cancelled');
});
it('trial insertion and activation roll back together on a database failure', async () => {
  await changeSettings(env, 'save', 0, settings, now);
  await env.DB.exec(
    "CREATE TRIGGER fail_trial BEFORE UPDATE OF enabled ON automation_settings WHEN NEW.enabled=1 BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  await expect(startTrial(env, 1, now)).rejects.toThrow();
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_runs').first('n')).toBe(0);
  expect((await settingsView(env, now)).version).toBe(1);
});
it.each(['sending', 'unknown'])(
  'trial waits for a previous %s delivery to be resolved',
  async (state) => {
    const daily = await completed();
    now = daily.due_at;
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => now,
      token: async () => 'mock',
      sender: async () => ({ outcome: 'unknown', detail: 'injected' }),
    });
    await env.DB.prepare('UPDATE deliveries SET state=?').bind(state).run();
    await changeSettings(env, 'pause', 2, null, now);
    runtime.ai = vi.fn();
    const before = await settingsView(env, now);
    await expect(startTrial(env, 3, now)).rejects.toMatchObject({ code: 'TRIAL_UNAVAILABLE' });
    expect(await settingsView(env, now)).toEqual(before);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM automation_runs WHERE kind='trial'").first('n'),
    ).toBe(0);
    expect(runtime.ai).not.toHaveBeenCalled();
    if (state === 'unknown') {
      const delivery = await env.DB.prepare('SELECT id FROM deliveries').first<{ id: string }>();
      await resolveUnknown(delivery!.id, 'abandon', h.env, now);
      await startTrial(env, 3, now);
      expect((await settingsView(env, now)).trial_used_today).toBe(true);
    }
  },
);
it('trial rejects date rollover, disconnected account, stale version, dry-run and unconfirmed Free', async () => {
  await changeSettings(env, 'save', 0, settings, now);
  await expect(startTrial(env, 1, Date.parse('2026-09-28T14:35:00.001Z'))).rejects.toMatchObject({
    code: 'TRIAL_DATE',
  });
  await expect(startTrial(env, 0, now)).rejects.toMatchObject({ code: 'AUTOMATION_CHANGED' });
  await expect(startTrial({ ...env, SEND_MODE: 'dry_run' }, 1, now)).rejects.toMatchObject({
    code: 'AUTOMATION_CONFIG',
  });
  await expect(
    startTrial({ ...env, AI_FREE_CONFIRMED: 'unconfirmed' }, 1, now),
  ).rejects.toMatchObject({ code: 'AUTOMATION_CONFIG' });
  await env.DB.prepare("UPDATE credentials SET status='needs_reconnect'").run();
  await expect(startTrial(env, 1, now)).rejects.toMatchObject({ code: 'TRIAL_UNAVAILABLE' });
  expect(await env.DB.prepare('SELECT count(*) n FROM automation_runs').first('n')).toBe(0);
  expect((await settingsView(env, now)).enabled).toBe(false);
});
it('trial refuses active automation and never converts the daily quota into another daily run', async () => {
  await start();
  await expect(startTrial(env, 2, now)).rejects.toMatchObject({ code: 'AUTOMATION_ACTIVE' });
  await tick();
  await changeSettings(env, 'pause', 2, null, now);
  await startTrial(env, 3, now);
  await changeSettings(env, 'pause', 4, null, now);
  await changeSettings(env, 'start', 5, null, now);
  await tick();
  expect(
    await env.DB.prepare("SELECT count(*) n FROM automation_runs WHERE kind='daily'").first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM automation_runs WHERE kind='trial'").first('n'),
  ).toBe(1);
});
it('a reviewed card reaches one immutable asset and one schedule, then mock delivery without duplication', async () => {
  const result = await completed();
  expect(result.status).toBe('scheduled');
  await Promise.all([tick(), tick()]);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT review_source FROM cards').first('review_source')).toBe('ai');
  expect(await env.CARD_IMAGES.get(result.asset_id, 'arrayBuffer')).not.toBeNull();
  expect((await runHistory(env))[0]?.review).toEqual(good);
  now = result.due_at;
  const sender = vi.fn(async () => ({ outcome: 'mock_sent' as const, detail: 'mock only' }));
  await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  await runEngine(h.env, { mode: 'mock', clock: () => now, token: async () => 'mock', sender });
  expect(sender).toHaveBeenCalledTimes(1);
});
it('parallel cron claims invoke the writer only once', async () => {
  await start();
  await Promise.all([tick(), tick(), tick()]);
  expect(runtime.ai).toHaveBeenCalledTimes(1);
  expect((await run()).status).toBe('review');
});
it('pause while an AI response is pending rejects the stale result', async () => {
  await start();
  let release!: (v: unknown) => void;
  runtime.ai = vi.fn(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const pending = tick();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await changeSettings(env, 'pause', 2, null, now);
  release(draft);
  await pending;
  expect((await run()).status).toBe('cancelled');
  expect((await run()).content).toBeNull();
});
it('settings changes cancel already prepared automatic schedules and preserve manual cards', async () => {
  await completed();
  await saveCard({ ...SAMPLE, expression: 'Manual card' }, null, null, h.env, now);
  await changeSettings(env, 'save', 2, { ...settings, topic: '여행' }, now);
  expect(await env.DB.prepare('SELECT enabled FROM schedules').first('enabled')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM cards').first('n')).toBe(2);
  expect((await settingsView(env)).enabled).toBe(false);
});
it('one correction must be independently reviewed, a second failed review skips the day', async () => {
  await start();
  runtime.ai = vi.fn(async (r) => (r.stage === 'review' ? bad : draft));
  await tick();
  await tick(60000);
  expect((await run()).status).toBe('revise');
  await tick(60000);
  expect((await run()).revision).toBe(2);
  await tick(60000);
  expect((await run()).error).toBe('review_failed');
  expect(runtime.render).not.toHaveBeenCalled();
  expect((await settingsView(env)).enabled).toBe(true);
});
it('after three unavailable Google drafts Groq writes and Google must review', async () => {
  const calls: AiRequest[] = [];
  await start();
  runtime.ai = async (r) => {
    calls.push(r);
    if (r.provider === 'google' && r.stage === 'draft') throw new AiError('unavailable');
    return r.stage === 'review' ? good : draft;
  };
  for (let i = 0; i < 6; i++) await tick(i ? 60000 : 0);
  expect(calls.map((c) => `${c.stage}/${c.provider}`)).toEqual([
    'draft/google',
    'draft/google',
    'draft/google',
    'draft/groq',
    'review/google',
  ]);
  expect((await run()).status).toBe('render');
});
it.each(['auth', 'quota', 'config'] as const)(
  '%s errors pause instead of switching to a paid or unreviewed path',
  async (code) => {
    await start();
    runtime.ai = async () => {
      throw new AiError(code);
    };
    await tick();
    expect((await settingsView(env)).reason).toBe(code);
    await tick(60000);
    expect(runtime.render).not.toHaveBeenCalled();
  },
);
it('missing free confirmation and dry_run do not call either AI', async () => {
  await start();
  await automationTick({ ...env, AI_FREE_CONFIRMED: 'unconfirmed' }, runtime);
  await automationTick({ ...env, SEND_MODE: 'dry_run' }, runtime);
  expect(runtime.ai).not.toHaveBeenCalled();
});
it('a stale lease is recovered without exceeding durable attempt limits', async () => {
  await start();
  await tick();
  const r = await run();
  await env.DB.prepare(
    "UPDATE automation_runs SET claim_owner='dead',claim_until=?,status='review'",
  )
    .bind(now + 120000)
    .run();
  await tick(60000);
  expect((await run()).claim_owner).toBe('dead');
  await tick(60001);
  expect((await run()).status).toBe('render');
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM automation_attempts WHERE run_id=?')
      .bind(r.id)
      .first('n'),
  ).toBe(2);
});
it('a delayed cron skips expired days and never produces a catch-up batch', async () => {
  await start();
  await tick(2 * 86400000);
  expect((await run()).error).toBe('expired');
  expect(runtime.ai).not.toHaveBeenCalled();
  expect((await settingsView(env)).next_due_at).toBeGreaterThan(now);
});
it('case-folded duplicate expressions cannot be reserved', async () => {
  await saveCard({ ...SAMPLE, expression: 'TAKE YOUR TIME' }, null, null, h.env, now);
  await start();
  await tick();
  expect((await run()).error).toBe('duplicate');
});
it('editing the card during rendering invalidates automatic scheduling', async () => {
  await start();
  await tick();
  await tick(60000);
  await tick(60000);
  const r = await run();
  await saveCard({ ...SAMPLE, meaning_ko: '직접 수정' }, r.card_id, 1, h.env, now);
  await tick(120000);
  expect((await run()).status).toBe('skipped');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(0);
});
it('KV failure retains reserved bytes and stops automatic work', async () => {
  await start();
  await tick();
  await tick(60000);
  env.CARD_IMAGES = {
    ...env.CARD_IMAGES,
    put: async () => {
      throw new Error('mock storage failure');
    },
  } as unknown as KVNamespace;
  await tick(60000);
  expect((await settingsView(env)).reason).toBe('storage');
  expect(
    await env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
  ).toBeGreaterThan(0);
});
it('pending automation assets are protected from cleanup', async () => {
  await start();
  await tick();
  await tick(60000);
  await tick(60000);
  const r = await run();
  await expect(deleteImage(r.asset_id, h.env, now + 360000)).rejects.toThrow('asset_in_use');
});
it('a late put after pause and cleanup restores accounting when compensating cleanup fails', async () => {
  await start();
  await tick();
  await tick(60000);
  let release!: () => void;
  const original = h.env.CARD_IMAGES;
  env.CARD_IMAGES = {
    put: async (key: string, value: Parameters<KVNamespace['put']>[1]) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return original.put(key, value);
    },
    delete: async () => {
      throw new Error('cleanup unavailable');
    },
  } as unknown as KVNamespace;
  const pending = tick(60000);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const r = await run();
  await changeSettings(env, 'pause', 2, null, now);
  now += 360000;
  await deleteImage(r.asset_id, h.env, now);
  expect(
    await env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
  ).toBe(0);
  release();
  await pending;
  expect(await original.get(r.asset_id, 'arrayBuffer')).not.toBeNull();
  expect(
    await env.DB.prepare('SELECT state FROM assets WHERE id=?').bind(r.asset_id).first('state'),
  ).toBe('deleting');
  expect(
    await env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
  ).toBeGreaterThan(0);
  await deleteImage(r.asset_id, h.env, now);
  expect(
    await env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
  ).toBe(0);
});
it('the final schedule can send before automation switches to completed', async () => {
  await changeSettings(env, 'save', 0, { ...settings, end_date: settings.start_date }, now);
  await changeSettings(env, 'start', 1, null, now);
  await tick();
  await tick(60000);
  await tick(60000);
  await tick(120000);
  await tick();
  expect((await settingsView(env)).enabled).toBe(true);
  now = (await run()).due_at;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => now,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'mock_sent', detail: 'mock only' }),
  });
  await tick(60000);
  expect((await settingsView(env)).reason).toBe('complete');
  expect((await settingsView(env)).enabled).toBe(false);
  const result = await run();
  await expect(
    saveSchedule(
      {
        name: '수동 변경',
        kind: 'once',
        date: '2026-09-29',
        time: '13:00',
        end_date: null,
        weekdays: [],
        cards_per_occurrence: 1,
        asset_ids: [result.asset_id],
      },
      result.schedule_id,
      { version: 1, cursor: 1 },
      h.env,
      now,
    ),
  ).rejects.toMatchObject({ code: 'AUTOMATION_SCHEDULE_MANAGED' });
  expect(await env.DB.prepare('SELECT version FROM schedules').first('version')).toBe(1);
});
it('a failed expired writer cannot cancel a schedule recovered by the new lease owner', async () => {
  await start();
  await tick();
  await tick(60000);
  let reject!: (error: Error) => void;
  let calls = 0;
  const original = env.CARD_IMAGES;
  env.CARD_IMAGES = new Proxy(original, {
    get(target, key) {
      if (key === 'put')
        return async (...args: Parameters<KVNamespace['put']>) => {
          calls++;
          if (calls === 1)
            return new Promise<void>((_r, no) => {
              reject = no;
            });
          return target.put(...args);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const first = tick(60000);
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  await tick(120001);
  expect((await run()).status).toBe('schedule');
  await tick(120000);
  expect((await run()).status).toBe('scheduled');
  reject(new Error('stale put failure'));
  await first;
  expect((await settingsView(env)).enabled).toBe(true);
  expect(await env.DB.prepare('SELECT enabled FROM schedules').first('enabled')).toBe(1);
});
it('same KST date is not generated twice after pause and resume', async () => {
  await start();
  await tick();
  await changeSettings(env, 'pause', 2, null, now);
  await changeSettings(env, 'start', 3, null, now);
  await tick();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM automation_runs').first('n')).toBe(1);
  expect(runtime.ai).toHaveBeenCalledTimes(1);
});
it('version conflicts and impossible calendar dates are rejected', async () => {
  await start();
  await expect(changeSettings(env, 'pause', 1, null, now)).rejects.toMatchObject({ status: 409 });
  expect(automationSettings.safeParse({ ...settings, start_date: '2026-02-30' }).success).toBe(
    false,
  );
  expect(nextAutomationDue({ ...settings, time: '00:05', start_date: '2026-09-29' }, NOW)).toBe(
    Date.parse('2026-09-28T15:05:00Z'),
  );
});
it('AI review hash must be present before rendering even through direct DB writes', async () => {
  await start();
  await tick();
  await expect(
    env.DB.prepare("UPDATE automation_runs SET status='render',review_hash=NULL").run(),
  ).rejects.toThrow('CHECK');
});
it('automation API inherits owner authentication', async () => {
  await expect(
    route(new Request(h.env.APP_ORIGIN + '/api/automation'), h.env),
  ).rejects.toMatchObject({ status: 401 });
});
it('a dry_run main Worker never starts the live DO, including after a partial rollback', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  h.env.AUTOMATION = {
    idFromName: () => ({}),
    get: () => ({ fetch: fetcher }),
  } as unknown as NonNullable<typeof h.env.AUTOMATION>;
  await automationCron(h.env);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    automationApi(
      new Request(h.env.APP_ORIGIN + '/api/automation/start', { method: 'POST' }),
      h.env,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(fetcher).not.toHaveBeenCalled();
});
it('provider adapter uses pinned different hosts and hides error bodies', async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft) }] } }],
    }),
  );
  const input: AiRequest = {
    provider: 'google',
    stage: 'draft',
    settings,
    content: null,
    review: null,
    recent: [],
  };
  expect(await providerClient({ GOOGLE_API_KEY: 'mock-google' }, transport)(input)).toEqual(draft);
  expect(String(transport.mock.calls[0]![0])).not.toContain('mock-google');
  expect(transport.mock.calls[0]![1]?.redirect).toBe('manual');
  await expect(
    providerClient(
      { GROQ_API_KEY: 'mock-groq' },
      async () => new Response('secret provider detail', { status: 429 }),
    )({ ...input, provider: 'groq' }),
  ).rejects.toMatchObject({ code: 'quota', httpStatus: 429, message: 'quota' });
});
it('truncated, excessive, or malformed AI output never reaches a card', async () => {
  const input: AiRequest = {
    provider: 'google',
    stage: 'draft',
    settings,
    content: null,
    review: null,
    recent: [],
  };
  for (const body of [
    'x'.repeat(70000),
    'not json',
    JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }),
  ])
    await expect(
      providerClient({ GOOGLE_API_KEY: 'mock-google' }, async () => new Response(body))(input),
    ).rejects.toMatchObject({
      code: 'invalid',
    });
});
it('cross-day unresolved automated delivery blocks later automated API calls until resolved', async () => {
  const first = await completed();
  now = first.due_at;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => now,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: 'mock timeout' }),
  });
  now = first.due_at + 86400000 - 3600000;
  runtime.ai = async (r) =>
    r.stage === 'review' ? good : { ...draft, expression: 'See you later' };
  await tick();
  await tick(60000);
  await tick(60000);
  await tick(120000);
  expect((await settingsView(env)).reason).toBe('unresolved');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(1);
  const id = await env.DB.prepare("SELECT id FROM deliveries WHERE state='unknown'").first<string>(
    'id',
  );
  expect(id).toBeTruthy();
  // Existing manual resolution remains available; it never resumes automation by itself.
  await resolveUnknown(id!, 'abandon', h.env, now);
  expect((await settingsView(env)).enabled).toBe(false);
});
