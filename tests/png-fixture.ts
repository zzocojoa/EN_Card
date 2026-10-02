import { crc32, deflateSync } from 'node:zlib';

export function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(data.length + 12);
  const view: DataView = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}
export function assemble(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(
    8 + chunks.reduce((total, item) => total + item.length, 0),
  );
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset: number = 8;
  for (const item of chunks) {
    bytes.set(item, offset);
    offset += item.length;
  }
  return bytes;
}
function header(): Uint8Array<ArrayBuffer> {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(13);
  new DataView(bytes.buffer).setUint32(0, 1080);
  new DataView(bytes.buffer).setUint32(4, 1080);
  bytes.set([8, 6, 0, 0, 0], 8);
  return bytes;
}
export const PNG_CHUNKS: readonly Uint8Array[] = [
  chunk('IHDR', header()),
  chunk('IDAT', deflateSync(new Uint8Array((1080 * 4 + 1) * 1080))),
  chunk('IEND', new Uint8Array()),
];
const FIXTURE: Uint8Array<ArrayBuffer> = assemble(PNG_CHUNKS);
export function validPng(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(FIXTURE);
}
