import { expect, it } from 'vitest';
import { binaryAtlasChunkCodec as codec } from '../experiments/automation-png/atlas-binary';
import { packAtlasChunk, unpackAtlasChunk } from '../experiments/automation-png/atlas-chunks';
import { packAtlasBundle, unpackAtlasBundle } from '../experiments/automation-png/atlas-pipeline';
import type { Atlas, Sprite } from '../experiments/automation-png/atlas';

const glyph: Sprite = {
  advance: 12.345678901234567,
  left: -2,
  top: -17,
  width: 2,
  height: 2,
  offset: 0,
};
const atlas: Atlas = {
  glyphs: {
    '400:22:54620': glyph,
    '800:82:128512': {
      ...glyph,
      advance: 0,
      width: 0,
      height: 0,
      offset: 4,
      left: -32768,
      top: 32767,
    },
  },
  pixels: new Uint8Array([0, 1, 17, 31]),
};
const keys = new Set(Object.keys(atlas.glyphs));
function frame() {
  return codec.pack(atlas, 0, 1);
}
function corrupt(change: (view: DataView, bytes: Uint8Array) => void) {
  const bytes = frame();
  change(new DataView(bytes.buffer), bytes);
  return bytes;
}
it('바이너리는 소수 advance·음수 좌표·보충 평면·빈 글자를 JSON과 동일하게 복원한다', () => {
  expect(codec.unpack(frame(), 0, 1, keys)).toEqual(
    unpackAtlasChunk(packAtlasChunk(atlas, 0, 1), 0, 1, keys),
  );
  const unaligned = new Uint8Array(frame().length + 5);
  unaligned.set(frame(), 3);
  expect(codec.unpack(unaligned.subarray(3, -2), 0, 1, keys)).toEqual(atlas);
  expect(
    codec.unpack(codec.pack({ glyphs: {}, pixels: new Uint8Array() }, 0, 1), 0, 1, new Set()),
  ).toEqual({ glyphs: {}, pixels: new Uint8Array() });
});
it('생산자는 고정 폭 필드가 잘리거나 식별자가 바뀌기 전에 거부한다', () => {
  for (const key of [
    '0400:22:65',
    '400:22:65:0',
    '0:22:65',
    '65536:22:65',
    '400:0:65',
    '400:65536:65',
    '400:22:1114112',
    '400:22:55296',
    '400:22:-1',
    '__proto__',
  ])
    expect(() => codec.pack({ ...atlas, glyphs: { [key]: glyph } }, 0, 1)).toThrow();
  for (const patch of [
    { advance: NaN },
    { advance: Infinity },
    { advance: -1 },
    { advance: 201 },
    { left: -32769 },
    { top: 32768 },
    { top: 0.1 },
    { width: 201 },
    { height: -1 },
    { offset: 1 },
    { offset: 2 ** 32 },
  ])
    expect(() =>
      codec.pack({ ...atlas, glyphs: { '400:22:65': { ...glyph, ...patch } } }, 0, 1),
    ).toThrow();
});
it('순서·개수·헤더·메타데이터 크기와 프레임 상한을 검증한다', () => {
  for (const [index, total] of [
    [-1, 1],
    [1, 1],
    [0, 0],
    [0, 30],
    [0.5, 1],
    [0, NaN],
  ]) {
    expect(() => codec.pack(atlas, index!, total!)).toThrow();
    expect(() => codec.envelope(frame(), index!, total!)).toThrow();
  }
  for (const bytes of [
    new Uint8Array(11),
    new Uint8Array(1048577),
    frame().subarray(0, 20),
    corrupt((v) => v.setUint32(0, 0x41544331)),
    corrupt((v) => v.setUint32(4, 33)),
    corrupt((v) => v.setUint32(4, 262176)),
    corrupt((v) => v.setUint16(8, 1)),
    corrupt((v) => v.setUint16(10, 2)),
  ])
    expect(() => codec.unpack(bytes, 0, 1, keys)).toThrow();
  expect(() => codec.pack({ glyphs: {}, pixels: new Uint8Array(1048576) }, 0, 1)).toThrow();
  const many = Object.fromEntries(
    Array.from({ length: 8193 }, (_, point) => [
      `400:22:${point}`,
      { ...glyph, width: 0, height: 0 },
    ]),
  );
  expect(() => codec.pack({ ...atlas, glyphs: many }, 0, 1)).toThrow();
});
it('기대 글자 집합·중복 레코드·예약 필드·픽셀과 숫자 범위를 확인한다', () => {
  for (const expected of [new Set<string>(), new Set(['400:22:65', '800:82:128512'])])
    expect(() => codec.unpack(frame(), 0, 1, expected)).toThrow();
  const changes: ((v: DataView, b: Uint8Array) => void)[] = [
    (_, b) => b.copyWithin(44, 12, 44),
    (v) => v.setUint32(40, 1),
    (v) => v.setUint16(12, 0),
    (v) => v.setUint32(16, 0x110000),
    (v) => v.setFloat64(20, NaN),
    (v) => v.setFloat64(20, Infinity),
    (v) => v.setFloat64(20, -1),
    (v) => v.setFloat64(20, 201),
    (v) => v.setUint16(32, 201),
    (v) => v.setUint16(34, 201),
    (v) => v.setUint32(36, 0xffffffff),
    (_, b) => {
      b[b.length - 1] = 32;
    },
  ];
  for (const change of changes) expect(() => codec.unpack(corrupt(change), 0, 1, keys)).toThrow();
});
it('수집·조립 묶음은 명시한 형식만 받고 순서·잔여 바이트·상한을 유지한다', () => {
  const json = packAtlasChunk(atlas, 0, 1),
    binary = frame();
  expect(() => packAtlasBundle([json], codec)).toThrow();
  expect(() => packAtlasBundle([binary])).toThrow();
  expect(() => unpackAtlasBundle(packAtlasBundle([json]), 1, codec)).toThrow();
  expect(() => unpackAtlasBundle(packAtlasBundle([binary], codec), 1)).toThrow();
  const bundle = packAtlasBundle([binary], codec);
  expect(unpackAtlasBundle(bundle, 1, codec)).toEqual([binary]);
  expect(() => unpackAtlasBundle(new Uint8Array([...bundle, 0]), 1, codec)).toThrow();
  expect(() => unpackAtlasBundle(bundle.subarray(0, -1), 1, codec)).toThrow();
  expect(() =>
    packAtlasBundle(
      Array.from({ length: 30 }, () => binary),
      codec,
    ),
  ).toThrow();
  const huge = Array.from({ length: 5 }, (_, i) =>
    codec.pack({ glyphs: {}, pixels: new Uint8Array(900000) }, i, 5),
  );
  expect(() => packAtlasBundle(huge, codec)).toThrow();
});
