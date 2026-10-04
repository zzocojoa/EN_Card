import { Resvg } from '@resvg/resvg-wasm';
import { deflateSync } from 'node:zlib';
import type { CardFonts } from './svg';
import { atlasKey, type Atlas } from './atlas';
import { pageSize } from './atlas-pages';

// Finite styles used by the existing layout at each allowed scale. Full glyph
// coverage/storage is a separate gate; the first lab atlas uses explicit input.
export const atlasStyles = [
  ...new Map(
    [
      ...[
        [82, 800],
        [66, 800],
        [44, 650],
        [32, 450],
        [30, 450],
        [44, 700],
        [36, 500],
        [28, 400],
      ].flatMap(([size, weight]) =>
        [1, 0.95, 0.9, 0.85, 0.8].map(
          (scale) => [Math.max(26, Math.round(size! * scale)), weight!] as const,
        ),
      ),
      [22, 600],
      [20, 400],
    ].map(([size, weight]) => [`${weight}:${size}`, { size: size!, weight: weight! }]),
  ).values(),
];

export function buildAtlas(
  fonts: CardFonts,
  characters: string,
  styles = atlasStyles,
  scale = 1,
): Atlas {
  const glyphs: Atlas['glyphs'] = {};
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const { size, weight } of styles) {
    for (const character of new Set(characters)) {
      if (character === '\n' || character === '\r') continue;
      const { svg, ...sprite } = fonts.sprite(character, size * scale, weight);
      const alpha = new Uint8Array(sprite.width * sprite.height);
      if (svg) {
        const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
        try {
          const rendered = renderer.render();
          try {
            const rgba = rendered.pixels;
            for (let index = 0; index < alpha.length; index++)
              alpha[index] = Math.round((rgba[index * 4 + 3]! * 31) / 255);
          } finally {
            rendered.free();
          }
        } finally {
          renderer.free();
        }
      }
      glyphs[atlasKey(character, size, weight)] = { ...sprite, offset };
      chunks.push(alpha);
      offset += alpha.length;
    }
  }
  const pixels = new Uint8Array(offset);
  offset = 0;
  for (const chunk of chunks) {
    pixels.set(chunk, offset);
    offset += chunk.length;
  }
  return { glyphs, pixels };
}

export function encodeAtlasPage(
  atlas: Atlas,
  page: number,
  style: { size: number; weight: number },
  slots: 1024 | 64 | 32 = pageSize,
): Uint8Array {
  const header = new Uint8Array(16 + slots * 32);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x41544731);
  view.setUint32(4, page * slots);
  view.setUint16(8, style.size);
  view.setUint16(10, style.weight);
  view.setUint32(12, slots);
  const parts: Uint8Array[] = [header];
  let length = header.length;
  for (const [key, glyph] of Object.entries(atlas.glyphs)) {
    const [weight, size, point] = key.split(':').map(Number);
    if (weight !== style.weight || size !== style.size || Math.floor(point! / slots) !== page)
      throw new RangeError('글자 페이지 구성 오류');
    const record = 16 + (point! % slots) * 32;
    const bytes = deflateSync(
      atlas.pixels.subarray(glyph.offset, glyph.offset + glyph.width * glyph.height),
    );
    view.setFloat64(record, glyph.advance);
    view.setInt16(record + 8, glyph.left);
    view.setInt16(record + 10, glyph.top);
    view.setUint16(record + 12, glyph.width);
    view.setUint16(record + 14, glyph.height);
    view.setUint32(record + 16, length);
    view.setUint32(record + 20, bytes.length);
    view.setUint32(record + 24, 1);
    parts.push(bytes);
    length += bytes.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
