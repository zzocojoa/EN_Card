import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { disconnect } from '../src/worker/auth';
import { recoveryPreview } from '../src/worker/pause-recovery';
import { saveSchedule, stopSchedule } from '../src/worker/schedules';
import { harness, harnessThrough, NOW, readyCard, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function seed() {
  const asset = await readyCard(h.env, NOW - 300_000);
  const input = {
    name: '취소 원인',
    kind: 'daily',
    date: '2026-09-28',
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: 1,
    asset_ids: [asset.assetId],
  };
  const { id } = await saveSchedule(input, null, null, h.env, NOW);
  await h.env.DB.batch([
    h.env.DB.prepare(
      "INSERT INTO occurrences(id,schedule_id,schedule_version,due_at_utc,mode,created_at) VALUES('cause-occ',?,1,?,'mock',?)",
    ).bind(id, NOW, NOW),
    h.env.DB.prepare(
      "INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,updated_at) SELECT 'cause-delivery','cause-occ',schedule_id,1,position,asset_id,payload,'pending','mock',?,? FROM schedule_items WHERE schedule_id=? AND version=1",
    ).bind(NOW, NOW, id),
  ]);
  return { id, input };
}
it('R11 연결 해제는 부모가 paused여도 복구로 편입하지 않고 오류 문구 변경에도 원인을 유지한다', async () => {
  const { id } = await seed();
  await h.env.DB.prepare("UPDATE schedules SET enabled=0,reason='paused' WHERE id=?")
    .bind(id)
    .run();
  await disconnect(h.env, NOW);
  expect(
    await h.env.DB.prepare('SELECT state,cancellation_reason FROM deliveries').first(),
  ).toEqual({ state: 'cancelled', cancellation_reason: 'disconnected' });
  await h.env.DB.prepare("UPDATE deliveries SET error='paused'").run();
  expect((await recoveryPreview(id, 1, h.env)).items).toEqual([]);
  expect(
    await h.env.DB.prepare('SELECT cancellation_reason FROM deliveries').first(
      'cancellation_reason',
    ),
  ).toBe('disconnected');
});
it('R11 진짜 일시정지는 오류 문구가 연결 해제 문구로 바뀌어도 복구 가능하다', async () => {
  const { id } = await seed();
  await stopSchedule(id, 1, 'paused', h.env, NOW);
  await h.env.DB.prepare("UPDATE deliveries SET error='자동 발송 연결 해제'").run();
  expect(
    await h.env.DB.prepare('SELECT cancellation_reason FROM deliveries').first(
      'cancellation_reason',
    ),
  ).toBe('paused');
  expect((await recoveryPreview(id, 1, h.env)).items).toEqual([
    expect.objectContaining({ available: true, decision: null }),
  ]);
});
it('R11 예약 수정의 취소 원인은 이후 일시정지와 화면 문구 변경으로 복구되지 않는다', async () => {
  const { id, input } = await seed();
  await saveSchedule({ ...input, time: '12:10' }, id, { version: 1, cursor: 0 }, h.env, NOW);
  await h.env.DB.prepare("UPDATE deliveries SET error='paused'").run();
  await stopSchedule(id, 2, 'paused', h.env, NOW);
  expect(
    await h.env.DB.prepare('SELECT cancellation_reason FROM deliveries').first(
      'cancellation_reason',
    ),
  ).toBe('schedule_changed');
  expect((await recoveryPreview(id, 2, h.env)).items).toEqual([]);
});
it('R11 알 수 없는 취소 원인은 CHECK로 거부한다', async () => {
  await seed();
  await expect(
    h.env.DB.prepare("UPDATE deliveries SET cancellation_reason='arbitrary'").run(),
  ).rejects.toThrow('CHECK');
  expect(
    await h.env.DB.prepare('SELECT state,cancellation_reason FROM deliveries').first(),
  ).toEqual({ state: 'pending', cancellation_reason: null });
});
it('R11 0011은 잘못 편입된 미결정 관계만 정리하며 완료 결정·정상 후보·원본/호출/예산을 보존한다', async () => {
  await h.mf.dispose();
  h = await harnessThrough('0010_recovery_cancellation_provenance.sql');
  const { id, input } = await seed();
  const target = (
    await saveSchedule({ ...input, name: '기존 복구 대상', time: '12:10' }, null, null, h.env, NOW)
  ).id;
  await h.env.DB.prepare("UPDATE schedules SET enabled=0,reason='paused' WHERE id=?")
    .bind(id)
    .run();
  const cases = [
    ['real-pending', 'paused', null],
    ['real-exclude', 'paused', 'exclude'],
    ['real-reschedule', 'paused', 'reschedule'],
    ['bad-pending', '자동 발송 연결 해제', null],
    ['bad-exclude', '자동 발송 연결 해제', 'exclude'],
    ['bad-reschedule', '자동 발송 연결 해제', 'reschedule'],
    ['unclassified', '이전 원인 불명', null],
  ] as const;
  await h.env.DB.prepare("DELETE FROM deliveries WHERE id='cause-delivery'").run();
  for (let i = 0; i < cases.length; i++) {
    const [deliveryId, error, decision] = cases[i]!;
    await h.env.DB.prepare(
      "INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,error,updated_at) SELECT ?,'cause-occ',schedule_id,1,?,asset_id,payload,'cancelled','mock',?,?,? FROM schedule_items WHERE schedule_id=? AND version=1 AND position=0",
    )
      .bind(deliveryId, i, NOW, error, NOW, id)
      .run();
    await h.env.DB.prepare(
      'INSERT INTO pause_recoveries(delivery_id,decision,target_schedule_id,target_position,decided_at) VALUES(?,?,?,?,?)',
    )
      .bind(
        deliveryId,
        decision,
        decision === 'reschedule' ? target : null,
        decision === 'reschedule' ? 0 : null,
        decision ? NOW : null,
      )
      .run();
  }
  await h.env.DB.prepare(
    "INSERT INTO delivery_attempts VALUES('preserved-attempt','bad-pending','historical',?,'2026-09-28','blocked','확정 미접수','mock')",
  )
    .bind(NOW)
    .run();
  await h.env.DB.prepare("UPDATE deliveries SET attempts=1 WHERE id='bad-pending'").run();
  const preserved = await Promise.all(
    ['deliveries', 'delivery_attempts', 'usage_counters', 'schedule_items', 'schedules'].map(
      async (table) =>
        (await h.env.DB.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).results,
    ),
  );
  const relations = (
    await h.env.DB.prepare('SELECT * FROM pause_recoveries ORDER BY delivery_id').all()
  ).results;
  await h.env.DB.exec(
    (
      await readFile(
        new URL('../migrations/0011_delivery_cancellation_reason.sql', import.meta.url),
        'utf8',
      )
    ).replaceAll('\n', ' '),
  );
  expect(
    (await h.env.DB.prepare('SELECT * FROM pause_recoveries ORDER BY delivery_id').all()).results,
  ).toEqual(relations.filter((row) => row.delivery_id !== 'bad-pending'));
  const after = await Promise.all(
    ['deliveries', 'delivery_attempts', 'usage_counters', 'schedule_items', 'schedules'].map(
      async (table) =>
        (await h.env.DB.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).results,
    ),
  );
  expect(after[0]!.map(({ cancellation_reason: _reason, ...row }) => row)).toEqual(preserved[0]);
  expect(after.slice(1)).toEqual(preserved.slice(1));
  expect(
    (await recoveryPreview(id, 1, h.env)).items.find((row) => row.delivery_id === 'real-pending'),
  ).toMatchObject({ available: true, decision: null });
  expect(
    await h.env.DB.prepare(
      "SELECT cancellation_reason FROM deliveries WHERE id='unclassified'",
    ).first('cancellation_reason'),
  ).toBeNull();
  expect((await h.env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
