import type { Atlas, Sprite } from './atlas';
import { decodeAtlasPage, type AtlasPageSize } from './atlas-pages';

export const pagesPerChunk = 3;
export const smallPagesPerChunk = 8;
export const maxAtlasChunks = 29; // leaves room within the 32 Worker invocation chain
export type AtlasPageRequest = [string, Set<string>];
export type AtlasChunkCodec = {
  pack: typeof packAtlasChunk;
  unpack: typeof unpackAtlasChunk;
  envelope: typeof validateAtlasChunkEnvelope;
};
export const jsonAtlasChunkCodec: AtlasChunkCodec = {
  pack: packAtlasChunk,
  unpack: unpackAtlasChunk,
  envelope: validateAtlasChunkEnvelope,
};
export function atlasChunks(
  pages: Map<string, Set<string>>,
  chunkSize = pagesPerChunk,
  slots: AtlasPageSize = 1024,
): AtlasPageRequest[][] {
  const all = [...pages];
  const limit = slots === 1024 ? pagesPerChunk : smallPagesPerChunk;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > limit)
    throw new RangeError('글자 처리 묶음 오류');
  if (all.length > chunkSize * maxAtlasChunks) throw new RangeError('글자 처리 단계 한도 초과');
  return Array.from({ length: Math.ceil(all.length / chunkSize) }, (_, index) =>
    all.slice(index * chunkSize, (index + 1) * chunkSize),
  );
}
export function selectAtlas(source: Atlas, keys: Iterable<string>): Atlas {
  const glyphs: Atlas['glyphs'] = {};
  for (const key of keys) {
    const glyph = source.glyphs[key];
    if (!glyph) throw new RangeError('글자 자료 누락');
    glyphs[key] = glyph;
  }
  return { glyphs, pixels: source.pixels };
}
export function mergeAtlases(parts: Atlas[], advance?: Atlas['advance']): Atlas {
  const glyphs: Atlas['glyphs'] = {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (const part of parts)
    for (const [key, glyph] of Object.entries(part.glyphs)) {
      if (Object.hasOwn(glyphs, key)) throw new RangeError('중복 글자 자료');
      const pixels = part.pixels.subarray(glyph.offset, glyph.offset + glyph.width * glyph.height);
      glyphs[key] = { ...glyph, offset: length };
      length += pixels.length;
      if (length > 2 * 1048576) throw new RangeError('글자 조립 용량 초과');
      chunks.push(pixels);
    }
  const pixels = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    pixels.set(part, offset);
    offset += part.length;
  }
  return advance ? { glyphs, pixels, advance } : { glyphs, pixels };
}
export async function loadAtlasChunk(
  requests: AtlasPageRequest[],
  getPage: (name: string) => Promise<Uint8Array>,
  slots: AtlasPageSize = 1024,
  decodePage: typeof decodeAtlasPage = decodeAtlasPage,
): Promise<Atlas> {
  if (!requests.length || requests.length > (slots === 1024 ? pagesPerChunk : smallPagesPerChunk))
    throw new RangeError('글자 처리 묶음 오류');
  const parts = [];
  for (const [name, keys] of requests) parts.push(decodePage(await getPage(name), keys, slots));
  return mergeAtlases(parts);
}
export function packAtlasChunk(
  atlas: Atlas,
  index: number,
  total: number,
): Uint8Array<ArrayBuffer> {
  const metadata = new TextEncoder().encode(JSON.stringify(atlas.glyphs));
  const result = new Uint8Array(12 + metadata.length + atlas.pixels.length);
  if (result.length > 1048576) throw new RangeError('글자 응답 용량 초과');
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x41544331);
  view.setUint32(4, metadata.length);
  view.setUint16(8, index);
  view.setUint16(10, total);
  result.set(metadata, 12);
  result.set(atlas.pixels, 12 + metadata.length);
  return result;
}
export function unpackAtlasChunk(
  data: Uint8Array,
  index: number,
  total: number,
  keys: Set<string>,
): Atlas {
  const length = validateAtlasChunkEnvelope(data, index, total);
  const value: unknown = JSON.parse(new TextDecoder().decode(data.subarray(12, 12 + length)));
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.size
  )
    throw new RangeError('글자 응답 목록 오류');
  const glyphs = value as Record<string, Sprite>;
  const pixels = data.subarray(12 + length);
  for (const [key, glyph] of Object.entries(glyphs)) {
    if (
      !keys.has(key) ||
      !glyph ||
      typeof glyph !== 'object' ||
      !Number.isFinite(glyph.advance) ||
      glyph.advance < 0 ||
      glyph.advance > 200 ||
      ![glyph.left, glyph.top, glyph.width, glyph.height, glyph.offset].every(Number.isInteger) ||
      glyph.width < 0 ||
      glyph.width > 200 ||
      glyph.height < 0 ||
      glyph.height > 200 ||
      glyph.offset < 0 ||
      glyph.offset + glyph.width * glyph.height > pixels.length
    )
      throw new RangeError('글자 응답 범위 오류');
  }
  for (const alpha of pixels) if (alpha > 31) throw new RangeError('글자 응답 픽셀 오류');
  return { glyphs, pixels };
}
// Opaque relay validation. Full metadata/key/pixel validation still runs in the
// assembler; this envelope alone must never authorize painting a glyph.
export function validateAtlasChunkEnvelope(data: Uint8Array, index: number, total: number): number {
  if (data.length < 12 || data.length > 1048576) throw new RangeError('글자 응답 크기 오류');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(4);
  if (
    view.getUint32(0) !== 0x41544331 ||
    view.getUint16(8) !== index ||
    view.getUint16(10) !== total ||
    length > 262144 ||
    12 + length > data.length
  )
    throw new RangeError('글자 응답 형식 오류');
  return length;
}
