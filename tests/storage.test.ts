import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { kstDate } from '../src/shared/time';
import { deleteImage, publicImage, saveCard, uploadImage } from '../src/worker/storage';
import type { Env } from '../src/worker/types';
import { dueSchedule, harness, NOW, png, readyCard, SAMPLE, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function uploadRequest(cardId: string, env: Env): Promise<Response> {
  return uploadImage(
    new Request(`${h.env.APP_ORIGIN}/upload`, {
      method: 'POST',
      headers: { 'X-Card-Revision': '1' },
      body: png(),
    }),
    cardId,
    env,
    NOW,
  );
}
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise: Promise<void> = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    await expect(uploadRequest(card.id, h.env)).rejects.toThrow('최신 카드');
  });
  it('동시 업로드가 일일 100회 한도를 넘지 않는다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    await h.env.DB.prepare('INSERT INTO usage_counters(day,uploads) VALUES(?,99)')
      .bind(kstDate(NOW))
      .run();
    const result = await Promise.allSettled([
      uploadRequest(card.id, h.env),
      uploadRequest(card.id, h.env),
    ]);
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
    const result = await Promise.allSettled([
      uploadRequest(card.id, h.env),
      uploadRequest(card.id, h.env),
    ]);
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
  it('KV 저장 뒤 D1 확정 실패에도 파일과 예약 용량을 추적하여 정리한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    await h.env.DB.exec(
      "CREATE TRIGGER fail_ready BEFORE UPDATE OF state ON assets WHEN OLD.state='uploading' AND NEW.state='ready' BEGIN SELECT RAISE(ABORT,'injected_finalize_failure'); END;",
    );
    await expect(uploadRequest(card.id, h.env)).rejects.toThrow('저장량 화면');
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('cleanup_needed');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).not.toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(33);
    await deleteImage(row!.id, h.env, NOW);
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('KV 삭제 응답이 유실되면 정리 상태와 용량을 보존하며 재시도 시 한 번만 반환한다', async () => {
    const asset = await readyCard(h.env, NOW);
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'delete')
          return async (id: string) => {
            await target.delete(id);
            throw new Error('delete response lost');
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(deleteImage(asset.assetId, { ...h.env, CARD_IMAGES: kv }, NOW)).rejects.toThrow(
      'delete response lost',
    );
    expect(await h.env.DB.prepare('SELECT state FROM assets').first('state')).toBe('deleting');
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(33);
    await deleteImage(asset.assetId, h.env, NOW);
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
    await expect(deleteImage(asset.assetId, h.env, NOW)).rejects.toThrow();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('1MiB 초과 본문과 PNG가 아닌 파일은 용량 예약 전에 거부한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    for (const bytes of [new Uint8Array(1_048_577), new Uint8Array(33)]) {
      await expect(
        uploadImage(
          new Request(`${h.env.APP_ORIGIN}/upload`, {
            method: 'POST',
            headers: { 'X-Card-Revision': '1' },
            body: bytes,
          }),
          card.id,
          h.env,
          NOW,
        ),
      ).rejects.toThrow();
    }
    expect(await h.env.DB.prepare('SELECT count(*) AS n FROM assets').first('n')).toBe(0);
  });
  it('오래된 업로드 정리 뒤 put이 완료되면 성공을 반환하지 않고 늦은 파일도 삭제한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
            await deleteImage(id, h.env, NOW + 300_001);
            await target.put(id, bytes);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(uploadRequest(card.id, { ...h.env, CARD_IMAGES: kv })).rejects.toMatchObject({
      status: 409,
      code: 'IMAGE_UPLOAD_CANCELLED',
    });
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('deleted');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('삭제 뒤 늦은 put 응답이 유실되어도 정리 대상과 용량을 복원하고 한 번만 반환한다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
            await deleteImage(id, h.env, NOW + 300_001);
            await target.put(id, bytes);
            throw new Error('put response lost after cleanup');
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(uploadRequest(card.id, { ...h.env, CARD_IMAGES: kv })).rejects.toThrow(
      '저장량 화면',
    );
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('cleanup_needed');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).not.toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(33);
    await deleteImage(row!.id, h.env, NOW);
    await expect(deleteImage(row!.id, h.env, NOW)).rejects.toThrow('이미지가 없거나');
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('보상 삭제 실패는 파일과 용량을 보존하며 재정리할 수 있다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
            await deleteImage(id, h.env, NOW + 300_001);
            await target.put(id, bytes);
          };
        if (key === 'delete')
          return async () => {
            throw new Error('compensating delete failed');
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(uploadRequest(card.id, { ...h.env, CARD_IMAGES: kv })).rejects.toThrow(
      '저장량 화면',
    );
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('deleting');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).not.toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(33);
    await deleteImage(row!.id, h.env, NOW);
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('보상 삭제와 수동 삭제가 겹쳐도 tombstone과 용량 반환을 중복 처리하지 않는다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
            await deleteImage(id, h.env, NOW + 300_001);
            await target.put(id, bytes);
          };
        if (key === 'delete')
          return async (id: string) => {
            await deleteImage(id, h.env, NOW + 300_002);
            await target.delete(id);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(uploadRequest(card.id, { ...h.env, CARD_IMAGES: kv })).rejects.toThrow(
      '업로드를 취소',
    );
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('deleted');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
  it('반환된 용량을 다른 업로드가 사용해도 늦은 파일의 정리 용량을 누락하지 않고 신규 업로드를 막는다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const other = await saveCard(SAMPLE, null, null, h.env, NOW);
    await h.env.DB.prepare("UPDATE usage_counters SET bytes=199999967 WHERE day='storage'").run();
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
            await deleteImage(id, h.env, NOW + 300_001);
            await uploadRequest(other.id, h.env);
            await target.put(id, bytes);
          };
        if (key === 'delete')
          return async () => {
            throw new Error('compensating delete failed');
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(uploadRequest(card.id, { ...h.env, CARD_IMAGES: kv })).rejects.toThrow(
      '저장량 화면',
    );
    const row = await h.env.DB.prepare('SELECT id,state FROM assets WHERE card_id=?')
      .bind(card.id)
      .first<{ id: string; state: string }>();
    expect(row?.state).toBe('deleting');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).not.toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(200000033);
    await expect(uploadRequest(other.id, h.env)).rejects.toThrow('image_storage_limit');
    expect(
      await h.env.DB.prepare('SELECT uploads FROM usage_counters WHERE day=?')
        .bind(kstDate(NOW))
        .first('uploads'),
    ).toBe(2);
    await deleteImage(row!.id, h.env, NOW);
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(200000000);
  });
  it('이전 삭제 응답이 보상 삭제 도중 늦게 도착해도 새 파일의 용량을 반환하지 않는다', async () => {
    const card = await saveCard(SAMPLE, null, null, h.env, NOW);
    const initialDelete = signal();
    const finishDelete = signal();
    let pendingDelete: Promise<void> | null = null;
    const oldKv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'delete')
          return async (id: string) => {
            await target.delete(id);
            initialDelete.resolve();
            await finishDelete.promise;
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const kv = new Proxy(h.env.CARD_IMAGES, {
      get(target, key) {
        if (key === 'put')
          return async (id: string, bytes: Uint8Array<ArrayBuffer>) => {
            pendingDelete = deleteImage(id, { ...h.env, CARD_IMAGES: oldKv }, NOW + 300_001);
            await initialDelete.promise;
            await target.put(id, bytes);
          };
        if (key === 'delete')
          return async () => {
            finishDelete.resolve();
            await pendingDelete;
            throw new Error('compensating delete failed after old delete response');
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(uploadRequest(card.id, { ...h.env, CARD_IMAGES: kv })).rejects.toThrow(
        '저장량 화면',
      );
    } finally {
      finishDelete.resolve();
      await pendingDelete;
    }
    const row = await h.env.DB.prepare('SELECT id,state FROM assets').first<{
      id: string;
      state: string;
    }>();
    expect(row?.state).toBe('deleting');
    expect(await h.env.CARD_IMAGES.get(row!.id, 'arrayBuffer')).not.toBeNull();
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(33);
    await deleteImage(row!.id, h.env, NOW);
    expect(
      await h.env.DB.prepare("SELECT bytes FROM usage_counters WHERE day='storage'").first('bytes'),
    ).toBe(0);
  });
});
