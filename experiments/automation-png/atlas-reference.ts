import type { Atlas, RenderAtlas } from './atlas';

// Parts must already have passed the same metadata/pixel checks used by the
// copying assembler. Preserve duplicate and aggregate selected-pixel limits.
// References live for this synchronous render only; no cross-request cache.
export function referenceAtlases(parts: Atlas[], advance?: Atlas['advance']): RenderAtlas {
  const glyphs: Atlas['glyphs'] = Object.create(null);
  const pixelSources: Record<string, Uint8Array> = Object.create(null);
  let length = 0;
  for (const part of parts)
    for (const [key, glyph] of Object.entries(part.glyphs)) {
      if (Object.hasOwn(glyphs, key)) throw new RangeError('중복 글자 자료');
      length += glyph.width * glyph.height;
      if (length > 2 * 1048576) throw new RangeError('글자 조립 용량 초과');
      glyphs[key] = glyph;
      pixelSources[key] = part.pixels;
    }
  const atlas = { glyphs, pixels: new Uint8Array(), pixelSources };
  return advance ? { ...atlas, advance } : atlas;
}
