import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { kstDate } from '../src/shared/time';
import { deleteImage, publicImage, saveCard, uploadImage } from '../src/worker/storage';
import { dueSchedule, harness, NOW, png, readyCard, SAMPLE, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function uploadRequest(cardId: string): Promise<Response> {
  return uploadImage(
    new Request(`${h.env.APP_ORIGIN}/upload`, {
      method: 'POST',
      headers: { 'X-Card-Revision': '1' },
      body: png(),
    }),
    cardId,
    h.env,
    NOW,
  );
}
describe('이미지와 원자적 용량 예약', () => {
  it('공개 URL은 이미지 바이트만 제공한다', async () => {
    const asset = await readyCard(h.env, NOW);
    const response = await publicImage(asset.publicId, h.env);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect((await response.arrayBuffer()).byteLength).toBe(33);
  });
  it('수정된 카드의 이전 revision 업로드를 거부한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    await saveCard({ ...SAMPLE, expression: 'Updated' }, card.id, 1, h.env, NOW);
    await expect(uploadRequest(card.id)).rejects.toThrow('최신 카드');
  });
  it('동시 업로드가 일일 100회 한도를 넘지 않는다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    await h.env.DB.prepare('INSERT INTO usage_counters(day,uploads) VALUES(?,99)')
      .bind(kstDate(NOW))
      .run();
    const result = await Promise.allSettled([uploadRequest(card.id), uploadRequest(card.id)]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(
      await h.env.DB.prepare('SELECT uploads FROM usage_counters WHERE day=?')
        .bind(kstDate(NOW))
        .first('uploads'),
    ).toBe(100);
  });
  it('동시 저장량 예약은 실패한 횟수 증가도 롤백한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    await h.env.DB.prepare("UPDATE usage_counters SET bytes=199999967 WHERE day='storage'").run();
    const result = await Promise.allSettled([uploadRequest(card.id), uploadRequest(card.id)]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(
      await h.env.DB.prepare('SELECT uploads FROM usage_counters WHERE day=?')
        .bind(kstDate(NOW))
        .first('uploads'),
    ).toBe(1);
  });
  it('예약에서 참조하는 이미지는 삭제할 수 없다', async () => {
    await dueSchedule(h.env, 1, NOW);
    const row = await h.env.DB.prepare('SELECT id FROM assets').first<{ id: string }>();
    await expect(deleteImage(row!.id, h.env, NOW)).rejects.toThrow('asset_in_use');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).not.toBeNull();
  });
  it('KV 실패 시 불명확한 용량을 반환하지 않고 사용자 정리 후 반환한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const brokenKV = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async () => {
            throw new Error('KV write failed');
          };
        return Reflect.get(target, key);
      },
    });
    await expect(
      uploadImage(
        new Request(`${h.env.APP_ORIGIN}/upload`, {
          method: 'POST',
          headers: { 'X-Card-Revision': '1' },
          body: png(),
        }),
        card.id,
        { ...h.env, CARD_IMAGES: brokenKV },
        NOW,
      ),
    ).rejects.toThrow('저장량 화면');
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('cleanup_needed');
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(33);
    await deleteImage(row!.id, h.env, NOW);
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('삭제 후 공개 접근을 막고 과거 메타데이터는 보존한다', async () => {
    const asset = await readyCard(h.env, NOW);
    await deleteImage(asset.assetId, h.env, NOW);
    await expect(publicImage(asset.publicId, h.env)).rejects.toThrow('찾을 수');
    expect(
      await h.env.DB.prepare('SELECT state FROM assets WHERE id=?')
        .bind(asset.assetId)
        .first('state'),
    ).toBe('deleted');
  });
});
