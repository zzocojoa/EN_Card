import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runEngine } from '../src/worker/engine';
import production from '../src/worker/index';
import delivery from '../src/worker/delivery-service';
import { encrypt } from '../src/worker/crypto';
import { decideRecovery, recoveryPreview } from '../src/worker/pause-recovery';
import { resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import type { SendResult } from '../src/shared/model';
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
it('R8 취소 뒤 거절은 일시정지 복구 후보를 만들지 않는다', async () => {
  const id = await finishPaused('retry', 'cancelled');
  expect((await recoveryPreview(id, 1, h.env)).items).toHaveLength(0);
  expect(
    await h.env.DB.prepare('SELECT reason FROM schedules WHERE id=?').bind(id).first('reason'),
  ).toBe('cancelled');
});
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
it.each([
  { status: 429, code: -10, newConnection: false },
  { status: 401, code: -401, newConnection: false },
  { status: 403, code: -402, newConnection: false },
  { status: 403, code: -402, newConnection: true },
])(
  'R8 운영 Cron→HTTP 발송 Worker의 $status/$code 응답 경합·새 연결 $newConnection도 복구 후보로 남긴다',
  async ({ status, code, newConnection }) => {
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
        await stopSchedule(id, 1, 'paused', env, NOW);
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
    expect((await recoveryPreview(id, 1, env)).items[0]).toMatchObject({
      state: 'cancelled',
      available: true,
    });
    await expect(
      resumeSchedule(id, 1, { ...env, SEND_MODE: 'dry_run' }, NOW),
    ).rejects.toMatchObject({ code: 'RECOVERY_DECISION_REQUIRED' });
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
