import { constants, deflateRawSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-wasm';
import { BAND_COUNT, BAND_HEIGHT, type PngBand } from './band-png';
export { BAND_COUNT, joinBands } from './band-png';

// Lab for bounded work units. Every band is an independent compression stream
// ending on a non-final, byte-aligned DEFLATE block. Join once into ONE zlib
// stream; concatenating independently finished zlib streams is invalid PNG.

const STRIDE = 1080 * 4 + 1;
const MOD = 65521;

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let start = 0; start < bytes.length; start += 4096) {
    const end = Math.min(bytes.length, start + 4096);
    for (let index = start; index < end; index++) {
      a += bytes[index]!;
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

export function renderBand(svg: string, index: number): PngBand {
  if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT)
    throw new RangeError('잘못된 PNG 구간입니다.');
  const dimensions = 'width="1080" height="1080" viewBox="0 0 1080 1080"';
  if (!svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}>`))
    throw new RangeError('고정 카드 SVG만 허용합니다.');
  // Preserve global raster coordinates: changing the viewport moves resvg's
  // anti-aliasing edges. Remove only glyphs whose trusted font bounds cannot
  // touch this band, then extract rows from the same-sized pixel surface.
  const top = index * BAND_HEIGHT;
  const bottom = top + BAND_HEIGHT;
  const selected = svg.replace(/<path\b[^>]*\/>/g, (path) => {
    const bounds = /^<path data-top="([^"]+)" data-bottom="([^"]+)"/.exec(path);
    if (!bounds || !Number.isFinite(Number(bounds[1])) || !Number.isFinite(Number(bounds[2])))
      throw new RangeError('사전 계산한 글리프 경계가 필요합니다.');
    return Number(bounds[2]) < top - 1 || Number(bounds[1]) > bottom + 1 ? '' : path;
  });
  const renderer = new Resvg(selected, { font: { loadSystemFonts: false } });
  try {
    const rendered = renderer.render();
    try {
      if (rendered.width !== 1080 || rendered.height !== 1080)
        throw new RangeError('잘못된 PNG 구간 크기입니다.');
      const pixels = rendered.pixels;
      const rows = new Uint8Array(STRIDE * BAND_HEIGHT);
      const firstRow = top;
      for (let row = 0; row < BAND_HEIGHT; row++)
        rows.set(
          pixels.subarray((row + firstRow) * 4320, (row + firstRow + 1) * 4320),
          row * STRIDE + 1,
        );
      const checksum = adler32(rows);
      const deflate = deflateRawSync(rows, { level: 1, finishFlush: constants.Z_SYNC_FLUSH });
      return { index, adler32: checksum, deflate };
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
}
