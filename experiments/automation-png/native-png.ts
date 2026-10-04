// Feasibility alternative: use the runtime's native deflate stream instead of
// the Wasm PNG encoder. No filtering; preserve the renderer's RGBA pixels exactly.
const CRC = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < 8 + data.length; index++)
    crc = CRC[(crc ^ bytes[index]!) & 255]! ^ (crc >>> 8);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
export function pngScanlines(pixels: Uint8Array): Uint8Array<ArrayBuffer> {
  const width = 1080;
  const height = 1080;
  const stride = width * 4;
  if (pixels.length !== stride * height) throw new RangeError('1080×1080 RGBA가 필요합니다.');
  const rows = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++)
    rows.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  return rows;
}
export async function nativePng(pixels: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const rows = pngScanlines(pixels);
  const compressed = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  return packPng(compressed);
}
export function packPng(compressed: Uint8Array): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, 1080);
  header.setUint32(4, 1080);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array()),
  ];
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
