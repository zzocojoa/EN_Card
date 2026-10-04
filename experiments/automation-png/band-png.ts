import { packPng } from './native-png';
import { validatePng } from '../../src/worker/png';

export const BAND_HEIGHT = 90;
export const BAND_COUNT = 1080 / BAND_HEIGHT;
const STRIDE = 1080 * 4 + 1;
const MOD = 65521;
export type PngBand = { index: number; adler32: number; deflate: Uint8Array };

export function joinBands(bands: PngBand[]): Uint8Array<ArrayBuffer> {
  if (bands.length !== BAND_COUNT) throw new RangeError('PNG 구간이 부족합니다.');
  let a = 1;
  let b = 0;
  let bytes = 8; // zlib header, final empty DEFLATE block, Adler-32 trailer.
  for (const [index, band] of bands.entries()) {
    if (
      band.index !== index ||
      !Number.isInteger(band.adler32) ||
      band.adler32 < 0 ||
      band.adler32 > 0xffffffff ||
      band.deflate.length < 5 ||
      band.deflate.length > 1048576 ||
      ![0, 0, 255, 255].every((value, n) => band.deflate[band.deflate.length - 4 + n] === value)
    )
      throw new RangeError('PNG 구간 순서·체크섬·종료 형식이 잘못되었습니다.');
    const nextA = band.adler32 & 0xffff;
    const nextB = band.adler32 >>> 16;
    b = (b + nextB + STRIDE * BAND_HEIGHT * (a - 1)) % MOD;
    if (b < 0) b += MOD;
    a = (a + nextA - 1) % MOD;
    if (a < 0) a += MOD;
    bytes += band.deflate.length;
  }
  if (bytes + 57 > 1048576) throw new RangeError('PNG가 1MiB를 초과합니다.');
  const compressed = new Uint8Array(bytes);
  compressed.set([0x78, 0x01]);
  let offset = 2;
  for (const band of bands) {
    compressed.set(band.deflate, offset);
    offset += band.deflate.length;
  }
  compressed.set([3, 0], offset); // BFINAL=1, fixed tree, end-of-block only.
  new DataView(compressed.buffer).setUint32(offset + 2, ((b << 16) | a) >>> 0);
  const png = packPng(compressed);
  validatePng(png);
  return png;
}
