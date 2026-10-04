import type { Atlas, Sprite } from './atlas';
import { maxAtlasChunks, type AtlasChunkCodec } from './atlas-chunks';

// ATC2: the same 12-byte envelope as ATC1, followed by 32-byte records
// (all big endian), then unchanged 5-bit alpha bytes. Record offsets:
// weight:u16@0, logicalSize:u16@2, codePoint:u32@4, advance:f64@8,
// left:i16@16, top:i16@18, width:u16@20, height:u16@22, offset:u32@24,
// reserved:u32@28 (zero). Float64 preserves the exact JS layout advance.
export const binaryRecordBytes = 32;
function sequence(index: number, total: number) {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > maxAtlasChunks ||
    index < 0 ||
    index >= total
  )
    throw new RangeError('글자 응답 순서 오류');
}
function identity(weight: number, size: number, point: number) {
  return (
    Number.isInteger(weight) &&
    weight > 0 &&
    weight <= 65535 &&
    Number.isInteger(size) &&
    size > 0 &&
    size <= 65535 &&
    Number.isInteger(point) &&
    point >= 0 &&
    point <= 0x10ffff &&
    (point < 0xd800 || point > 0xdfff)
  );
}
function validGlyph(glyph: Sprite, pixelLength: number) {
  if (
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
    glyph.offset + glyph.width * glyph.height > pixelLength
  )
    throw new RangeError('글자 응답 범위 오류');
}
export const binaryAtlasChunkCodec: AtlasChunkCodec = {
  pack(atlas, index, total) {
    sequence(index, total);
    const entries = Object.entries(atlas.glyphs);
    const length = entries.length * binaryRecordBytes;
    if (length > 262144 || 12 + length + atlas.pixels.length > 1048576)
      throw new RangeError('글자 응답 용량 초과');
    const result = new Uint8Array(12 + length + atlas.pixels.length);
    const view = new DataView(result.buffer);
    view.setUint32(0, 0x41544332);
    view.setUint32(4, length);
    view.setUint16(8, index);
    view.setUint16(10, total);
    for (const [i, [key, glyph]] of entries.entries()) {
      const values = key.split(':').map(Number);
      const [weight, size, point] = values;
      if (
        values.length !== 3 ||
        !identity(weight!, size!, point!) ||
        key !== `${weight}:${size}:${point}`
      )
        throw new RangeError('글자 응답 식별자 오류');
      validGlyph(glyph, atlas.pixels.length);
      const at = 12 + i * binaryRecordBytes;
      view.setUint16(at, weight!);
      view.setUint16(at + 2, size!);
      view.setUint32(at + 4, point!);
      view.setFloat64(at + 8, glyph.advance);
      view.setInt16(at + 16, glyph.left);
      view.setInt16(at + 18, glyph.top);
      view.setUint16(at + 20, glyph.width);
      view.setUint16(at + 22, glyph.height);
      view.setUint32(at + 24, glyph.offset);
    }
    result.set(atlas.pixels, 12 + length);
    return result;
  },
  envelope(data, index, total) {
    sequence(index, total);
    if (data.length < 12 || data.length > 1048576) throw new RangeError('글자 응답 크기 오류');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const length = view.getUint32(4);
    if (
      view.getUint32(0) !== 0x41544332 ||
      view.getUint16(8) !== index ||
      view.getUint16(10) !== total ||
      length > 262144 ||
      length % binaryRecordBytes !== 0 ||
      12 + length > data.length
    )
      throw new RangeError('글자 응답 형식 오류');
    return length;
  },
  unpack(data, index, total, keys) {
    const length = binaryAtlasChunkCodec.envelope(data, index, total);
    if (length / binaryRecordBytes !== keys.size) throw new RangeError('글자 응답 목록 오류');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const pixels = data.subarray(12 + length);
    const glyphs: Atlas['glyphs'] = {};
    for (let at = 12; at < 12 + length; at += binaryRecordBytes) {
      const weight = view.getUint16(at),
        size = view.getUint16(at + 2),
        point = view.getUint32(at + 4);
      const key = `${weight}:${size}:${point}`;
      if (
        !identity(weight, size, point) ||
        !keys.has(key) ||
        Object.hasOwn(glyphs, key) ||
        view.getUint32(at + 28) !== 0
      )
        throw new RangeError('글자 응답 식별자 오류');
      const glyph: Sprite = {
        advance: view.getFloat64(at + 8),
        left: view.getInt16(at + 16),
        top: view.getInt16(at + 18),
        width: view.getUint16(at + 20),
        height: view.getUint16(at + 22),
        offset: view.getUint32(at + 24),
      };
      validGlyph(glyph, pixels.length);
      glyphs[key] = glyph;
    }
    for (const alpha of pixels) if (alpha > 31) throw new RangeError('글자 응답 픽셀 오류');
    return { glyphs, pixels };
  },
};
