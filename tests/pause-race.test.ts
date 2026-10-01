import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareEngine, runEngine } from '../src/worker/engine';
import production from '../src/worker/index';
import delivery from '../src/worker/delivery-service';
import { accessToken, disconnect, markReconnect } from '../src/worker/auth';
import { encrypt } from '../src/worker/crypto';
import { deleteImage } from '../src/worker/storage';
import { decideRecovery, recoveryPreview } from '../src/worker/pause-recovery';
import { resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import { LIMITS, type SendResult } from '../src/shared/model';
import type { Env } from '../src/worker/types';
import { harness, NOW, readyCard, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await h.mf.dispose();
});
async function prepared(): Promise<string> {
  const asset = await readyCard(h.env, NOW - 300_000);
  const next = await readyCard(h.env, NOW - 300_000);
  return (
    await saveSchedule(
      {
        name: 'R8 응답 경합',
        kind: 'daily',
        date: '2026-09-28',
        time: '12:00',
        end_date: null,
        weekdays: [],
        cards_per_occurrence: 1,
        asset_ids: [asset.assetId, next.assetId],
      },
      null,
      null,
      h.env,
      NOW - 300_000,
    )
  ).id;
}
async function finishPaused(
  outcome: SendResult['outcome'],
  reason: 'paused' | 'cancelled' = 'paused',
): Promise<string> {
  const id = await prepared();
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => {
      await stopSchedule(id, 1, reason, h.env, NOW);
      await expect(resumeSchedule(id, 1, h.env, NOW)).rejects.toMatchObject({
        code: 'SCHEDULE_UNRESOLVED',
      });
      return { outcome, detail: '모의 확정 응답' };
    },
  });
  return id;
}
it.each(['retry', 'unauthorized', 'reconnect', 'failed'] as const)(
  'R8 일시정지 뒤 %s 거절 응답은 복구 결정 전 재개를 막는다',
  async (outcome) => {
    const id = await finishPaused(outcome);
    const plan = await recoveryPreview(id, 1, h.env);
    expect(plan).toMatchObject({ pending_count: 1, unresolved: false, remaining: 1 });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ state: 'cancelled', available: true, decision: null });
    expect(
      await h.env.DB.prepare('SELECT cancellation_reason FROM deliveries').first(
        'cancellation_reason',
      ),
    ).toBe('paused');
    expect(
      await h.env.DB.prepare('SELECT claim_owner,claim_until,retry_at FROM deliveries').first(),
    ).toEqual({ claim_owner: null, claim_until: null, retry_at: null });
    expect(await h.env.DB.prepare('SELECT outcome FROM delivery_attempts').first('outcome')).toBe(
      outcome === 'retry' || outcome === 'unauthorized'
        ? 'retry_wait'
        : outcome === 'reconnect'
          ? 'blocked'
          : 'failed',
    );
    await expect(resumeSchedule(id, 1, h.env, NOW)).rejects.toMatchObject({
      code: 'RECOVERY_DECISION_REQUIRED',
    });
    const original = (await h.env.DB.prepare('SELECT * FROM delivery_attempts').all()).results;
    if (outcome === 'retry') {
      const result = await decideRecovery(
        id,
        {
          version: 1,
          recover_ids: [plan.items[0]!.delivery_id],
          exclude_ids: [],
          date: '2026-09-28',
          time: '12:10',
          warning_accepted: true,
        },
        h.env,
        NOW,
      );
      expect(result.recovered).toBe(1);
    } else {
      await decideRecovery(
        id,
        {
          version: 1,
          recover_ids: [],
          exclude_ids: [plan.items[0]!.delivery_id],
          date: null,
          time: null,
          warning_accepted: true,
        },
        h.env,
        NOW,
      );
    }
    await resumeSchedule(id, 1, h.env, NOW);
    expect(
      await h.env.DB.prepare(
        'SELECT count(*) FROM schedule_items WHERE schedule_id=? AND version=2',
      )
        .bind(id)
        .first('count(*)'),
    ).toBe(1);
    expect((await h.env.DB.prepare('SELECT * FROM delivery_attempts').all()).results).toEqual(
      original,
    );
  },
);

function pauseAfterBudget(
  db: D1Database,
  onReleaseCheck?: () => Promise<void>,
): {
  db: D1Database;
  inserted: Promise<void>;
  release: () => void;
} {
  let signal!: () => void;
  let release!: () => void;
  const inserted = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  let checked = false;
  function statement(source: D1PreparedStatement, sql: string): D1PreparedStatement {
    return new Proxy(source, {
      get(target, key) {
        if (key === 'bind') return (...values: unknown[]) => statement(target.bind(...values), sql);
        if (key === 'first')
          return async (column?: string) => {
            const result: unknown =
              column === undefined ? await target.first() : await target.first(column);
            if (!paused && sql.startsWith('INSERT INTO delivery_attempts') && result) {
              paused = true;
              signal();
              await released;
            }
            if (
              onReleaseCheck &&
              !checked &&
              sql.includes(' AS needs_reconnect FROM deliveries') &&
              result
            ) {
              checked = true;
              await onReleaseCheck();
            }
            return result;
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  return {
    db: new Proxy(db, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => statement(target.prepare(sql), sql);
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    inserted,
    release,
  };
}
async function connectedEnv(): Promise<Env> {
  const token = await encrypt('synthetic-r13-token', h.env.TOKEN_ENCRYPTION_KEY);
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'r13',?,?,?,?,1,'connected')",
  )
    .bind(token, token, NOW + 3600_000, NOW + 86400_000)
    .run();
  return { ...h.env, SEND_MODE: 'live' };
}
async function restoreConnection(env: Env, now: number): Promise<void> {
  const token = await encrypt('synthetic-r13-reconnected-token', env.TOKEN_ENCRYPTION_KEY);
  // Match successful OAuth persistence using synthetic tokens; no provider call is needed.
  await env.DB.prepare(
    "UPDATE credentials SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,version=version+1,status='connected',lock_owner=NULL,lock_until=NULL,refresh_attempts=0,refresh_retry_at=NULL,refresh_failure=NULL,refresh_http_status=NULL,refresh_provider_error=NULL,refresh_provider_code=NULL WHERE singleton=1 AND owner_id='r13'",
  )
    .bind(token, token, now + 3600_000, now + 86400_000)
    .run();
}
async function unexpectedTransport(): Promise<Response> {
  throw new Error('R13 테스트의 유효한 모의 토큰은 외부 갱신을 호출하지 않습니다.');
}
it('R13 예산 기록 뒤 재연결 필요 경합은 동일 카드를 보존하고 재개 뒤 한 번만 보낸다', async () => {
  const id = await prepared();
  const connected = await connectedEnv();
  const barrier = pauseAfterBudget(connected.DB);
  const env: Env = { ...connected, DB: barrier.db };
  let now = NOW;
  const sender = vi.fn(async (): Promise<SendResult> => ({ outcome: 'sent', detail: '모의 접수' }));
  const runtime = {
    mode: 'live' as const,
    clock: () => now,
    token: () => accessToken(env, now, unexpectedTransport),
    sender,
  };
  const running = runEngine(env, runtime);
  try {
    await barrier.inserted;
    expect(await connected.DB.prepare('SELECT state,attempts FROM deliveries').first()).toEqual({
      state: 'sending',
      attempts: 1,
    });
    await expect(markReconnect(connected, 1)).resolves.toBe(true);
  } finally {
    barrier.release();
    await running;
  }
  expect(sender).not.toHaveBeenCalled();
  const original = await connected.DB.prepare(
    'SELECT id,asset_id,state,cancellation_reason,claim_owner,claim_until,retry_at,due_at_utc FROM deliveries',
  ).first<{ id: string; asset_id: string }>();
  expect(original).toMatchObject({
    state: 'blocked',
    cancellation_reason: null,
    claim_owner: null,
    claim_until: null,
    retry_at: null,
    due_at_utc: NOW,
  });
  const originalAttempt = await connected.DB.prepare('SELECT * FROM delivery_attempts').first();
  expect(originalAttempt).toMatchObject({ outcome: 'blocked' });
  expect(originalAttempt?.detail).toContain('외부 API 호출 없음');
  expect(
    await connected.DB.prepare('SELECT version,reason,cursor FROM schedules WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({
    version: 1,
    reason: 'needs_reconnect',
    cursor: 1,
  });
  await runEngine(env, runtime);
  expect(sender).not.toHaveBeenCalled();
  now += 60_000;
  await restoreConnection(connected, now);
  await resumeSchedule(id, 1, connected, now);
  await runEngine(env, runtime);
  await runEngine(env, runtime);
  expect(sender).toHaveBeenCalledTimes(1);
  expect(
    await connected.DB.prepare('SELECT id,asset_id,state,attempts FROM deliveries').first(),
  ).toEqual({
    id: original!.id,
    asset_id: original!.asset_id,
    state: 'sent',
    attempts: 2,
  });
  const attempts = (
    await connected.DB.prepare('SELECT * FROM delivery_attempts ORDER BY started_at').all()
  ).results;
  expect(attempts.map((attempt) => attempt.outcome)).toEqual(['blocked', 'sent']);
  expect(attempts[0]).toEqual(originalAttempt);
  expect(
    await connected.DB.prepare('SELECT version,cursor FROM schedules WHERE id=?').bind(id).first(),
  ).toEqual({
    version: 1,
    cursor: 1,
  });
});
it('R13 인증 대기 중 15분이 지난 카드는 missed로 끝내고 재연결 뒤 자동 발송하지 않는다', async () => {
  const id = await prepared();
  const connected = await connectedEnv();
  const barrier = pauseAfterBudget(connected.DB);
  const env: Env = { ...connected, DB: barrier.db };
  let now = NOW;
  const sender = vi.fn(async (): Promise<SendResult> => ({ outcome: 'sent', detail: '모의 접수' }));
  const runtime = {
    mode: 'live' as const,
    clock: () => now,
    token: () => accessToken(env, now, unexpectedTransport),
    sender,
  };
  const running = runEngine(env, runtime);
  try {
    await barrier.inserted;
    await markReconnect(connected, 1);
    now = NOW + LIMITS.graceMs + 1;
  } finally {
    barrier.release();
    await running;
  }
  const original = await connected.DB.prepare('SELECT id FROM deliveries').first<{ id: string }>();
  expect(
    await connected.DB.prepare(
      'SELECT state,claim_owner,claim_until,retry_at FROM deliveries',
    ).first(),
  ).toEqual({
    state: 'missed',
    claim_owner: null,
    claim_until: null,
    retry_at: null,
  });
  expect(
    await connected.DB.prepare('SELECT outcome,detail FROM delivery_attempts').first(),
  ).toMatchObject({
    outcome: 'missed',
    detail: expect.stringContaining('외부 API 호출 없음'),
  });
  await restoreConnection(connected, now);
  await resumeSchedule(id, 1, connected, now);
  await runEngine(env, runtime);
  expect(sender).not.toHaveBeenCalled();
  expect(
    await connected.DB.prepare('SELECT state FROM deliveries WHERE id=?')
      .bind(original!.id)
      .first('state'),
  ).toBe('missed');
  expect(
    await connected.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)'),
  ).toBe(1);
});
it.each(['paused', 'cancelled', 'disconnected'] as const)(
  'R13 예산 기록 뒤 명시적인 %s 중지는 재연결 경합과 구별해 취소한다',
  async (reason) => {
    const id = await prepared();
    const connected = await connectedEnv();
    const barrier = pauseAfterBudget(connected.DB);
    const env: Env = { ...connected, DB: barrier.db };
    const sender = vi.fn(async (): Promise<SendResult> => ({
      outcome: 'sent',
      detail: '모의 접수',
    }));
    const running = runEngine(env, {
      mode: 'live',
      clock: () => NOW,
      token: () => accessToken(env, NOW, unexpectedTransport),
      sender,
    });
    try {
      await barrier.inserted;
      await markReconnect(connected, 1);
      if (reason === 'disconnected') await disconnect(connected, NOW);
      else await stopSchedule(id, 1, reason, connected, NOW);
    } finally {
      barrier.release();
      await running;
    }
    expect(sender).not.toHaveBeenCalled();
    expect(
      await connected.DB.prepare(
        'SELECT state,cancellation_reason,claim_owner,claim_until,retry_at FROM deliveries',
      ).first(),
    ).toEqual({
      state: 'cancelled',
      cancellation_reason: reason,
      claim_owner: null,
      claim_until: null,
      retry_at: null,
    });
    expect(
      await connected.DB.prepare('SELECT outcome,detail FROM delivery_attempts').first(),
    ).toMatchObject({
      outcome: 'cancelled',
      detail: expect.stringContaining('외부 API 호출 없음'),
    });
    if (reason === 'paused')
      expect((await recoveryPreview(id, 1, connected)).items[0]).toMatchObject({ available: true });
    else expect((await recoveryPreview(id, 1, connected)).items).toHaveLength(0);
  },
);
it('R13 claimed 단계의 실제 버전 수정은 이전 카드를 취소하고 호출 예산을 쓰지 않는다', async () => {
  const id = await prepared();
  const env = await connectedEnv();
  const asset = await env.DB.prepare(
    'SELECT asset_id FROM schedule_items WHERE schedule_id=? AND version=1 AND position=1',
  )
    .bind(id)
    .first<string>('asset_id');
  const sender = vi.fn(async (): Promise<SendResult> => ({ outcome: 'sent', detail: '모의 접수' }));
  await runEngine(env, {
    mode: 'live',
    clock: () => NOW,
    token: async () => {
      // Real schedule edits are allowed while claimed; sending is protected by the DB trigger.
      await saveSchedule(
        {
          name: 'R13 수정한 예약',
          kind: 'daily',
          date: '2026-09-28',
          time: '12:10',
          end_date: null,
          weekdays: [],
          cards_per_occurrence: 1,
          asset_ids: [asset!],
        },
        id,
        { version: 1, cursor: 1 },
        env,
        NOW,
      );
      return accessToken(env, NOW, unexpectedTransport);
    },
    sender,
  });
  expect(sender).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare(
      'SELECT state,cancellation_reason,claim_owner,claim_until FROM deliveries',
    ).first(),
  ).toEqual({
    state: 'cancelled',
    cancellation_reason: 'schedule_changed',
    claim_owner: null,
    claim_until: null,
  });
  expect(await env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(0);
  expect(
    await env.DB.prepare('SELECT version FROM schedules WHERE id=?').bind(id).first('version'),
  ).toBe(2);
});
it.each([
  ['paused', false],
  ['cancelled', false],
  ['disconnected', false],
  ['paused', true],
  ['cancelled', true],
  ['disconnected', true],
] as const)(
  'R13 인증 대기 조회 직후 %s 중지는 지연 여부(%s)와 관계없이 원자적으로 취소한다',
  async (reason, late) => {
    const id = await prepared();
    const connected = await connectedEnv();
    let checked = false;
    let now = NOW;
    let originalAttempt: Record<string, unknown> | null = null;
    let originalUsage: unknown;
    let originalTicks: unknown;
    const barrier = pauseAfterBudget(connected.DB, async () => {
      checked = true;
      expect(await connected.DB.prepare('SELECT state FROM deliveries').first('state')).toBe(
        'sending',
      );
      if (reason === 'disconnected') await disconnect(connected, now);
      else await stopSchedule(id, 1, reason, connected, now);
    });
    const env: Env = { ...connected, DB: barrier.db };
    const sender = vi.fn(async (): Promise<SendResult> => ({
      outcome: 'sent',
      detail: '모의 접수',
    }));
    const running = runEngine(env, {
      mode: 'live',
      clock: () => now,
      token: () => accessToken(env, now, unexpectedTransport),
      sender,
    });
    try {
      await barrier.inserted;
      await markReconnect(connected, 1);
      originalAttempt = await connected.DB.prepare('SELECT * FROM delivery_attempts').first();
      originalUsage = (
        await connected.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()
      ).results;
      originalTicks = (await connected.DB.prepare('SELECT * FROM tick_limits ORDER BY tick').all())
        .results;
      if (late) now = NOW + LIMITS.graceMs + 1;
    } finally {
      barrier.release();
      await running;
    }
    expect(checked).toBe(true);
    expect(sender).not.toHaveBeenCalled();
    expect(
      await connected.DB.prepare(
        'SELECT state,cancellation_reason,claim_owner,claim_until,retry_at FROM deliveries',
      ).first(),
    ).toEqual({
      state: 'cancelled',
      cancellation_reason: reason,
      claim_owner: null,
      claim_until: null,
      retry_at: null,
    });
    expect(await connected.DB.prepare('SELECT * FROM delivery_attempts').first()).toEqual({
      ...originalAttempt,
      outcome: 'cancelled',
      detail: '호출 전에 예약 중지·수정을 확인했습니다. 외부 API 호출 없음.',
    });
    expect(
      (await connected.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results,
    ).toEqual(originalUsage);
    expect(
      (await connected.DB.prepare('SELECT * FROM tick_limits ORDER BY tick').all()).results,
    ).toEqual(originalTicks);
    if (reason === 'paused')
      expect((await recoveryPreview(id, 1, connected)).items[0]).toMatchObject({ available: true });
    else expect((await recoveryPreview(id, 1, connected)).items).toHaveLength(0);
  },
);
it('R13 인증 대기 조회 직후 claimed 버전 수정의 취소 원인과 예산을 보존한다', async () => {
  const id = await prepared();
  const connected = await connectedEnv();
  const asset = await connected.DB.prepare(
    'SELECT asset_id FROM schedule_items WHERE schedule_id=? AND version=1 AND position=1',
  )
    .bind(id)
    .first<string>('asset_id');
  let checked = false;
  const barrier = pauseAfterBudget(connected.DB, async () => {
    checked = true;
    expect(await connected.DB.prepare('SELECT state FROM deliveries').first('state')).toBe(
      'claimed',
    );
    await saveSchedule(
      {
        name: 'R13 조회 직후 수정한 예약',
        kind: 'daily',
        date: '2026-09-28',
        time: '12:10',
        end_date: null,
        weekdays: [],
        cards_per_occurrence: 1,
        asset_ids: [asset!],
      },
      id,
      { version: 1, cursor: 1 },
      connected,
      NOW,
    );
  });
  const env: Env = { ...connected, DB: barrier.db };
  const sender = vi.fn(async (): Promise<SendResult> => ({ outcome: 'sent', detail: '모의 접수' }));
  await runEngine(env, {
    mode: 'live',
    clock: () => NOW,
    token: async () => {
      const grant = await accessToken(connected, NOW, unexpectedTransport);
      await markReconnect(connected, grant.version);
      await restoreConnection(connected, NOW);
      return grant;
    },
    sender,
  });
  expect(checked).toBe(true);
  expect(sender).not.toHaveBeenCalled();
  expect(
    await connected.DB.prepare(
      'SELECT state,cancellation_reason,claim_owner,claim_until,retry_at FROM deliveries',
    ).first(),
  ).toEqual({
    state: 'cancelled',
    cancellation_reason: 'schedule_changed',
    claim_owner: null,
    claim_until: null,
    retry_at: null,
  });
  expect(
    await connected.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)'),
  ).toBe(0);
  expect(await connected.DB.prepare('SELECT count(*) FROM tick_limits').first('count(*)')).toBe(0);
  expect(
    await connected.DB.prepare('SELECT sum(sends) FROM usage_counters').first('sum(sends)'),
  ).toBe(0);
  expect(
    await connected.DB.prepare('SELECT version FROM schedules WHERE id=?')
      .bind(id)
      .first('version'),
  ).toBe(2);
});
it('R13 호출 전 정리 중 다른 Cron이 기록한 unknown 호출 이력을 덮어쓰지 않는다', async () => {
  await prepared();
  const connected = await connectedEnv();
  let recoveredAttempt: Record<string, unknown> | null = null;
  const barrier = pauseAfterBudget(connected.DB, async () => {
    await prepareEngine(connected, NOW + LIMITS.claimMs + 1, 'live');
    recoveredAttempt = await connected.DB.prepare('SELECT * FROM delivery_attempts').first();
    expect(recoveredAttempt?.outcome).toBe('unknown');
  });
  const env: Env = { ...connected, DB: barrier.db };
  const sender = vi.fn(async (): Promise<SendResult> => ({ outcome: 'sent', detail: '모의 접수' }));
  const running = runEngine(env, {
    mode: 'live',
    clock: () => NOW,
    token: () => accessToken(env, NOW, unexpectedTransport),
    sender,
  });
  try {
    await barrier.inserted;
    await markReconnect(connected, 1);
  } finally {
    barrier.release();
    await running;
  }
  expect(sender).not.toHaveBeenCalled();
  expect(recoveredAttempt).not.toBeNull();
  expect(await connected.DB.prepare('SELECT * FROM delivery_attempts').first()).toEqual(
    recoveredAttempt,
  );
  expect(
    await connected.DB.prepare('SELECT state,claim_owner,claim_until FROM deliveries').first(),
  ).toEqual({ state: 'unknown', claim_owner: null, claim_until: null });
});
it.each(['mock_sent', 'unknown'] as const)(
  'R8 일시정지 뒤 %s 결과는 미발송 복구 대상으로 바꾸지 않는다',
  async (outcome) => {
    const id = await finishPaused(outcome);
    expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe(outcome);
    expect((await recoveryPreview(id, 1, h.env)).items).toHaveLength(0);
    if (outcome === 'unknown')
      await expect(resumeSchedule(id, 1, h.env, NOW)).rejects.toMatchObject({
        code: 'SCHEDULE_UNRESOLVED',
      });
    else await resumeSchedule(id, 1, h.env, NOW);
  },
);
it.each(['retry', 'unauthorized', 'reconnect', 'failed'] as const)(
  'R10 취소 뒤 %s 거절은 호출 이력을 보존하고 이미지를 정리할 수 있다',
  async (outcome) => {
    const id = await finishPaused(outcome, 'cancelled');
    expect(
      await h.env.DB.prepare('SELECT cancellation_reason FROM deliveries').first(
        'cancellation_reason',
      ),
    ).toBe('cancelled');
    expect((await recoveryPreview(id, 1, h.env)).items).toHaveLength(0);
    expect(
      await h.env.DB.prepare('SELECT reason FROM schedules WHERE id=?').bind(id).first('reason'),
    ).toBe('cancelled');
    const item = await h.env.DB.prepare(
      'SELECT state,asset_id,claim_owner,claim_until,retry_at FROM deliveries WHERE schedule_id=?',
    )
      .bind(id)
      .first<{
        state: string;
        asset_id: string;
        claim_owner: string | null;
        claim_until: number | null;
        retry_at: number | null;
      }>();
    expect(item).toMatchObject({
      state: 'cancelled',
      claim_owner: null,
      claim_until: null,
      retry_at: null,
    });
    expect(await h.env.DB.prepare('SELECT outcome FROM delivery_attempts').first('outcome')).toBe(
      outcome === 'retry' || outcome === 'unauthorized'
        ? 'retry_wait'
        : outcome === 'reconnect'
          ? 'blocked'
          : 'failed',
    );
    await expect(deleteImage(item!.asset_id, h.env, NOW)).resolves.toBeUndefined();
  },
);
it.each(['mock_sent', 'unknown'] as const)(
  'R10 취소 뒤 %s 결과는 원래 결과와 이미지 보호 정책을 보존한다',
  async (outcome) => {
    const id = await finishPaused(outcome, 'cancelled');
    const item = await h.env.DB.prepare('SELECT state,asset_id FROM deliveries WHERE schedule_id=?')
      .bind(id)
      .first<{ state: string; asset_id: string }>();
    expect(item?.state).toBe(outcome);
    expect(
      await h.env.DB.prepare('SELECT cancellation_reason FROM deliveries').first(
        'cancellation_reason',
      ),
    ).toBeNull();
    expect((await recoveryPreview(id, 1, h.env)).items).toHaveLength(0);
    if (outcome === 'unknown')
      await expect(deleteImage(item!.asset_id, h.env, NOW)).rejects.toThrow('asset_in_use');
    else await expect(deleteImage(item!.asset_id, h.env, NOW)).resolves.toBeUndefined();
  },
);
it.each(['retry', 'unauthorized'] as const)(
  'R8 %s 재시도 소진 중 일시정지도 원래 모든 호출 이력으로 복구 여부를 판단한다',
  async (outcome) => {
    const id = await prepared();
    let calls = 0;
    let now = NOW;
    const total = outcome === 'retry' ? 3 : 2;
    const runtime = {
      mode: 'mock' as const,
      clock: () => now,
      token: async () => 'mock',
      sender: async () => {
        calls++;
        if (calls === total) await stopSchedule(id, 1, 'paused', h.env, now);
        return { outcome, detail: '확정 미접수' };
      },
    };
    for (const offset of [0, 60_000, 180_000]) {
      now = NOW + offset;
      await runEngine(h.env, runtime);
    }
    expect(calls).toBe(total);
    expect((await recoveryPreview(id, 1, h.env)).items[0]).toMatchObject({
      state: 'cancelled',
      available: true,
    });
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      total,
    );
  },
);
it.each(
  [
    { status: 429, code: -10, newConnection: false },
    { status: 401, code: -401, newConnection: false },
    { status: 403, code: -402, newConnection: false },
    { status: 403, code: -402, newConnection: true },
  ].flatMap((item) => (['paused', 'cancelled'] as const).map((reason) => ({ ...item, reason }))),
)(
  'R8·R10 운영 Cron→HTTP 발송 Worker의 $status/$code 응답·새 연결 $newConnection·중지 $reason을 보존한다',
  async ({ status, code, newConnection, reason }) => {
    const id = await prepared();
    const token = await encrypt('synthetic-r8-token', h.env.TOKEN_ENCRYPTION_KEY);
    await h.env.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'r8',?,?,?,?,1,'connected')",
    )
      .bind(token, token, NOW + 3600_000, NOW + 86400_000)
      .run();
    const env: Env = { ...h.env, SEND_MODE: 'live' };
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    let calls = 0;
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://kapi.kakao.com/v2/api/talk/memo/default/send') {
        calls++;
        await stopSchedule(id, 1, reason, env, NOW);
        if (newConnection)
          await env.DB.prepare("UPDATE credentials SET version=2,status='connected'").run();
        return Response.json({ code }, { status });
      }
      return original(input, init);
    });
    env.DELIVERY_SERVICE = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
        delivery.fetch(input instanceof Request ? input : new Request(input, init), env),
    } as unknown as Fetcher;
    await production.scheduled({} as ScheduledController, env);
    expect(calls).toBe(1);
    if (reason === 'paused') {
      expect((await recoveryPreview(id, 1, env)).items[0]).toMatchObject({
        state: 'cancelled',
        available: true,
      });
      await expect(
        resumeSchedule(id, 1, { ...env, SEND_MODE: 'dry_run' }, NOW),
      ).rejects.toMatchObject({ code: 'RECOVERY_DECISION_REQUIRED' });
    } else {
      expect((await recoveryPreview(id, 1, env)).items).toHaveLength(0);
      const item = await env.DB.prepare(
        'SELECT state,asset_id,claim_owner,retry_at FROM deliveries WHERE schedule_id=?',
      )
        .bind(id)
        .first<{ state: string; asset_id: string }>();
      expect(item).toMatchObject({ state: 'cancelled', claim_owner: null, retry_at: null });
      await expect(deleteImage(item!.asset_id, env, NOW)).resolves.toBeUndefined();
    }
    await production.scheduled({} as ScheduledController, env);
    expect(calls).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      1,
    );
    if (newConnection)
      expect(await env.DB.prepare('SELECT status,version FROM credentials').first()).toEqual({
        status: 'connected',
        version: 2,
      });
  },
);
