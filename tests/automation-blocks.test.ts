import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { encodeAtlasPage } from '../experiments/automation-png/atlas-build';
import { decodeAtlasPage } from '../experiments/automation-png/atlas-pages';
import {
  blockHeaderBytes,
  blockPageDecoder,
  type BlockSize,
} from '../experiments/automation-png/atlas-blocks';
import { encodeBlockPage } from '../experiments/automation-png/atlas-block-build';
import type { Atlas } from '../experiments/automation-png/atlas';

const base = 44032,
  style = { weight: 450, size: 30 };
const key = (slot: number) => `${style.weight}:${style.size}:${base + slot}`;
const atlas: Atlas = { glyphs: {}, pixels: Uint8Array.from({ length: 64 * 6 }, (_, i) => i % 32) };
for (let slot = 0; slot < 64; slot++)
  atlas.glyphs[key(slot)] = {
    advance: 15.123456789012345,
    left: -2,
    top: -4,
    width: slot === 63 ? 0 : 3,
    height: 2,
    offset: slot * 6,
  };
const original = encodeAtlasPage(atlas, base / 64, style, 64);
const page = (blockSize: BlockSize) =>
  new Uint8Array(encodeBlockPage(atlas, base, style.size, style.weight, blockSize));
it.each([4, 8] as const)(
  '%i글자 블록은 요청 순서·소수 폭·빈 글자·비정렬 view를 유지한다',
  (blockSize) => {
    const encoded = page(blockSize),
      decode = blockPageDecoder(blockSize);
    for (const slots of [
      [0],
      [0, 1, 2, 3, 4, 5, 6, 7],
      [0, 8, 16, 24, 32, 40, 48, 56],
      [63, 7, 2, 0],
    ]) {
      const keys = slots.map(key),
        padded = new Uint8Array(encoded.length + 4);
      padded.set(encoded, 1);
      expect(decode(padded.subarray(1, -3), keys, 64)).toEqual(decodeAtlasPage(original, keys, 64));
    }
    expect(decode(encoded, [], 64)).toEqual({ glyphs: {}, pixels: new Uint8Array() });
  },
);
it.each([4, 8] as const)(
  '%i글자 블록은 같은 요청에서 한 번만 풀고 요청 간 캐시를 남기지 않는다',
  (blockSize) => {
    const stats = { calls: 0, compressedBytes: 0, inflatedBytes: 0 },
      decode = blockPageDecoder(blockSize, stats),
      data = page(blockSize);
    decode(data, [key(0), key(1), key(2)], 64);
    expect(stats.calls).toBe(1);
    expect(stats.inflatedBytes).toBe(blockSize * 6);
    decode(data, [key(0)], 64);
    expect(stats.calls).toBe(2);
    decode(data, [key(0), key(8), key(16)], 64);
    expect(stats.calls).toBe(5);
  },
);
it('블록 해제는 형식·범위·예약 필드·누락·중복·키 변형을 거부한다', () => {
  const decode = blockPageDecoder(4),
    data = page(4),
    table = 24 + 64 * 32;
  expect(() => decode(page(8), [key(0)], 64)).toThrow();
  expect(() => decode(original, [key(0)], 64)).toThrow();
  expect(() => decodeAtlasPage(data, [key(0)], 64)).toThrow();
  expect(() => decode(data, [key(0)], 32)).toThrow();
  expect(() => decode(new Uint8Array(4 * 1048576 + 1), [key(0)], 64)).toThrow();
  for (const keys of [
    [key(0), key(0)],
    [key(64)],
    [key(-1)],
    ['0450:30:44032'],
    ['450:30:44032:0'],
    ['__proto__'],
  ])
    expect(() => decode(data, keys, 64)).toThrow();
  const changes: ((v: DataView) => void)[] = [
    (v) => v.setUint32(0, 0),
    (v) => v.setUint32(4, base + 1),
    (v) => v.setUint32(4, 0x110000),
    (v) => v.setUint16(8, 0),
    (v) => v.setUint32(12, 32),
    (v) => v.setUint16(18, 1),
    (v) => v.setUint32(20, 15),
    (v) => v.setUint32(24 + 24, 0),
    (v) => v.setUint32(24 + 20, 1),
    (v) => v.setUint32(24 + 28, 1),
    (v) => v.setFloat64(24, NaN),
    (v) => v.setFloat64(24, Infinity),
    (v) => v.setFloat64(24, -1),
    (v) => v.setFloat64(24, 201),
    (v) => v.setUint16(24 + 12, 201),
    (v) => v.setUint16(24 + 14, 201),
    (v) => v.setUint32(24 + 16, 0xffffffff),
    (v) => v.setUint32(table, 0),
    (v) => v.setUint32(table + 4, 0),
    (v) => v.setUint32(table + 4, data.length),
    (v) => v.setUint32(table + 8, 160001),
    (v) => v.setUint32(table + 8, 23),
    (v) => v.setUint32(table + 8, 25),
    (v) => v.setUint32(table + 12, 1),
  ];
  for (const change of changes) {
    const bad = data.slice();
    change(new DataView(bad.buffer));
    expect(() => decode(bad, [key(0)], 64)).toThrow();
  }
  expect(() => decode(data.subarray(0, blockHeaderBytes(4) - 1), [key(0)], 64)).toThrow();
});
it('손상·잘린 zlib와 해제 상한 초과·선택하지 않은 이웃의 잘못된 알파도 거부한다', () => {
  const decode = blockPageDecoder(4),
    data = page(4),
    table = 24 + 64 * 32;
  const v = new DataView(data.buffer),
    start = v.getUint32(table),
    compressedLength = v.getUint32(table + 4);
  const bad = data.slice();
  bad[start + compressedLength - 1]! ^= 255;
  expect(() => decode(bad, [key(0)], 64)).toThrow();
  expect(() => decode(data.subarray(0, start + compressedLength - 1), [key(0)], 64)).toThrow();
  function replace(raw: Uint8Array, declared: number) {
    const zipped = deflateSync(raw),
      header = data.slice(0, blockHeaderBytes(4));
    const view = new DataView(header.buffer);
    view.setUint32(table, header.length);
    view.setUint32(table + 4, zipped.length);
    view.setUint32(table + 8, declared);
    return new Uint8Array([...header, ...zipped]);
  }
  const neighbour = new Uint8Array(24);
  neighbour[23] = 32;
  expect(() => decode(replace(neighbour, 24), [key(0)], 64)).toThrow('픽셀');
  expect(() => decode(replace(new Uint8Array(320000), 24), [key(0)], 64)).toThrow();
});
it('빈 픽셀 블록과 빠진 글자를 구별한다', () => {
  const empty: Atlas = {
    glyphs: { [key(0)]: { advance: 0, left: 0, top: 0, width: 0, height: 0, offset: 0 } },
    pixels: new Uint8Array(),
  };
  const data = encodeBlockPage(empty, base, 30, 450, 8),
    decode = blockPageDecoder(8);
  expect(decode(data, [key(0)], 64)).toEqual(empty);
  expect(() => decode(data, [key(1)], 64)).toThrow();
});
it('오프라인 생산자는 정수 필드 잘림과 잘못된 알파를 막는다', () => {
  for (const args of [
    [base + 1, 30, 450],
    [base, 0, 450],
    [base, 30, 65536],
  ])
    expect(() => encodeBlockPage(atlas, args[0]!, args[1]!, args[2]!, 4)).toThrow();
  for (const patch of [
    { advance: Infinity },
    { left: 32768 },
    { top: -32769 },
    { width: -1 },
    { height: 201 },
    { offset: atlas.pixels.length },
    { offset: 1.5 },
  ])
    expect(() =>
      encodeBlockPage(
        { ...atlas, glyphs: { [key(0)]: { ...atlas.glyphs[key(0)]!, ...patch } } },
        base,
        30,
        450,
        4,
      ),
    ).toThrow();
  const pixels = atlas.pixels.slice();
  pixels[0] = 32;
  expect(() => encodeBlockPage({ ...atlas, pixels }, base, 30, 450, 4)).toThrow();
});
