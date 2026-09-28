import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { type ScheduleInput } from '../src/shared/model';
import { runEngine } from '../src/worker/engine';
import { sendMock } from '../src/worker/mock';
import { listSchedules, resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import { deleteImage, saveCard } from '../src/worker/storage';
import { readyCard, harness, NOW, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function input(): Promise<ScheduleInput> {
  const one = await readyCard(h.env, NOW - 300_000);
  const two = await readyCard(h.env, NOW - 300_000);
  return {
    name: '매일 공부',
    kind: 'daily',
    date: '2026-09-28',
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: 1,
    asset_ids: [one.assetId, two.assetId],
  };
}
describe('예약 상태와 카드 버전', () => {
  it('반복은 순서대로 소진하고 부족하면 멈춘다', async () => {
    const data = await input();
    const { id } = await saveSchedule(data, null, null, h.env, NOW);
    for (const offset of [300_000, 86_700_000, 173_100_000])
      await runEngine(h.env, {
        mode: 'mock',
        clock: () => NOW + offset,
        token: async () => 'mock',
        sender: sendMock,
      });
    const rows = await h.env.DB.prepare(
      'SELECT asset_id,state FROM deliveries ORDER BY due_at_utc',
    ).all<{ asset_id: string; state: string }>();
    expect(rows.results.map((row) => row.asset_id)).toEqual(data.asset_ids);
    expect(rows.results.map((row) => row.state)).toEqual(['mock_sent', 'mock_sent']);
    const schedule = (await listSchedules(h.env)).find((item) => item.id === id);
    expect(schedule?.enabled).toBe(0);
    expect(schedule?.reason).toBe('content_shortage');
    expect(schedule?.cursor).toBe(2);
  });
  it('일시정지 중에는 소비하지 않고 재개하면 미래 회차를 만든다', async () => {
    const data = await input();
    const { id } = await saveSchedule(data, null, null, h.env, NOW);
    await stopSchedule(id, 1, 'paused', h.env, NOW);
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + 300_000,
      token: async () => 'mock',
      sender: sendMock,
    });
    expect(await h.env.DB.prepare('SELECT count(*) AS n FROM deliveries').first('n')).toBe(0);
    await resumeSchedule(id, 1, h.env, NOW);
    expect((await listSchedules(h.env))[0]?.version).toBe(2);
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + 300_000,
      token: async () => 'mock',
      sender: sendMock,
    });
    expect(await h.env.DB.prepare('SELECT count(*) AS n FROM deliveries').first('n')).toBe(1);
  });
  it('동시 수정 중 패자는 승자의 카드 목록을 바꾸지 못한다', async () => {
    const data = await input();
    const { id } = await saveSchedule(data, null, null, h.env, NOW);
    const result = await Promise.allSettled([
      saveSchedule({ ...data, name: 'A', asset_ids: [data.asset_ids[0]!] }, id, 1, h.env, NOW),
      saveSchedule({ ...data, name: 'B', asset_ids: [data.asset_ids[1]!] }, id, 1, h.env, NOW),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const latest = (await listSchedules(h.env))[0]!;
    expect(latest.version).toBe(2);
    expect(latest.asset_ids).toEqual([data.asset_ids[latest.name === 'A' ? 0 : 1]]);
  });
  it('수정된 예약은 이전 회차의 미발송 카드를 취소한다', async () => {
    const data = await input();
    const { id } = await saveSchedule(data, null, null, h.env, NOW);
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + 300_000,
      token: async () => {
        throw Object.assign(new Error('busy'), { name: 'TOKEN_BUSY' });
      },
      sender: sendMock,
    });
    await saveSchedule({ ...data, time: '12:20' }, id, 1, h.env, NOW + 300_000);
    expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('cancelled');
  });
  it('검토되지 않은 카드와 이미지 전파 여유가 없는 예약을 거부한다', async () => {
    const data = await input();
    await h.env.DB.prepare("UPDATE cards SET status='draft'").run();
    await expect(saveSchedule(data, null, null, h.env, NOW)).rejects.toThrow('검토 완료');
    const asset = await readyCard(h.env, NOW);
    await expect(
      saveSchedule(
        { ...data, kind: 'once', time: '12:01', asset_ids: [asset.assetId] },
        null,
        null,
        h.env,
        NOW,
      ),
    ).rejects.toThrow('2분');
  });
  it('활성 예약 10개 상한은 DB에서 강제한다', async () => {
    const data = await input();
    for (let i: number = 0; i < 10; i += 1) await saveSchedule(data, null, null, h.env, NOW);
    await expect(saveSchedule(data, null, null, h.env, NOW)).rejects.toThrow(
      'active_schedule_limit',
    );
  });
});

it('인증 복구 후 현재 회차와 남은 반복 일정을 함께 재개한다', async () => {
  const data = await input();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW + 300_000,
    token: async () => {
      throw Object.assign(new Error('재연결'), {
        name: 'NEEDS_RECONNECT',
        code: 'NEEDS_RECONNECT',
        status: 401,
      });
    },
    sender: sendMock,
  });
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'42',0,0,1,'connected')",
  ).run();
  await resumeSchedule(id, 1, h.env, NOW + 360_000);
  expect((await listSchedules(h.env))[0]?.enabled).toBe(1);
  for (const offset of [360_000, 86_700_000])
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + offset,
      token: async () => 'mock',
      sender: sendMock,
    });
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM deliveries WHERE state='mock_sent'").first(
      'n',
    ),
  ).toBe(2);
});

it('인증 때문에 중단된 예약의 미래 이미지를 보호한다', async () => {
  const data = await input();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await h.env.DB.prepare("UPDATE schedules SET enabled=0,reason='needs_reconnect' WHERE id=?")
    .bind(id)
    .run();
  await expect(deleteImage(data.asset_ids[1]!, h.env, NOW)).rejects.toThrow('asset_in_use');
});
it('이미 예약한 이미지 버전은 카드 원문 편집 후에도 재개할 수 있다', async () => {
  const data = await input();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await stopSchedule(id, 1, 'paused', h.env, NOW);
  const card = await h.env.DB.prepare('SELECT id,content FROM cards WHERE asset_id=?')
    .bind(data.asset_ids[0])
    .first<{ id: string; content: string }>();
  await saveCard(
    { ...JSON.parse(card!.content), expression: 'A new revision' },
    card!.id,
    1,
    h.env,
    NOW,
  );
  await resumeSchedule(id, 1, h.env, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW + 300_000,
    token: async () => 'mock',
    sender: sendMock,
  });
  expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('mock_sent');
});
