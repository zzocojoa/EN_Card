import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { validatePng } from '../src/worker/png';
import { saveCard, uploadImage } from '../src/worker/storage';
import { assemble, chunk, PNG_CHUNKS, validPng } from './png-fixture';
import { harness, NOW, SAMPLE, type Harness } from './helpers';

it('R4 정상 fixture는 실제 압축 해제가 가능한 1080×1080 RGBA PNG다', () => {
  expect(inflateSync(PNG_CHUNKS[1]!.subarray(8, -4))).toHaveLength((1080 * 4 + 1) * 1080);
  expect(() => validatePng(validPng())).not.toThrow();
});
const header: Uint8Array = PNG_CHUNKS[0]!.slice(8, -4);
const invalidCases: [string, Uint8Array<ArrayBuffer>][] = [
  ['33바이트 헤더만 존재', assemble([PNG_CHUNKS[0]!])],
  ['IDAT 누락', assemble([PNG_CHUNKS[0]!, PNG_CHUNKS[2]!])],
  ['IEND 누락', assemble(PNG_CHUNKS.slice(0, 2))],
  ['잘린 청크', validPng().slice(0, -1)],
  ['IHDR 중복', assemble([PNG_CHUNKS[0]!, ...PNG_CHUNKS])],
  ['IHDR 순서', assemble([PNG_CHUNKS[1]!, PNG_CHUNKS[0]!, PNG_CHUNKS[2]!])],
  ['IEND 뒤 데이터', new Uint8Array([...validPng(), 0])],
  [
    'IDAT 불연속',
    assemble([
      PNG_CHUNKS[0]!,
      PNG_CHUNKS[1]!,
      chunk('tEXt', new Uint8Array()),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
  ['빈 IDAT', assemble([PNG_CHUNKS[0]!, chunk('IDAT', new Uint8Array()), PNG_CHUNKS[2]!])],
  [
    '잘못된 IHDR',
    assemble([
      chunk('IHDR', new Uint8Array([...header.slice(0, 8), 3, 6, 0, 0, 0])),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
  [
    '압축 방식',
    assemble([
      chunk('IHDR', new Uint8Array([...header.slice(0, 10), 1, 0, 0])),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
  ['CRC 불일치', new Uint8Array([...validPng().slice(0, -1), 0])],
  [
    '비정상 길이',
    new Uint8Array([...validPng().slice(0, 8), 255, 255, 255, 255, ...validPng().slice(12)]),
  ],
  ['1MiB 초과', new Uint8Array(1_048_577)],
  [
    '필터 방식',
    assemble([
      chunk('IHDR', new Uint8Array([...header.slice(0, 11), 1, 0])),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
  [
    '인터레이스 방식',
    assemble([
      chunk('IHDR', new Uint8Array([...header.slice(0, 12), 2])),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
  [
    '팔레트 누락',
    assemble([
      chunk('IHDR', new Uint8Array([...header.slice(0, 8), 8, 3, 0, 0, 0])),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
  [
    '필수 청크 미지원',
    assemble([PNG_CHUNKS[0]!, chunk('ABCD', new Uint8Array()), PNG_CHUNKS[1]!, PNG_CHUNKS[2]!]),
  ],
  [
    '보조 청크 CRC 오류',
    assemble([
      PNG_CHUNKS[0]!,
      new Uint8Array([0, 0, 0, 0, 116, 69, 88, 116, 0, 0, 0, 0]),
      PNG_CHUNKS[1]!,
      PNG_CHUNKS[2]!,
    ]),
  ],
];
it.each(invalidCases)('R4 %s 파일을 거부한다', (_name, bytes) => {
  expect(() => validatePng(bytes)).toThrow();
});
let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
it('R4 잘못된 업로드는 KV·저장량·업로드 횟수를 예약하지 않는다', async () => {
  const card = await saveCard(SAMPLE, null, null, h.env, NOW);
  const before = (await h.env.DB.prepare('SELECT * FROM usage_counters').all()).results;
  for (const [, bytes] of invalidCases)
    await expect(
      uploadImage(
        new Request(`${h.env.APP_ORIGIN}/api/cards/${card.id}/image`, {
          method: 'POST',
          headers: { 'X-Card-Revision': '1' },
          body: bytes,
        }),
        card.id,
        h.env,
        NOW,
      ),
    ).rejects.toBeInstanceOf(Error);
  expect((await h.env.DB.prepare('SELECT * FROM usage_counters').all()).results).toEqual(before);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM assets').first('n')).toBe(0);
  expect((await h.env.CARD_IMAGES.list()).keys).toHaveLength(0);
});
