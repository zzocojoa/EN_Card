import { inflateSync } from 'node:zlib';
import type { Atlas } from './atlas';
import type { decodeAtlasPage } from './atlas-pages';

export type BlockSize = 4 | 8;
export type BlockStats = { calls: number; compressedBytes: number; inflatedBytes: number };
export const blockPageSlots = 64;
export function blockHeaderBytes(blockSize: BlockSize) {
  return 24 + blockPageSlots * 32 + (blockPageSlots / blockSize) * 16;
}
// ATG2 (big endian): header24: magic/base/style/slots as ATG1, blockSize:u16@16,
// reserved:u16@18, blockCount:u32@20. Each direct-address glyph record32 keeps
// advance/left/top/width/height, then offset WITHIN block:u32@16, reserved@20,
// present:u32@24, reserved@28. The slot determines its block (floor(slot/N)).
// Block table16: compressed start/length, inflated length, reserved zero.
// Cache is per page decode call; there is no cross-request warm glyph cache.
export function blockPageDecoder(blockSize: BlockSize, stats?: BlockStats): typeof decodeAtlasPage {
  if (blockSize !== 4 && blockSize !== 8) throw new RangeError('압축 블록 크기 오류');
  return (data, keys, slots = blockPageSlots) => {
    const headerBytes = blockHeaderBytes(blockSize);
    if (slots !== blockPageSlots || data.length < headerBytes || data.length > 4 * 1048576)
      throw new RangeError('블록 페이지 크기 오류');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const base = view.getUint32(4),
      size = view.getUint16(8),
      weight = view.getUint16(10);
    if (
      view.getUint32(0) !== 0x41544732 ||
      view.getUint32(12) !== slots ||
      view.getUint16(16) !== blockSize ||
      view.getUint16(18) !== 0 ||
      view.getUint32(20) !== slots / blockSize ||
      base % slots !== 0 ||
      base + slots > 0x110000 ||
      size === 0 ||
      weight === 0
    )
      throw new RangeError('블록 페이지 형식 오류');
    const glyphs: Atlas['glyphs'] = {},
      blocks = new Map<number, Uint8Array>();
    const parts: Uint8Array[] = [];
    let length = 0;
    for (const key of keys) {
      const [keyWeight, keySize, point] = key.split(':').map(Number);
      if (
        keyWeight !== weight ||
        keySize !== size ||
        !Number.isInteger(point) ||
        point! < base ||
        point! >= base + slots ||
        key !== `${weight}:${size}:${point}` ||
        Object.hasOwn(glyphs, key)
      )
        throw new RangeError('블록 글자 식별자 오류');
      const slot = point! - base,
        record = 24 + slot * 32;
      if (
        view.getUint32(record + 24) !== 1 ||
        view.getUint32(record + 20) !== 0 ||
        view.getUint32(record + 28) !== 0
      )
        throw new RangeError('블록 글자 레코드 오류');
      const advance = view.getFloat64(record),
        left = view.getInt16(record + 8),
        top = view.getInt16(record + 10),
        width = view.getUint16(record + 12),
        height = view.getUint16(record + 14),
        start = view.getUint32(record + 16);
      const block = Math.floor(slot / blockSize),
        table = 24 + slots * 32 + block * 16;
      const packedStart = view.getUint32(table),
        packedLength = view.getUint32(table + 4),
        rawLength = view.getUint32(table + 8);
      if (
        !Number.isFinite(advance) ||
        advance < 0 ||
        advance > 200 ||
        width > 200 ||
        height > 200 ||
        rawLength > blockSize * 40000 ||
        start + width * height > rawLength ||
        packedStart < headerBytes ||
        packedLength === 0 ||
        packedStart + packedLength > data.length ||
        view.getUint32(table + 12) !== 0
      )
        throw new RangeError('블록 글자 범위 오류');
      let pixels = blocks.get(block);
      if (!pixels) {
        pixels = new Uint8Array(
          inflateSync(data.subarray(packedStart, packedStart + packedLength), {
            maxOutputLength: Math.max(1, rawLength),
          }),
        );
        if (pixels.length !== rawLength || pixels.some((alpha) => alpha > 31))
          throw new RangeError('블록 픽셀 오류');
        blocks.set(block, pixels);
        if (stats) {
          stats.calls++;
          stats.compressedBytes += packedLength;
          stats.inflatedBytes += pixels.length;
        }
      }
      glyphs[key] = { advance, left, top, width, height, offset: length };
      const selected = pixels.subarray(start, start + width * height);
      parts.push(selected);
      length += selected.length;
    }
    const pixels = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      pixels.set(part, offset);
      offset += part.length;
    }
    return { glyphs, pixels };
  };
}
