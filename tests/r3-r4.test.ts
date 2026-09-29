import { afterEach, beforeEach, expect, it } from 'vitest';
import { runEngine } from '../src/worker/engine';
import { resumeSchedule, saveSchedule, stopSchedule } from '../src/worker/schedules';
import { validatePng } from '../src/worker/storage';
import { harness, NOW, readyCard, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});

it('R3 10장 중 3장 발송 후 중지한 예약은 미발송 2장에 대한 선택 없이 재개하지 않는다', async () => {
  const assets = await Promise.all(
    Array.from({ length: 10 }, () => readyCard(h.env, NOW - 300_000)),
  );
  const { id } = await saveSchedule(
    {
      name: '복구 대상',
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
  );
  const now: number = NOW + 300_000;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => now,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'mock_sent', detail: '모의 접수' }),
  });
  await stopSchedule(id, 1, 'paused', h.env, now);
  await expect(resumeSchedule(id, 1, h.env, now)).rejects.toMatchObject({
    code: 'RECOVERY_DECISION_REQUIRED',
  });
  expect(
    await h.env.DB.prepare('SELECT version,cursor,enabled FROM schedules WHERE id=?')
      .bind(id)
      .first(),
  ).toEqual({ version: 1, cursor: 5, enabled: 0 });
});

it('R4 33바이트 헤더만 있는 파일은 PNG로 허용하지 않는다', () => {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view: DataView = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, 1080);
  view.setUint32(20, 1080);
  expect(() => validatePng(bytes)).toThrow();
});
