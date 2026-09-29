import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { AppState } from '../../src/web/api';
import { seed } from './db';

for (const choice of ['복구', '제외'] as const)
  test(`R3 실제 Canvas PNG와 중지 화면에서 미발송 2장 ${choice} 후 남은 5장을 재개한다`, async ({
    page,
  }, info) => {
    const name: string = `R3-${crypto.randomUUID()}`;
    const cardIds: string[] = [];
    const assetIds: string[] = [];
    await page.goto('/');
    await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PNG 다운로드' }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error('Canvas PNG가 없습니다.');
    const png = await readFile(path);
    expect(png.length).toBeGreaterThan(15000);
    const state = (await (await page.request.get('/api/state')).json()) as AppState;
    const headers = { 'X-CSRF-Token': state.csrf, Origin: 'http://127.0.0.1:8787' };
    try {
      for (let position: number = 0; position < 10; position += 1) {
        const saved = await page.request.post('/api/cards', {
          headers,
          data: {
            template: 'expression',
            expression: `복구 카드 ${position + 1}`,
            meaning_ko: '복구 검사',
            example_en: 'Keep the original.',
            example_ko: '원본을 보존하세요.',
          },
        });
        expect(saved.ok()).toBe(true);
        const card = (await saved.json()) as { id: string };
        cardIds.push(card.id);
        const uploaded = await page.request.post(`/api/cards/${card.id}/image`, {
          headers: { ...headers, 'X-Card-Revision': '1', 'Content-Type': 'image/png' },
          data: png,
        });
        expect(uploaded.ok()).toBe(true);
        const asset = (await uploaded.json()) as { id: string };
        assetIds.push(asset.id);
        expect(
          (
            await page.request.post(`/api/cards/${card.id}/review`, {
              headers,
              data: { asset_id: asset.id, revision: 1, reviewed: true },
            })
          ).ok(),
        ).toBe(true);
      }
      const future: Date = new Date(Date.now() + 9 * 3600_000 + 600_000);
      const saved = await page.request.post('/api/schedules', {
        headers,
        data: {
          name,
          kind: 'daily',
          date: future.toISOString().slice(0, 10),
          time: future.toISOString().slice(11, 16),
          weekdays: [],
          end_date: null,
          cards_per_occurrence: 5,
          asset_ids: assetIds,
        },
      });
      expect(saved.ok()).toBe(true);
      const schedule = (await saved.json()) as { id: string };
      const occurrence: string = crypto.randomUUID();
      const due: number = Date.now() - (choice === '복구' ? 60_000 : 240_000);
      await seed(
        `UPDATE schedules SET cursor=5 WHERE id='${schedule.id}'; INSERT INTO occurrences VALUES('${occurrence}','${schedule.id}',1,${due},'mock',${due}); INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,attempts,updated_at) SELECT '${occurrence}-'||position,'${occurrence}',schedule_id,version,position,asset_id,payload,CASE WHEN position<3 THEN 'mock_sent' ELSE 'pending' END,'mock',${due},CASE WHEN position<3 THEN 1 ELSE 0 END,${due} FROM schedule_items WHERE schedule_id='${schedule.id}' AND position<5; INSERT INTO delivery_attempts SELECT id||'-attempt',id,'fixture',${due},'2026-09-29','mock_sent','모의 발송 이력','mock' FROM deliveries WHERE occurrence_id='${occurrence}' AND position<3;`,
        info,
      );
      await page.reload();
      await page.getByRole('button', { name: '발송 예약', exact: true }).click();
      const article = page.locator('.schedule-card').filter({ hasText: name }).first();
      await article.getByRole('button', { name: '일시정지', exact: true }).click();
      const pause = page.getByRole('dialog', { name: '일시정지 확인' });
      await expect(pause).toContainText('미발송 2장');
      await expect(pause).toContainText('복구 카드 4');
      await expect(pause).toContainText('복구 카드 5');
      await pause.getByRole('button', { name: '일시정지 실행' }).click();
      const recovery = page.getByRole('dialog', { name: '미발송 카드 다시 예약' });
      await expect(recovery).toContainText('5장은 기존 예약에 남아');
      if (choice === '제외') {
        await recovery.getByLabel('복구 카드 4', { exact: true }).uncheck();
        await recovery.getByLabel('복구 카드 5', { exact: true }).uncheck();
        await expect(recovery).toContainText('복구 0장 · 제외 2장');
        await expect(recovery).toContainText('제외 목록: 복구 카드');
      }
      await recovery.getByLabel('복구·제외 수와 목록, 새 시각을 확인했습니다.').check();
      await recovery.getByRole('button', { name: '복구·제외 선택 저장' }).click();
      await expect(recovery).toContainText(choice === '복구' ? '새 예약 생성' : '제외 완료');
      await recovery.getByRole('button', { name: '남은 5장 예약 재개' }).click();
      await expect(recovery).toHaveCount(0);
      const after = (await (await page.request.get('/api/state')).json()) as AppState;
      const parent = after.schedules.find((item) => item.id === schedule.id)!;
      expect(parent).toMatchObject({ version: 2, enabled: 1, cursor: 0 });
      expect(parent.asset_ids).toEqual(assetIds.slice(5));
      const recovered = after.schedules.filter(
        (item) => item.name.startsWith(name) && item.id !== schedule.id,
      );
      expect(recovered).toHaveLength(choice === '복구' ? 1 : 0);
      if (choice === '복구') expect(recovered[0]?.asset_ids).toEqual(assetIds.slice(3, 5));
      expect(
        after.deliveries.filter(
          (item) => item.schedule_id === schedule.id && item.state === 'mock_sent',
        ),
      ).toHaveLength(3);
      if (choice === '제외') {
        await article.getByRole('button', { name: '일시정지', exact: true }).click();
        await pause.getByRole('button', { name: '일시정지 실행' }).click();
        await recovery.getByRole('button', { name: '닫기', exact: true }).click();
        await article.getByRole('button', { name: '취소', exact: true }).click();
        await article.getByRole('button', { name: '중지 카드 확인' }).click();
        await expect(recovery).toContainText('기존 예약은 취소되어 재개할 수 없습니다.');
        await expect(recovery.getByRole('button', { name: '남은 5장 예약 재개' })).toBeDisabled();
      }
    } finally {
      const ids: string = cardIds.map((id) => `'${id}'`).join(',') || "''";
      await seed(
        `DELETE FROM pause_recoveries WHERE delivery_id IN (SELECT d.id FROM deliveries d JOIN schedules s ON s.id=d.schedule_id WHERE s.name LIKE '${name}%'); DELETE FROM delivery_attempts WHERE delivery_id IN (SELECT d.id FROM deliveries d JOIN schedules s ON s.id=d.schedule_id WHERE s.name LIKE '${name}%'); DELETE FROM deliveries WHERE schedule_id IN (SELECT id FROM schedules WHERE name LIKE '${name}%'); DELETE FROM occurrences WHERE schedule_id IN (SELECT id FROM schedules WHERE name LIKE '${name}%'); DELETE FROM dry_runs WHERE schedule_id IN (SELECT id FROM schedules WHERE name LIKE '${name}%'); DELETE FROM schedule_items WHERE schedule_id IN (SELECT id FROM schedules WHERE name LIKE '${name}%'); DELETE FROM schedules WHERE name LIKE '${name}%'; UPDATE assets SET state='deleted' WHERE card_id IN (${ids}); DELETE FROM assets WHERE card_id IN (${ids}); DELETE FROM cards WHERE id IN (${ids});`,
        info,
      );
    }
  });
