import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { RecoveryInput } from '../src/shared/model';
import { runEngine } from '../src/worker/engine';
import { decideRecovery, pausePreview, recoveryPreview } from '../src/worker/pause-recovery';
import { resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import { deleteImage, saveCard } from '../src/worker/storage';
import { harness, harnessThrough, NOW, readyCard, SAMPLE, type Harness } from './helpers';

let h: Harness;
const due: number = NOW + 300_000;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function prepared(): Promise<string> {
  const assets = await Promise.all(
    Array.from({ length: 10 }, () => readyCard(h.env, NOW - 300_000)),
  );
  return (
    await saveSchedule(
      {
        name: '10장 복구',
        kind: 'daily',
        date: '2026-09-28',
        time: '12:05',
        end_date: null,
        weekdays: [],
        cards_per_occurrence: 5,
        asset_ids: assets.map((item) => item.assetId),
      },
      null,
      null,
      h.env,
      NOW,
    )
  ).id;
}
async function tick(now: number): Promise<void> {
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => now,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'mock_sent', detail: '모의 접수' }),
  });
}
async function paused(): Promise<string> {
  const id: string = await prepared();
  await tick(due);
  const preview = await pausePreview(id, 1, h.env);
  expect(preview.items).toHaveLength(2);
  expect(preview.remaining).toBe(5);
  await stopSchedule(id, 1, 'paused', h.env, due);
  return id;
}
async function selection(id: string): Promise<RecoveryInput> {
  const plan = await recoveryPreview(id, 1, h.env);
  return {
    version: 1,
    recover_ids: plan.items.map((item) => item.delivery_id),
    exclude_ids: [],
    date: '2026-09-28',
    time: '12:10',
    warning_accepted: true,
  };
}
it('R3 미발송 2장을 새 예약으로 복구하고 기존 5장을 재개하며 보낸 3장은 재전송하지 않는다', async () => {
  const id: string = await paused();
  const original = (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY position').all())
    .results;
  const data = await selection(id);
  const result = await decideRecovery(id, data, h.env, due);
  expect(result).toMatchObject({ recovered: 2, excluded: 0 });
  expect(result.schedule_ids).toHaveLength(1);
  expect(
    (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY position').all()).results,
  ).toEqual(original);
  await resumeSchedule(id, 1, h.env, due);
  expect(
    await h.env.DB.prepare(
      'SELECT count(*) AS n FROM schedule_items WHERE schedule_id=? AND version=2',
    )
      .bind(id)
      .first('n'),
  ).toBe(5);
  await tick(due + 300_000);
  await tick(due + 86400_000);
  await tick(due + 86460_000);
  const accepted = await h.env.DB.prepare(
    "SELECT asset_id,count(*) AS n FROM deliveries WHERE state='mock_sent' GROUP BY asset_id",
  ).all<{ asset_id: string; n: number }>();
  expect(accepted.results).toHaveLength(10);
  expect(accepted.results.every((item) => item.n === 1)).toBe(true);
  expect(
    await h.env.DB.prepare(
      "SELECT count(*) AS n FROM pause_recoveries WHERE decision='reschedule'",
    ).first('n'),
  ).toBe(2);
});
it('R3 명시적 제외는 목록·이력을 남기고 기존 5장만 재개한다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  expect(
    await decideRecovery(
      id,
      { ...data, recover_ids: [], exclude_ids: data.recover_ids, date: null, time: null },
      h.env,
      due,
    ),
  ).toEqual({ schedule_ids: [], recovered: 0, excluded: 2 });
  await resumeSchedule(id, 1, h.env, due);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(1);
  expect(
    (await recoveryPreview(id, 2, h.env)).items.every((item) => item.decision === 'exclude'),
  ).toBe(true);
});
it('R3 중복 복구와 동시 Cron은 한 새 예약과 원본별 한 관계만 만든다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  const results = await Promise.allSettled([
    decideRecovery(id, data, h.env, due),
    decideRecovery(id, data, h.env, due),
    tick(due + 60_000),
  ]);
  expect(results.slice(0, 2).filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(2);
  expect(
    await h.env.DB.prepare(
      'SELECT count(*) AS n FROM pause_recoveries WHERE decision IS NOT NULL',
    ).first('n'),
  ).toBe(2);
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM deliveries WHERE state='mock_sent'").first(
      'n',
    ),
  ).toBe(3);
});
it('R3 15분이 지난 원본은 즉시 재발송하지 않고 새 미래 시각만 허용한다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  const now: number = due + 900_001;
  await expect(decideRecovery(id, data, h.env, now)).rejects.toMatchObject({
    code: 'RECOVERY_TIME',
  });
  await decideRecovery(id, { ...data, time: '13:00' }, h.env, now);
  await tick(now);
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM deliveries WHERE state='mock_sent'").first(
      'n',
    ),
  ).toBe(3);
});
it.each(['sending', 'unknown'] as const)(
  'R3 %s가 섞여 있어도 중지는 가능하지만 복구·재개는 막는다',
  async (state) => {
    const id: string = await paused();
    const data = await selection(id);
    await h.env.DB.prepare(
      "UPDATE deliveries SET state=? WHERE id=(SELECT id FROM deliveries WHERE state='mock_sent' LIMIT 1)",
    )
      .bind(state)
      .run();
    await stopSchedule(id, 1, 'paused', h.env, due);
    await expect(decideRecovery(id, data, h.env, due)).rejects.toMatchObject({
      code: 'SCHEDULE_UNRESOLVED',
    });
    await expect(resumeSchedule(id, 1, h.env, due)).rejects.toMatchObject({
      code: 'SCHEDULE_UNRESOLVED',
    });
  },
);
it.each(['unknown', 'sent', 'mock_sent'])(
  'R3 과거 %s 이력이 있는 취소 건은 자동 복구하지 않는다',
  async (outcome) => {
    const id: string = await paused();
    const data = await selection(id);
    await h.env.DB.prepare(
      "INSERT INTO delivery_attempts VALUES('old-uncertain',?,'old',?,'2026-09-28',?,'이전 호출 이력','mock')",
    )
      .bind(data.recover_ids[0], due - 60_000, outcome)
      .run();
    await h.env.DB.prepare('UPDATE deliveries SET attempts=1 WHERE id=?')
      .bind(data.recover_ids[0])
      .run();
    const preview = await recoveryPreview(id, 1, h.env);
    expect(preview.items.find((item) => item.delivery_id === data.recover_ids[0])?.available).toBe(
      false,
    );
    await expect(decideRecovery(id, data, h.env, due)).rejects.toMatchObject({
      code: 'RECOVERY_UNAVAILABLE',
    });
    expect(await h.env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(1);
  },
);
it('R3 수신 확인·sending·unknown·종료 상태는 자동 선택하지 않는다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  const cases: readonly [string, number, string | null][] = [
    ['sent', 0, null],
    ['mock_sent', 0, null],
    ['cancelled', 1, null],
    ['sending', 0, null],
    ['unknown', 0, null],
    ['unknown', 0, 'abandoned'],
  ];
  for (const [state, confirmed, resolution] of cases) {
    await h.env.DB.prepare(
      'UPDATE deliveries SET state=?,confirmed_by_user=?,resolution=? WHERE id=?',
    )
      .bind(state, confirmed, resolution, data.recover_ids[0])
      .run();
    expect(
      (await recoveryPreview(id, 1, h.env)).items.find(
        (item) => item.delivery_id === data.recover_ids[0],
      )?.available,
    ).toBe(false);
  }
});
it('R3 미리보기 후 sending 경합도 조건부 갱신에서 차단한다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  const db: D1Database = new Proxy(h.env.DB, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          await h.env.DB.prepare("UPDATE deliveries SET state='sending' WHERE id=?")
            .bind(data.recover_ids[0])
            .run();
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(decideRecovery(id, data, { ...h.env, DB: db }, due)).rejects.toMatchObject({
    code: 'RECOVERY_CHANGED',
  });
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM schedules').first('n')).toBe(1);
  expect(
    await h.env.DB.prepare(
      'SELECT count(*) AS n FROM pause_recoveries WHERE decision IS NOT NULL',
    ).first('n'),
  ).toBe(0);
});
it('R3 일시정지 후 취소해도 선택을 기록하며 취소한 원본은 활성화하지 않는다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  await stopSchedule(id, 1, 'cancelled', h.env, due);
  expect((await recoveryPreview(id, 1, h.env)).can_resume).toBe(false);
  await decideRecovery(id, data, h.env, due);
  expect(
    await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
  ).toEqual({ enabled: 0, reason: 'cancelled' });
  await expect(resumeSchedule(id, 1, h.env, due)).rejects.toThrow();
});
it('R3 고정 이미지 부재는 안내하고 선택 전 이미지는 삭제에서 보호한다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  const assetId = (await h.env.DB.prepare('SELECT asset_id FROM deliveries WHERE id=?')
    .bind(data.recover_ids[0])
    .first<string>('asset_id'))!;
  await expect(deleteImage(assetId, h.env, due)).rejects.toThrow('asset_in_use');
  await h.env.CARD_IMAGES.delete(assetId);
  expect(
    (await recoveryPreview(id, 1, h.env)).items.find(
      (item) => item.delivery_id === data.recover_ids[0],
    )?.reason,
  ).toContain('이미지');
  await expect(decideRecovery(id, data, h.env, due)).rejects.toMatchObject({
    code: 'RECOVERY_UNAVAILABLE',
  });
  await decideRecovery(id, { ...data, recover_ids: [], exclude_ids: data.recover_ids }, h.env, due);
  await deleteImage(assetId, h.env, due);
});
it('R3 원문 카드가 수정되어도 이전 고정 payload와 PNG 버전으로 복구한다', async () => {
  const id: string = await paused();
  const data = await selection(id);
  const old = (await h.env.DB.prepare(
    'SELECT d.asset_id,d.payload,a.card_id FROM deliveries d JOIN assets a ON a.id=d.asset_id WHERE d.id=?',
  )
    .bind(data.recover_ids[0])
    .first<{ asset_id: string; payload: string; card_id: string }>())!;
  await saveCard({ ...SAMPLE, expression: 'Changed' }, old.card_id, 1, h.env, due);
  const result = await decideRecovery(id, data, h.env, due);
  expect(
    await h.env.DB.prepare(
      'SELECT asset_id,payload FROM schedule_items WHERE schedule_id=? AND asset_id=?',
    )
      .bind(result.schedule_ids[0], old.asset_id)
      .first(),
  ).toEqual({ asset_id: old.asset_id, payload: old.payload });
});
it('R3 기존 0008 DB의 취소 이력을 보존하며 0009가 복구 후보를 구성한다', async () => {
  await h.mf.dispose();
  h = await harnessThrough('0008_token_refresh_recovery.sql');
  const id: string = await prepared();
  await tick(due);
  await stopSchedule(id, 1, 'paused', h.env, due);
  const original = (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results;
  const usage = (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results;
  await h.env.DB.exec(
    (
      await readFile(new URL('../migrations/0009_pause_recovery.sql', import.meta.url), 'utf8')
    ).replaceAll('\n', ' '),
  );
  expect((await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results).toEqual(
    original,
  );
  expect(
    (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results,
  ).toEqual(usage);
  expect((await h.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  expect((await recoveryPreview(id, 1, h.env)).items).toHaveLength(2);
  await decideRecovery(id, await selection(id), h.env, due);
});
