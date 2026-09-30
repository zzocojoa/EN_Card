import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { recoverySchema, type RecoveryInput } from '../src/shared/model';
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

async function accumulatedPause(count: number = 45): Promise<string> {
  await h.mf.dispose();
  h = await harnessThrough('0008_token_refresh_recovery.sql');
  const id: string = await prepared();
  const occurrences = Array.from({ length: Math.ceil(count / 5) }, (_, index) => ({
    id: crypto.randomUUID(),
    due: due - (9 - index) * 86_400_000,
  }));
  const deliveries = occurrences
    .flatMap((occurrence) =>
      Array.from({ length: 5 }, (_, position) => ({
        id: crypto.randomUUID(),
        occurrence: occurrence.id,
        due: occurrence.due,
        position,
      })),
    )
    .slice(0, count);
  await h.env.DB.batch([
    h.env.DB.prepare("UPDATE schedules SET cursor=5,enabled=0,reason='paused' WHERE id=?").bind(id),
    h.env.DB.prepare(
      "INSERT INTO occurrences SELECT json_extract(value,'$.id'),?,1,json_extract(value,'$.due'),'mock',json_extract(value,'$.due') FROM json_each(?)",
    ).bind(id, JSON.stringify(occurrences)),
    h.env.DB.prepare(
      "INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,attempts,error,updated_at) SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.occurrence'),i.schedule_id,1,i.position,i.asset_id,i.payload,'cancelled','mock',json_extract(j.value,'$.due'),0,'paused',json_extract(j.value,'$.due') FROM json_each(?) j JOIN schedule_items i ON i.schedule_id=? AND i.version=1 AND i.position=json_extract(j.value,'$.position')",
    ).bind(JSON.stringify(deliveries), id),
  ]);
  await h.env.DB.exec(
    (
      await readFile(new URL('../migrations/0009_pause_recovery.sql', import.meta.url), 'utf8')
    ).replaceAll('\n', ' '),
  );
  return id;
}

it.each([40, 41, 45])(
  '%i장 누적 중지 이력을 40장씩 제외하며 모든 결정 전 재개·이미지 삭제를 막는다',
  async (count) => {
    const id: string = await accumulatedPause(count);
    const original = (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results;
    const plan = await recoveryPreview(id, 1, h.env);
    const ids = plan.items.slice(0, 40).map((item) => item.delivery_id);
    await expect(
      decideRecovery(
        id,
        {
          version: 1,
          recover_ids: [],
          exclude_ids: ids,
          date: null,
          time: null,
          warning_accepted: true,
        },
        h.env,
        due,
      ),
    ).resolves.toEqual({ schedule_ids: [], recovered: 0, excluded: 40 });
    const remaining = await recoveryPreview(id, 1, h.env);
    expect(remaining.items.filter((item) => item.decision === null)).toHaveLength(count - 40);
    if (count === 40) {
      await resumeSchedule(id, 1, h.env, due);
      expect(
        (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results,
      ).toEqual(original);
      return;
    }
    await expect(resumeSchedule(id, 1, h.env, due)).rejects.toMatchObject({
      code: 'RECOVERY_DECISION_REQUIRED',
    });
    const protectedAsset = await h.env.DB.prepare('SELECT asset_id FROM deliveries WHERE id=?')
      .bind(remaining.items.find((item) => item.decision === null)!.delivery_id)
      .first<string>('asset_id');
    await expect(deleteImage(protectedAsset!, h.env, due)).rejects.toThrow('asset_in_use');
    await decideRecovery(
      id,
      {
        version: 1,
        recover_ids: [],
        exclude_ids: remaining.items
          .filter((item) => item.decision === null)
          .map((item) => item.delivery_id),
        date: null,
        time: null,
        warning_accepted: true,
      },
      h.env,
      due,
    );
    expect((await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results).toEqual(
      original,
    );
    await resumeSchedule(id, 1, h.env, due);
    expect(
      await h.env.DB.prepare('SELECT version,enabled,cursor FROM schedules WHERE id=?')
        .bind(id)
        .first(),
    ).toEqual({ version: 2, enabled: 1, cursor: 0 });
    expect((await h.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  },
);

it('45장 미리보기는 이번 40장만 이미지 확인하고 미결정 총량을 제공한다', async () => {
  const id: string = await accumulatedPause();
  let reads = 0;
  const images = new Proxy(h.env.CARD_IMAGES, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (key === 'get')
        return (...args: Parameters<KVNamespace['get']>) => {
          reads += 1;
          return Reflect.apply(target.get, target, args);
        };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const plan = await recoveryPreview(id, 1, { ...h.env, CARD_IMAGES: images });
  expect(plan).toMatchObject({ pending_count: 45 });
  expect(plan.items).toHaveLength(40);
  expect(reads).toBe(40);
});

it('누적 이력의 복구·제외 혼합 묶음은 고정 내용을 보존하고 발송 예산을 소비하지 않는다', async () => {
  const id: string = await accumulatedPause();
  const original = (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results;
  const usage = (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results;
  const first = await recoveryPreview(id, 1, h.env);
  const result = await decideRecovery(
    id,
    {
      version: 1,
      recover_ids: first.items.slice(0, 35).map((item) => item.delivery_id),
      exclude_ids: first.items.slice(35).map((item) => item.delivery_id),
      date: '2026-09-28',
      time: '12:10',
      warning_accepted: true,
    },
    h.env,
    due,
  );
  expect(result).toMatchObject({ recovered: 35, excluded: 5 });
  expect(result.schedule_ids).toHaveLength(7);
  const next = await recoveryPreview(id, 1, h.env);
  expect(next).toMatchObject({ pending_count: 5 });
  await decideRecovery(
    id,
    {
      version: 1,
      recover_ids: next.items.map((item) => item.delivery_id),
      exclude_ids: [],
      date: '2026-09-28',
      time: '12:30',
      warning_accepted: true,
    },
    h.env,
    due,
  );
  expect((await recoveryPreview(id, 1, h.env)).pending_count).toBe(0);
  expect(
    await h.env.DB.prepare(
      "SELECT count(*) AS n FROM pause_recoveries p JOIN deliveries d ON d.id=p.delivery_id JOIN schedule_items i ON i.schedule_id=p.target_schedule_id AND i.position=p.target_position WHERE p.decision='reschedule' AND i.asset_id=d.asset_id AND i.payload=d.payload",
    ).first('n'),
  ).toBe(40);
  const times = (
    await h.env.DB.prepare(
      'SELECT next_run_at_utc FROM schedules WHERE enabled=1 ORDER BY next_run_at_utc',
    ).all<{ next_run_at_utc: number }>()
  ).results;
  expect(times).toHaveLength(8);
  expect(
    times
      .slice(1)
      .every((item, index) => item.next_run_at_utc - times[index]!.next_run_at_utc >= 120_000),
  ).toBe(true);
  expect((await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY id').all()).results).toEqual(
    original,
  );
  expect(
    (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results,
  ).toEqual(usage);
  expect((await h.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

it('부분 결정의 겹친 요청은 한 번만 성공하고 별도 묶음은 처리하며 오래된 ID를 거부한다', async () => {
  const id: string = await accumulatedPause();
  const ids = (await recoveryPreview(id, 1, h.env)).items.map((item) => item.delivery_id);
  const request = (selected: string[]): RecoveryInput => ({
    version: 1,
    recover_ids: [],
    exclude_ids: selected,
    date: null,
    time: null,
    warning_accepted: true,
  });
  const duplicate = await Promise.allSettled([
    decideRecovery(id, request(ids.slice(0, 10)), h.env, due),
    decideRecovery(id, request(ids.slice(0, 10)), h.env, due),
  ]);
  expect(duplicate.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(duplicate.find((item) => item.status === 'rejected')).toMatchObject({
    reason: { code: 'RECOVERY_CHANGED' },
  });
  const disjoint = await Promise.allSettled([
    decideRecovery(id, request(ids.slice(10, 20)), h.env, due),
    decideRecovery(id, request(ids.slice(20, 30)), h.env, due),
  ]);
  expect(disjoint.every((item) => item.status === 'fulfilled')).toBe(true);
  await expect(decideRecovery(id, request([ids[0]!, ids[30]!]), h.env, due)).rejects.toMatchObject({
    code: 'RECOVERY_CHANGED',
  });
  await expect(
    decideRecovery(id, request([crypto.randomUUID(), ids[30]!]), h.env, due),
  ).rejects.toMatchObject({ code: 'RECOVERY_CHANGED' });
  expect((await recoveryPreview(id, 1, h.env)).pending_count).toBe(15);
  expect(
    await h.env.DB.prepare(
      "SELECT count(*) AS n FROM pause_recoveries WHERE decision='exclude'",
    ).first('n'),
  ).toBe(30);
  expect(recoverySchema.safeParse({ ...request(ids), recover_ids: ['extra'] }).success).toBe(false);
});
