import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDurableTrial, durableHarness } from '../scripts/automation-durable-harness.mjs';

let inputs;
beforeAll(async () => {
  await buildDurableTrial();
  inputs = JSON.parse(await readFile('.automation-png/durable/inputs.json', 'utf8'));
}, 60000);

describe('DO 전체 JSON → 1080 PNG → 기존 D1/KV 업로드 경로 (로컬)', () => {
  it('다섯 카드의 모든 PNG 바이트가 Node 기준과 같고 D1 준비 상태와 KV를 확인한다', async () => {
    const h = await durableHarness();
    try {
      for (const input of inputs) {
        const response = await h.call(0, input);
        expect(response.status, await response.clone().text()).toBe(200);
        const result = await response.json();
        expect(result).toMatchObject({ width: 1080, height: 1080, reused: false });
        const png = await h.image(0, input.job);
        expect(png.status).toBe(200);
        expect(Buffer.from(await png.arrayBuffer())).toEqual(
          await readFile(`.automation-png/durable/expected/${input.job}.png`),
        );
        const row = await h.db
          .prepare('SELECT state,bytes FROM assets WHERE id=?')
          .bind(result.asset.id)
          .first();
        expect(row).toEqual({ state: 'ready', bytes: result.asset.bytes });
      }
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM assets').first()).n).toBe(5);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM schedules').first()).n).toBe(0);
    } finally {
      await h.mf.dispose();
    }
  });

  it('동일 작업 동시 호출은 한 장만 저장하고 같은 작업의 내용 변경은 거부한다', async () => {
    const h = await durableHarness();
    try {
      const replies = await Promise.all([h.call(0, inputs[0]), h.call(0, inputs[0])]);
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      const results = await Promise.all(replies.map((r) => r.json()));
      expect(results[0].asset.id).toBe(results[1].asset.id);
      expect(results.filter((r) => !r.reused)).toHaveLength(1);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM assets').first()).n).toBe(1);
      expect((await h.call(0, { ...inputs[0], number: 99 })).status).toBe(409);
    } finally {
      await h.mf.dispose();
    }
  });

  it('새 JSON 내용과 번호가 PNG에 반영되며 빌드 시 고정된 SVG에 의존하지 않는다', async () => {
    const h = await durableHarness();
    try {
      const changed = {
        ...inputs[0],
        job: 'new-runtime-card',
        card: {
          ...inputs[0].card,
          expression: 'Keep an open mind',
          meaning_ko: '열린 마음으로 생각해',
          example_en: 'Keep an open mind when you try something new.',
          example_ko: '새로운 일을 해볼 때 열린 마음으로 생각해.',
        },
      };
      expect((await h.call(0, changed)).status).toBe(200);
      const png = Buffer.from(await (await h.image(0, changed.job)).arrayBuffer());
      expect(png.readUInt32BE(16)).toBe(1080);
      const baseline = await readFile('.automation-png/durable/expected/expression.png');
      expect(createHash('sha256').update(png).digest('hex')).not.toBe(
        createHash('sha256').update(baseline).digest('hex'),
      );
      expect((await h.call(0, { ...changed, job: 'changed-number', number: 42 })).status).toBe(200);
      const numbered = Buffer.from(await (await h.image(0, 'changed-number')).arrayBuffer());
      expect(numbered.equals(png)).toBe(false);
    } finally {
      await h.mf.dispose();
    }
  });

  it('인증·슬롯·메서드·본문·스키마 오류는 렌더나 저장 전에 거부한다', async () => {
    const h = await durableHarness();
    try {
      expect(
        (await h.call(0, inputs[0], { headers: { Authorization: 'Bearer wrong' } })).status,
      ).toBe(401);
      expect((await h.call(4, inputs[0])).status).toBe(404);
      expect(
        (await h.call(0, inputs[0], { headers: { 'Content-Type': 'text/plain' } })).status,
      ).toBe(415);
      for (const input of [
        '{',
        'a'.repeat(16_385),
        {},
        { ...inputs[0], job: '../bad' },
        { ...inputs[0], number: 1000 },
        { ...inputs[0], card: { ...inputs[0].card, template: 'unknown' } },
        { ...inputs[0], url: 'https://bad.invalid' },
      ])
        expect((await h.call(0, input)).status).toBe(400);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM cards').first()).n).toBe(0);
    } finally {
      await h.mf.dispose();
    }
  });

  it('DO 객체 퇴거 후에도 한 슬롯의 10회 제한과 완료 작업 재사용을 지킨다', async () => {
    const h = await durableHarness();
    try {
      for (let i = 0; i < 10; i++)
        expect((await h.call(0, { ...inputs[0], job: `cap-${i}` })).status).toBe(200);
      await h.mf.unsafeEvictDurableObject('renderer', 'CardPngTrial', { name: 'trial-0' });
      expect((await h.call(0, { ...inputs[0], job: 'over-cap' })).status).toBe(429);
      expect((await h.call(0, { ...inputs[0], job: 'cap-0' })).status).toBe(200);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM assets').first()).n).toBe(10);
    } finally {
      await h.mf.dispose();
    }
  });

  it('폰트 실패는 PNG·카드를 저장하지 않고 같은 작업을 자동 재실행하지 않는다', async () => {
    const h = await durableHarness({ missingFonts: true });
    try {
      expect((await h.call(0, inputs[0])).status).toBe(503);
      expect((await h.call(0, inputs[0])).status).toBe(409);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM cards').first()).n).toBe(0);
    } finally {
      await h.mf.dispose();
    }
  });

  it('KV 저장 뒤 D1 완료 실패는 정리 대상과 예약 용량을 보존하고 중복 업로드하지 않는다', async () => {
    const h = await durableHarness();
    try {
      await h.db.exec(
        "CREATE TRIGGER fail_trial_ready BEFORE UPDATE OF state ON assets WHEN NEW.state='ready' BEGIN SELECT RAISE(FAIL,'injected ready failure'); END;",
      );
      expect((await h.call(0, inputs[0])).status).toBe(503);
      const row = await h.db.prepare('SELECT id,kv_key,state,bytes FROM assets').first();
      expect(row.state).toBe('cleanup_needed');
      const kv = await h.mf.getKVNamespace('CARD_IMAGES', 'renderer');
      expect((await kv.get(row.kv_key, 'arrayBuffer')).byteLength).toBe(row.bytes);
      expect((await h.call(0, inputs[0])).status).toBe(409);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM assets').first()).n).toBe(1);
    } finally {
      await h.mf.dispose();
    }
  });

  it('저장 성공 뒤 DO 완료 기록 실패·객체 퇴거도 같은 작업을 다시 업로드하지 않는다', async () => {
    const h = await durableHarness({ failCommit: true });
    try {
      const result = await h.call(0, inputs[0]);
      expect(result.status).toBe(503);
      expect(await result.json()).toMatchObject({ error: 'TRIAL_FAILED', stage: 'commit' });
      await h.mf.unsafeEvictDurableObject('renderer', 'CardPngTrial', { name: 'trial-0' });
      expect((await h.call(0, inputs[0])).status).toBe(409);
      expect((await h.db.prepare('SELECT COUNT(*) AS n FROM cards').first()).n).toBe(1);
      const rows = (await h.db.prepare('SELECT kv_key,state,bytes FROM assets').all()).results;
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe('ready');
      const kv = await h.mf.getKVNamespace('CARD_IMAGES', 'renderer');
      expect((await kv.get(rows[0].kv_key, 'arrayBuffer')).byteLength).toBe(rows[0].bytes);
    } finally {
      await h.mf.dispose();
    }
  });
});
