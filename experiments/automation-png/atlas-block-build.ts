import { deflateSync } from 'node:zlib';
import type { Atlas } from './atlas';
import { blockHeaderBytes, blockPageSlots, type BlockSize } from './atlas-blocks';

// Offline only: retain every glyph in the source page, including unrequested
// neighbours. No fixture-derived font subset and no runtime compressor.
export function encodeBlockPage(
  atlas: Atlas,
  base: number,
  size: number,
  weight: number,
  blockSize: BlockSize,
): Uint8Array {
  if (
    (blockSize !== 4 && blockSize !== 8) ||
    !Number.isInteger(base) ||
    base < 0 ||
    base % blockPageSlots !== 0 ||
    base + blockPageSlots > 0x110000 ||
    ![size, weight].every((value) => Number.isInteger(value) && value > 0 && value <= 65535)
  )
    throw new RangeError('블록 페이지 구성 오류');
  const header = new Uint8Array(blockHeaderBytes(blockSize)),
    view = new DataView(header.buffer);
  view.setUint32(0, 0x41544732);
  view.setUint32(4, base);
  view.setUint16(8, size);
  view.setUint16(10, weight);
  view.setUint32(12, blockPageSlots);
  view.setUint16(16, blockSize);
  view.setUint32(20, blockPageSlots / blockSize);
  const grouped: Uint8Array[][] = Array.from({ length: blockPageSlots / blockSize }, () => []);
  const lengths = new Uint32Array(grouped.length);
  for (const [key, glyph] of Object.entries(atlas.glyphs)) {
    const [keyWeight, keySize, point] = key.split(':').map(Number);
    if (
      keyWeight !== weight ||
      keySize !== size ||
      !Number.isInteger(point) ||
      point! < base ||
      point! >= base + blockPageSlots ||
      key !== `${weight}:${size}:${point}` ||
      !glyph ||
      !Number.isFinite(glyph.advance) ||
      glyph.advance < 0 ||
      glyph.advance > 200 ||
      ![glyph.left, glyph.top, glyph.width, glyph.height, glyph.offset].every(Number.isInteger) ||
      glyph.left < -32768 ||
      glyph.left > 32767 ||
      glyph.top < -32768 ||
      glyph.top > 32767 ||
      glyph.width < 0 ||
      glyph.width > 200 ||
      glyph.height < 0 ||
      glyph.height > 200 ||
      glyph.offset < 0 ||
      glyph.offset + glyph.width * glyph.height > atlas.pixels.length
    )
      throw new RangeError('블록 글자 구성 오류');
    const slot = point! - base,
      record = 24 + slot * 32,
      block = Math.floor(slot / blockSize);
    const pixels = atlas.pixels.subarray(glyph.offset, glyph.offset + glyph.width * glyph.height);
    if (pixels.some((alpha) => alpha > 31)) throw new RangeError('블록 픽셀 구성 오류');
    view.setFloat64(record, glyph.advance);
    view.setInt16(record + 8, glyph.left);
    view.setInt16(record + 10, glyph.top);
    view.setUint16(record + 12, glyph.width);
    view.setUint16(record + 14, glyph.height);
    view.setUint32(record + 16, lengths[block]!);
    view.setUint32(record + 24, 1);
    grouped[block]!.push(pixels);
    lengths[block]! += pixels.length;
  }
  const parts: Uint8Array[] = [header];
  let length = header.length;
  for (const [block, chunks] of grouped.entries()) {
    if (!chunks.length) continue;
    const pixels = new Uint8Array(lengths[block]!);
    let offset = 0;
    for (const chunk of chunks) {
      pixels.set(chunk, offset);
      offset += chunk.length;
    }
    const compressed = deflateSync(pixels),
      table = 24 + blockPageSlots * 32 + block * 16;
    view.setUint32(table, length);
    view.setUint32(table + 4, compressed.length);
    view.setUint32(table + 8, pixels.length);
    length += compressed.length;
    parts.push(compressed);
  }
  if (length > 4 * 1048576) throw new RangeError('블록 페이지 용량 초과');
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
