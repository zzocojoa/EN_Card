import { expect, it } from 'vitest';
import { paintExtracted, paintPacked, paintSpans } from '../experiments/automation-png/atlas-blit';
import type { Sprite } from '../experiments/automation-png/atlas';

it.each([
  ['extracted', paintExtracted],
  ['packed', paintPacked],
  ['spans', paintSpans],
] as const)(
  '%s preserves transparent holes, overlapping colors, unaligned views and row tails',
  (_name, painter) => {
    let random = 7;
    const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    for (const width of [0, 1, 2, 3, 4, 5, 7, 8, 31, 32, 33, 199, 200]) {
      const height = width ? 9 : 0;
      const pixels = new Uint8Array(width * height + 11).subarray(3);
      for (let i = 5; i < pixels.length; i++) pixels[i] = next() % 32;
      // Deliberately include all-transparent / all-nonzero groups and holes.
      pixels.fill(0, 5, Math.min(pixels.length, 13));
      if (pixels.length > 20) pixels.fill(31, 13, 20);
      const stride = width + 14;
      const actual = new Uint8Array(stride * (height + 5) + 9).subarray(5);
      actual.fill(217);
      const expected = actual.slice();
      const original = pixels.slice();
      const glyph: Sprite = { width, height, offset: 5, top: 0, left: 0, advance: width };
      const draw = painter(actual, pixels, stride);
      // Same glyph in every palette color and at overlapping locations.
      for (let color = 0; color < 7; color++) {
        const left = 2 + (color % 3),
          top = 1 + (color % 2);
        draw(glyph, left, top, color * 31);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const alpha = pixels[glyph.offset + y * width + x]!;
            if (alpha !== 0) expected[(top + y) * stride + left + x + 1] = color * 31 + alpha;
          }
        expect(actual).toEqual(expected);
      }
      expect(pixels).toEqual(original);
    }
  },
);

it('packed lanes preserve every alpha pair without cross-byte carry', () => {
  const pixels = new Uint8Array(4),
    actual = new Uint8Array(5);
  const glyph: Sprite = { width: 4, height: 1, offset: 0, top: 0, left: 0, advance: 4 };
  const draw = paintPacked(actual, pixels, 5);
  for (let a = 0; a < 32; a++)
    for (let b = 0; b < 32; b++)
      for (let color = 0; color < 7; color++) {
        pixels.set([a, b, 31 - a, 31 - b]);
        actual.fill(217);
        draw(glyph, 0, 0, color * 31);
        expect([...actual]).toEqual([
          217,
          ...pixels.map((alpha) => (alpha ? color * 31 + alpha : 217)),
        ]);
      }
});
