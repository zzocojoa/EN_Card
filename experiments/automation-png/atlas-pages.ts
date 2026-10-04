import { inflateSync } from 'node:zlib';
import { type CardInput } from '../../src/shared/model';
import { atlasKey, prepareAtlasCard, type Atlas } from './atlas';

export type AtlasMetrics = { points: number[]; weights: Record<string, Record<string, number>> };
export const pageSize = 1024;
export type AtlasPageSize = 1024 | 64 | 32;
export function decodeCommonAtlas(bytes: Uint8Array): Atlas {
  const data = new Uint8Array(inflateSync(bytes, { maxOutputLength: 16 * 1048576 }));
  const length = new DataView(data.buffer).getUint32(0);
  if (length > 2 * 1048576 || 4 + length > data.length)
    throw new RangeError('공통 글자 인덱스 오류');
  const glyphs = JSON.parse(
    new TextDecoder().decode(data.subarray(4, 4 + length)),
  ) as Atlas['glyphs'];
  return { glyphs, pixels: data.subarray(4 + length) };
}
export function atlasAdvance(metrics: AtlasMetrics) {
  const coverage = new Set(metrics.points);
  return (character: string, size: number, weight: number) => {
    const point = character.codePointAt(0)!;
    if (!coverage.has(point) || !metrics.weights[weight])
      throw new RangeError(`준비되지 않은 문자: U+${point.toString(16)}`);
    return (metrics.weights[weight]![point] ?? 1) * size;
  };
}
// ATG1: 16-byte header, 1024 direct-address 32-byte glyph records, then separately
// compressed glyphs. Only requested glyphs are inflated, never a whole alphabet.
export function decodeAtlasPage(
  data: Uint8Array,
  keys: Iterable<string>,
  slots: AtlasPageSize = pageSize,
): Atlas {
  const headerBytes = 16 + slots * 32;
  if (data.length < headerBytes || data.length > 4 * 1048576)
    throw new RangeError('글자 페이지 크기 오류');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== 0x41544731 || view.getUint32(12) !== slots)
    throw new RangeError('글자 페이지 형식 오류');
  const base = view.getUint32(4);
  const size = view.getUint16(8);
  const weight = view.getUint16(10);
  const glyphs: Atlas['glyphs'] = {};
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const key of keys) {
    const [keyWeight, keySize, point] = key.split(':').map(Number);
    if (
      keyWeight !== weight ||
      keySize !== size ||
      !Number.isInteger(point) ||
      point! < base ||
      point! >= base + slots
    )
      throw new RangeError('글자 페이지 식별자 오류');
    const record = 16 + (point! - base) * 32;
    if (view.getUint32(record + 24) !== 1)
      throw new RangeError('글자 페이지에 필요한 문자가 없습니다.');
    const advance = view.getFloat64(record);
    const left = view.getInt16(record + 8);
    const top = view.getInt16(record + 10);
    const width = view.getUint16(record + 12);
    const height = view.getUint16(record + 14);
    const start = view.getUint32(record + 16);
    const length = view.getUint32(record + 20);
    if (
      !Number.isFinite(advance) ||
      advance < 0 ||
      width > 200 ||
      height > 200 ||
      start < headerBytes ||
      start + length > data.length
    )
      throw new RangeError('글자 페이지 범위 오류');
    const pixels = new Uint8Array(
      inflateSync(data.subarray(start, start + length), { maxOutputLength: 40000 }),
    );
    if (pixels.length !== width * height || pixels.some((alpha) => alpha > 31))
      throw new RangeError('글자 픽셀 오류');
    glyphs[key] = { advance, left, top, width, height, offset };
    offset += pixels.length;
    chunks.push(pixels);
  }
  const pixels = new Uint8Array(offset);
  offset = 0;
  for (const bytes of chunks) {
    pixels.set(bytes, offset);
    offset += bytes.length;
  }
  return { glyphs, pixels };
}
export function planCardAtlas(
  card: CardInput,
  advance: ReturnType<typeof atlasAdvance>,
  number = 1,
  common?: Atlas,
  slots: AtlasPageSize = pageSize,
) {
  const prepared = prepareAtlasCard(
    card,
    (text, css) => {
      const match = /^(\d+) (\d+)px /.exec(css)!;
      return Array.from(text).reduce(
        (sum, character) => sum + advance(character, Number(match[2]), Number(match[1])),
        0,
      );
    },
    number,
  );
  const { card: input, layout } = prepared;
  const texts = [
    ...layout.lines,
    {
      text: `${String(number).padStart(3, '0')}  /  ${input.template === 'comparison' ? '표현 비교' : '오늘의 표현'}`,
      size: 22,
      weight: 600,
    },
    { text: '하루 한 표현', size: 20, weight: 400 },
  ];
  const pages = new Map<string, Set<string>>();
  const commonKeys = new Set<string>();
  for (const { text, size, weight } of texts) {
    for (const character of text) {
      advance(character, size, weight);
      const key = atlasKey(character, size, weight);
      if (common?.glyphs[key]) {
        commonKeys.add(key);
        continue;
      }
      const name = `${weight}-${size}-${Math.floor(character.codePointAt(0)! / slots)}.bin`;
      const keys = pages.get(name) ?? new Set<string>();
      keys.add(key);
      pages.set(name, keys);
    }
  }
  return { pages, commonKeys, prepared };
}
export async function loadCardAtlas(
  card: CardInput,
  advance: ReturnType<typeof atlasAdvance>,
  getPage: (name: string) => Promise<Uint8Array>,
  number = 1,
  common?: Atlas,
): Promise<Atlas> {
  const { pages, commonKeys } = planCardAtlas(card, advance, number, common);
  if (pages.size > 48)
    throw new RangeError('한 카드의 글자 페이지가 너무 많습니다. 내용을 줄여주세요.');
  const glyphs: Atlas['glyphs'] = {};
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const key of commonKeys) {
    const glyph = common!.glyphs[key]!;
    const bytes = common!.pixels.slice(glyph.offset, glyph.offset + glyph.width * glyph.height);
    glyphs[key] = { ...glyph, offset };
    offset += bytes.length;
    chunks.push(bytes);
  }
  // Sequential loading bounds memory and counts every actual asset fetch. Copy
  // only required glyphs, then allow the full page to be collected.
  for (const [name, keys] of pages) {
    const page = decodeAtlasPage(await getPage(name), keys);
    for (const key of keys) {
      const glyph = page.glyphs[key];
      if (!glyph) throw new RangeError('글자 페이지에 필요한 문자가 없습니다.');
      const bytes = page.pixels.slice(glyph.offset, glyph.offset + glyph.width * glyph.height);
      glyphs[key] = { ...glyph, offset };
      offset += bytes.length;
      chunks.push(bytes);
    }
  }
  const pixels = new Uint8Array(offset);
  offset = 0;
  for (const bytes of chunks) {
    pixels.set(bytes, offset);
    offset += bytes.length;
  }
  return { glyphs, pixels, advance };
}
