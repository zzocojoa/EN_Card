import { constants, crc32, deflateSync } from 'node:zlib';
import { cardSchema, type CardInput } from '../../src/shared/model';
import { layoutCard, type Layout } from '../../src/web/canvas';
import { validatePng } from '../../src/worker/png';
import type { AtlasPainter } from './atlas-blit';

// Experimental raster font: same source font/layout; integer glyph positions and
// 31 coverage levels. This is a quality/performance candidate, not pixel parity
// with vector antialiasing. Missing glyphs fail instead of substituting silently.
export type Sprite = {
  advance: number;
  left: number;
  top: number;
  width: number;
  height: number;
  offset: number;
};
export type Atlas = {
  glyphs: Record<string, Sprite>;
  pixels: Uint8Array;
  advance?: (character: string, size: number, weight: number) => number;
};
// Internal rendering view only. Wire decoders return Atlas and cannot supply
// this mapping through glyph metadata. Each source retains its own offsets.
export type RenderAtlas = Atlas & { pixelSources?: Record<string, Uint8Array> };
export const atlasKey = (character: string, size: number, weight: number) =>
  `${weight}:${size}:${character.codePointAt(0)}`;
const colors = ['#10151f', '#202631', '#657080', '#214de5', '#6f7886', '#7b8492', '#e3e7ef'];
export type AtlasSize = 1080 | 800 | 720;
export type AtlasRenderOptions = {
  size?: AtlasSize;
  rle?: boolean;
  painter?: AtlasPainter;
  nativeCrc?: boolean;
};
const palette = new Uint8Array(3 * (1 + colors.length * 31));
palette.fill(255, 0, 3);
for (const [index, color] of colors.entries()) {
  const rgb = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
  for (let alpha = 1; alpha <= 31; alpha++)
    for (let channel = 0; channel < 3; channel++)
      palette[(index * 31 + alpha) * 3 + channel] = Math.round(
        255 + ((rgb[channel]! - 255) * alpha) / 31,
      );
}
function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}
export type PreparedAtlasCard = { card: CardInput; layout: Layout; number: number };
export function prepareAtlasCard(
  card: CardInput,
  measure: (text: string, css: string) => number,
  number = 1,
): PreparedAtlasCard {
  const input = cardSchema.parse(card);
  if (!Number.isSafeInteger(number) || number < 1 || number > 999999)
    throw new RangeError('카드 번호를 확인하세요.');
  return { card: input, layout: layoutCard(measure, input), number };
}
export function atlasPng(card: CardInput, atlas: Atlas, number = 1): Uint8Array<ArrayBuffer> {
  const prepared = prepareAtlasCard(
    card,
    (text, css) => {
      const match = /^(\d+) (\d+)px /.exec(css)!;
      let advance = 0;
      for (const character of text) {
        const size = Number(match[2]);
        const weight = Number(match[1]);
        const value =
          atlas.advance?.(character, size, weight) ??
          atlas.glyphs[atlasKey(character, size, weight)]?.advance;
        if (value === undefined)
          throw new RangeError(`준비되지 않은 문자: U+${character.codePointAt(0)!.toString(16)}`);
        advance += value;
      }
      return advance;
    },
    number,
  );
  return atlasPngPrepared(prepared, atlas);
}
export function atlasPngPrepared(
  prepared: PreparedAtlasCard,
  atlas: RenderAtlas,
  options: AtlasRenderOptions = {},
): Uint8Array<ArrayBuffer> {
  return packIndexedPng(
    deflateSync(paintAtlasRows(prepared, atlas, options.size, options.painter), {
      level: 1,
      strategy: options.rle ? constants.Z_RLE : constants.Z_DEFAULT_STRATEGY,
    }),
    options.size,
    options.nativeCrc,
  );
}
// Only pass a plan produced by prepareAtlasCard. This is an internal lab helper,
// never an endpoint accepting client-supplied coordinates or unchecked content.
export function paintAtlasRows(
  prepared: PreparedAtlasCard,
  atlas: RenderAtlas,
  size: AtlasSize = 1080,
  painter?: AtlasPainter,
): Uint8Array<ArrayBuffer> {
  const width = size,
    height = size,
    scale = size / 1080;
  const { card: input, layout, number } = prepared;
  const lookup = (character: string, key: string) => {
    const glyph = atlas.glyphs[key];
    if (!glyph)
      throw new RangeError(`준비되지 않은 문자: U+${character.codePointAt(0)!.toString(16)}`);
    return glyph;
  };
  // Include the PNG filter byte in the surface from the outset: no RGBA surface
  // or second full-size scanline copy. Palette entry zero is opaque white.
  const rows = new Uint8Array((width + 1) * height);
  const paintGlyph = !atlas.pixelSources ? painter?.(rows, atlas.pixels, width + 1) : undefined;
  const sourcePainters =
    atlas.pixelSources && painter ? new Map<Uint8Array, ReturnType<AtlasPainter>>() : undefined;
  const paintText = (
    text: string,
    x: number,
    y: number,
    size: number,
    weight: number,
    color: string,
  ) => {
    const colorIndex = colors.indexOf(color);
    if (colorIndex < 0) throw new RangeError('준비되지 않은 색상입니다.');
    let cursor = x * scale;
    for (const character of text) {
      const key = atlasKey(character, size, weight);
      const glyph = lookup(character, key);
      const pixels = atlas.pixelSources ? atlas.pixelSources[key] : atlas.pixels;
      if (!pixels) throw new RangeError('글자 픽셀 자료 누락');
      let drawGlyph = paintGlyph;
      if (sourcePainters) {
        drawGlyph = sourcePainters.get(pixels);
        if (!drawGlyph) {
          drawGlyph = painter!(rows, pixels, width + 1);
          sourcePainters.set(pixels, drawGlyph);
        }
      }
      const left = Math.round(cursor) + glyph.left;
      const top = Math.round(y * scale) + glyph.top;
      if (left < 0 || top < 0 || left + glyph.width > width || top + glyph.height > height)
        throw new RangeError('글자가 이미지 영역을 벗어납니다.');
      if (drawGlyph) drawGlyph(glyph, left, top, colorIndex * 31);
      else {
        let source = glyph.offset;
        for (let row = 0; row < glyph.height; row++) {
          const destination = (top + row) * (width + 1) + left + 1;
          for (let column = 0; column < glyph.width; column++) {
            const alpha = pixels[source++]!;
            if (alpha) rows[destination + column] = colorIndex * 31 + alpha;
          }
        }
      }
      cursor += glyph.advance;
    }
  };
  const rectangle = (x: number, y: number, w: number, h: number, color: string) => {
    const index = (colors.indexOf(color) + 1) * 31;
    const left = Math.round(x * scale),
      right = Math.round((x + w) * scale);
    for (
      let row = Math.round(y * scale);
      row < Math.round(y * scale) + Math.max(1, Math.round(h * scale));
      row++
    )
      rows.fill(index, row * (width + 1) + left + 1, row * (width + 1) + right + 1);
  };
  rectangle(88, 83, 38, 5, '#214de5');
  paintText(
    `${String(number).padStart(3, '0')}  /  ${input.template === 'comparison' ? '표현 비교' : '오늘의 표현'}`,
    146,
    72,
    22,
    600,
    '#657080',
  );
  if (layout.dividerY !== null) rectangle(88, layout.dividerY, 904, 2, '#e3e7ef');
  for (const line of layout.lines)
    paintText(line.text, line.x, line.y, line.size, line.weight, line.color);
  paintText('하루 한 표현', 88, 1015, 20, 400, '#7b8492');
  return rows;
}
export function packIndexedPng(
  compressed: Uint8Array,
  size: AtlasSize = 1080,
  nativeCrc = false,
): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr.set([8, 3, 0, 0, 0], 8);
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    chunk('PLTE', palette),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array()),
  ];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  validatePng(result, size, nativeCrc ? nativePngCrc : undefined);
  return result;
}

export const nativePngCrc = (bytes: Uint8Array, start: number, end: number) =>
  crc32(bytes.subarray(start, end));
