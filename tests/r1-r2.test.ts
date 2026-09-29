import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ScheduleInput } from '../src/shared/model';
import { accessToken } from '../src/worker/auth';
import { encrypt } from '../src/worker/crypto';
import { resolveUnknown, runEngine } from '../src/worker/engine';
import { deleteImage } from '../src/worker/storage';
import { deliveryPage } from '../src/worker/catalog';
import { resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import { harness, harnessThrough, NOW, readyCard, type Harness } from './helpers';

let h: Harness;
const due: number = NOW + 300_000;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});

async function repeat(): Promise<{ id: string; data: ScheduleInput }> {
  const assets = await Promise.all([
    readyCard(h.env, NOW - 300_000),
    readyCard(h.env, NOW - 300_000),
  ]);
  const data: ScheduleInput = {
    name: '복구 검증',
    kind: 'daily',
    date: '2026-09-28',
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: 1,
    asset_ids: assets.map((asset) => asset.assetId),
  };
  return { ...(await saveSchedule(data, null, null, h.env, NOW)), data };
}
async function uncertain(): Promise<{ id: string; data: ScheduleInput }> {
  const schedule = await repeat();
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => due,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: '응답 유실' }),
  });
  return schedule;
}
async function credentials(): Promise<void> {
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?, ?,1,'connected')",
  )
    .bind(
      await encrypt('access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW - 1,
      NOW + 86400_000,
    )
    .run();
}
it('R1 결과 불명 이후 재개는 원자적으로 거부하고 버전을 유지한다', async () => {
  const { id } = await uncertain();
  await stopSchedule(id, 1, 'paused', h.env, due + 1000);
  await expect(resumeSchedule(id, 1, h.env, due + 2000)).rejects.toMatchObject({
    code: 'SCHEDULE_UNRESOLVED',
  });
  expect(
    await h.env.DB.prepare('SELECT version,enabled,reason FROM schedules WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ version: 1, enabled: 0, reason: 'paused' });
});
it('R1 결과 불명 이후 수정은 원자적으로 거부하고 버전을 유지한다', async () => {
  const { id, data } = await uncertain();
  await expect(
    saveSchedule({ ...data, time: '12:10' }, id, { version: 1, cursor: 1 }, h.env, due + 1000),
  ).rejects.toMatchObject({ code: 'SCHEDULE_UNRESOLVED' });
  expect(
    await h.env.DB.prepare('SELECT version FROM schedules WHERE id=?').bind(id).first('version'),
  ).toBe(1);
});
it('R2 명시적 503은 HTTP 원인과 연결·미래 예약을 보존한다', async () => {
  const { id } = await repeat();
  await credentials();
  await expect(
    accessToken(h.env, NOW, async () =>
      Response.json({ error: 'temporarily_unavailable' }, { status: 503 }),
    ),
  ).rejects.toMatchObject({
    code: 'TOKEN_TEMPORARY',
    status: 503,
    tokenFailure: 'transient',
    httpStatus: 503,
    providerError: 'temporarily_unavailable',
  });
  expect(await h.env.DB.prepare('SELECT status FROM credentials').first('status')).toBe(
    'connected',
  );
  expect(
    await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
  ).toEqual({ enabled: 1, reason: null });
});

async function unknownId(): Promise<string> {
  const row = await h.env.DB.prepare(
    "SELECT id FROM deliveries WHERE state='unknown' AND resolution IS NULL",
  ).first<{ id: string }>();
  if (!row) throw new Error('결과 불명 fixture가 없습니다.');
  return row.id;
}
it.each(['confirm_sent', 'retry'] as const)(
  'R1 기존 결과 확인 %s는 유효한 예약에서 유지한다',
  async (action) => {
    await uncertain();
    const id: string = await unknownId();
    await resolveUnknown(id, action, h.env, due + 1000);
    let calls: number = 0;
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => due + 2000,
      token: async () => 'mock',
      sender: async () => {
        calls += 1;
        return { outcome: 'mock_sent', detail: '모의 접수' };
      },
    });
    expect(calls).toBe(action === 'retry' ? 1 : 0);
    expect(
      await h.env.DB.prepare('SELECT confirmed_by_user FROM deliveries WHERE id=?')
        .bind(id)
        .first('confirmed_by_user'),
    ).toBe(action === 'confirm_sent' ? 1 : 0);
    expect(await h.env.DB.prepare('SELECT count(*) FROM manual_decisions').first('count(*)')).toBe(
      1,
    );
  },
);
it.each(['paused', 'cancelled'] as const)(
  'R1 %s 예약의 재전송 포기는 원래 결과를 보존하며 자동 활성화하지 않는다',
  async (reason) => {
    const { id } = await uncertain();
    const deliveryId: string = await unknownId();
    const assetId: string = (await h.env.DB.prepare('SELECT asset_id FROM deliveries').first(
      'asset_id',
    ))!;
    await stopSchedule(id, 1, reason, h.env, due + 1000);
    await expect(deleteImage(assetId, h.env, due + 1500)).rejects.toThrow('asset_in_use');
    await resolveUnknown(deliveryId, 'abandon', h.env, due + 2000);
    expect(
      await h.env.DB.prepare(
        'SELECT state,resolution,confirmed_by_user,error,attempts FROM deliveries',
      ).first(),
    ).toEqual({
      state: 'unknown',
      resolution: 'abandoned',
      confirmed_by_user: 0,
      error: '응답 유실',
      attempts: 1,
    });
    expect(await h.env.DB.prepare('SELECT enabled,reason,version FROM schedules').first()).toEqual({
      enabled: 0,
      reason,
      version: 1,
    });
    expect(
      await h.env.DB.prepare(
        'SELECT state,accepted,confirmed,abandoned FROM occurrence_results',
      ).first(),
    ).toEqual({ state: 'abandoned', accepted: 0, confirmed: 0, abandoned: 1 });
    expect((await deliveryPage(h.env, null)).items[0]?.resolution).toBe('abandoned');
    await deleteImage(assetId, h.env, due + 3000);
    expect(await h.env.DB.prepare('SELECT outcome,detail FROM delivery_attempts').first()).toEqual({
      outcome: 'unknown',
      detail: '응답 유실',
    });
  },
);
it('R1 중복 종료와 동시 Cron은 판단 이력을 한 번만 남기고 원래 카드를 재발송하지 않는다', async () => {
  await uncertain();
  const id: string = await unknownId();
  let calls: number = 0;
  const runtime = {
    mode: 'mock' as const,
    clock: () => due + 86400_000,
    token: async () => 'mock',
    sender: async () => {
      calls += 1;
      return { outcome: 'mock_sent' as const, detail: '다음 카드 모의 접수' };
    },
  };
  const outcomes = await Promise.allSettled([
    resolveUnknown(id, 'abandon', h.env, due + 86400_000),
    resolveUnknown(id, 'abandon', h.env, due + 86400_000),
    runEngine(h.env, runtime),
  ]);
  expect(outcomes.slice(0, 2).filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(await h.env.DB.prepare('SELECT count(*) FROM manual_decisions').first('count(*)')).toBe(1);
  await Promise.all([runEngine(h.env, runtime), runEngine(h.env, runtime)]);
  expect(calls).toBe(1);
  expect(
    await h.env.DB.prepare('SELECT state,resolution FROM deliveries WHERE id=?').bind(id).first(),
  ).toEqual({ state: 'unknown', resolution: 'abandoned' });
  await expect(resolveUnknown(id, 'retry', h.env, due + 86400_001)).rejects.toMatchObject({
    code: 'NOT_UNKNOWN',
  });
});
it('R1 수정 조회 후 발송이 시작되는 경합도 DB에서 차단한다', async () => {
  const { id, data } = await repeat();
  const db: D1Database = new Proxy(h.env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          await runEngine(h.env, {
            mode: 'mock',
            clock: () => due,
            token: async () => 'mock',
            sender: async () => ({ outcome: 'unknown', detail: '응답 유실' }),
          });
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    saveSchedule(
      { ...data, time: '12:10' },
      id,
      { version: 1, cursor: 1 },
      { ...h.env, DB: db },
      due + 1000,
    ),
  ).rejects.toMatchObject({ code: 'SCHEDULE_UNRESOLVED' });
  expect(await h.env.DB.prepare('SELECT version FROM schedules').first('version')).toBe(1);
});
it('R1 sending 동안 버전 변경은 막고 일시정지·취소와 늦은 결과 보존은 허용한다', async () => {
  const { id, data } = await repeat();
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => due,
    token: async () => 'mock',
    sender: async () => {
      await expect(
        saveSchedule({ ...data, time: '12:10' }, id, { version: 1, cursor: 1 }, h.env, due),
      ).rejects.toMatchObject({ code: 'SCHEDULE_UNRESOLVED' });
      await stopSchedule(id, 1, 'paused', h.env, due);
      await expect(resumeSchedule(id, 1, h.env, due)).rejects.toMatchObject({
        code: 'SCHEDULE_UNRESOLVED',
      });
      await stopSchedule(id, 1, 'cancelled', h.env, due);
      return { outcome: 'unknown', detail: '늦은 응답 불명' };
    },
  });
  expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('unknown');
  expect(await h.env.DB.prepare('SELECT reason FROM schedules').first('reason')).toBe('cancelled');
});
it('R1 기존 DB의 이전 버전 unknown과 이력은 마이그레이션 후 종료하여 다음 회차를 보낸다', async () => {
  await h.mf.dispose();
  h = await harnessThrough('0006_upload_cleanup_accounting.sql');
  const { id } = await repeat();
  await credentials();
  await h.env.DB.exec(
    `INSERT INTO occurrences SELECT 'legacy-occurrence',id,1,next_run_at_utc,'mock',${NOW} FROM schedules; INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,updated_at) SELECT 'legacy-unknown','legacy-occurrence',schedule_id,1,position,asset_id,payload,'unknown','mock',${due},${due} FROM schedule_items WHERE position=0; INSERT INTO delivery_attempts VALUES('legacy-attempt','legacy-unknown','legacy-owner',${due},'2026-09-28','unknown','응답 유실','mock'); INSERT INTO manual_decisions VALUES('legacy-decision','legacy-unknown','retry',${NOW},1); UPDATE schedules SET version=2,cursor=0,next_run_at_utc=${due + 86400_000}; INSERT INTO schedule_items SELECT schedule_id,2,0,asset_id,payload FROM schedule_items WHERE position=1 AND version=1;`,
  );
  const before = await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all();
  const delivery = await h.env.DB.prepare('SELECT * FROM deliveries').first();
  const credential = await h.env.DB.prepare('SELECT * FROM credentials').first();
  for (const name of ['0007_unknown_resolution.sql', '0008_token_refresh_recovery.sql']) {
    await h.env.DB.exec(
      (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).replaceAll(
        '\n',
        ' ',
      ),
    );
  }
  expect(
    (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results,
  ).toEqual(before.results);
  expect(await h.env.DB.prepare('SELECT * FROM deliveries').first()).toMatchObject({
    ...delivery,
    resolution: null,
  });
  expect(await h.env.DB.prepare('SELECT * FROM credentials').first()).toMatchObject({
    ...credential,
    refresh_attempts: 0,
    refresh_failure: null,
  });
  expect(await h.env.DB.prepare('SELECT action FROM manual_decisions').first('action')).toBe(
    'retry',
  );
  expect((await h.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  let calls: number = 0;
  const runtime = {
    mode: 'mock' as const,
    clock: () => due + 86400_000,
    token: async () => 'mock',
    sender: async () => {
      calls += 1;
      return { outcome: 'mock_sent' as const, detail: '다음 회차' };
    },
  };
  await runEngine(h.env, runtime);
  expect(calls).toBe(0);
  await expect(resolveUnknown('legacy-unknown', 'retry', h.env, due)).rejects.toMatchObject({
    code: 'SCHEDULE_INACTIVE',
  });
  await resolveUnknown('legacy-unknown', 'abandon', h.env, due + 86400_000);
  await runEngine(h.env, runtime);
  expect(calls).toBe(1);
  expect(
    await h.env.DB.prepare('SELECT version FROM schedules WHERE id=?').bind(id).first('version'),
  ).toBe(2);
  expect(
    await h.env.DB.prepare('SELECT outcome FROM delivery_attempts WHERE id=?')
      .bind('legacy-attempt')
      .first('outcome'),
  ).toBe('unknown');
  expect(await h.env.DB.prepare('SELECT count(*) FROM manual_decisions').first('count(*)')).toBe(2);
});
