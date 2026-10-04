import type { Sprite } from './atlas';

// Internal raster candidates. Caller has validated glyph metadata, alpha 0..31,
// output bounds and a palette base in 0,31,...,186. No cross-request cache.
export type AtlasPainter = (
  rows: Uint8Array,
  pixels: Uint8Array,
  stride: number,
) => (glyph: Sprite, left: number, top: number, colorBase: number) => void;

// Control candidate: isolate the inner loop from layout/string work and hoist
// the palette multiplication, without packed arithmetic or row allocations.
export const paintExtracted: AtlasPainter = (rows, pixels, stride) => {
  return function drawScalarGlyph(glyph, left, top, colorBase) {
    let source = glyph.offset;
    for (let row = 0; row < glyph.height; row++) {
      const destination = (top + row) * stride + left + 1;
      for (let column = 0; column < glyph.width; column++) {
        const alpha = pixels[source++]!;
        if (alpha) rows[destination + column] = colorBase + alpha;
      }
    }
  };
};

export const paintPacked: AtlasPainter = (rows, pixels, stride) => {
  const sourceView = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const outputView = new DataView(rows.buffer, rows.byteOffset, rows.byteLength);
  return function drawPackedGlyph(glyph, left, top, colorBase) {
    const colorWord = colorBase * 0x01010101;
    const bulk = glyph.width - (glyph.width % 4);
    let source = glyph.offset;
    for (let row = 0; row < glyph.height; row++) {
      let target = (top + row) * stride + left + 1;
      const end = source + bulk;
      while (source < end) {
        const alpha = sourceView.getUint32(source, true);
        if (alpha) {
          // Each validated byte is 0..31. Adding 31 sets bit 5 iff nonzero,
          // with no byte carry. Expand those four 0/1 lanes to 0/255 masks.
          const mask = ((((alpha + 0x1f1f1f1f) & 0x20202020) >>> 5) * 255) >>> 0;
          outputView.setUint32(
            target,
            ((alpha + colorWord) & mask) | (outputView.getUint32(target, true) & ~mask),
            true,
          );
        }
        source += 4;
        target += 4;
      }
      for (let column = bulk; column < glyph.width; column++) {
        const alpha = pixels[source++]!;
        if (alpha) rows[target] = colorBase + alpha;
        target++;
      }
    }
  };
};

export const paintSpans: AtlasPainter = (rows, pixels, stride) => {
  type Colored = { bytes: Uint8Array; spans: number[] };
  const cache = new Map<Sprite, Map<number, Colored>>();
  return function drawSpanGlyph(glyph, left, top, colorBase) {
    let colors = cache.get(glyph);
    if (!colors) cache.set(glyph, (colors = new Map()));
    let colored = colors.get(colorBase);
    if (!colored) {
      const bytes = new Uint8Array(glyph.width * glyph.height);
      const spans: number[] = [];
      for (let row = 0; row < glyph.height; row++) {
        let column = 0;
        const offset = row * glyph.width;
        while (column < glyph.width) {
          while (column < glyph.width && pixels[glyph.offset + offset + column] === 0) column++;
          const start = column;
          while (column < glyph.width && pixels[glyph.offset + offset + column] !== 0) {
            bytes[offset + column] = colorBase + pixels[glyph.offset + offset + column]!;
            column++;
          }
          if (column > start) spans.push(row, start, offset + start, column - start);
        }
      }
      colored = { bytes, spans };
      colors.set(colorBase, colored);
    }
    for (let i = 0; i < colored.spans.length; i += 4) {
      const row = colored.spans[i]!;
      const column = colored.spans[i + 1]!;
      const source = colored.spans[i + 2]!;
      const length = colored.spans[i + 3]!;
      rows.set(
        colored.bytes.subarray(source, source + length),
        (top + row) * stride + left + column + 1,
      );
    }
  };
};
