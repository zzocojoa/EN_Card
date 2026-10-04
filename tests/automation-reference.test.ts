import { expect, it } from 'vitest';
import { referenceAtlases } from '../experiments/automation-png/atlas-reference';
import { mergeAtlases } from '../experiments/automation-png/atlas-chunks';
import {
  atlasKey,
  atlasPngPrepared,
  type Atlas,
  type PreparedAtlasCard,
} from '../experiments/automation-png/atlas';
import { paintExtracted, paintPacked, paintSpans } from '../experiments/automation-png/atlas-blit';
import { fixtures } from '../experiments/automation-png/fixtures';

function example() {
  const prepared: PreparedAtlasCard = {
    card: fixtures.expression!,
    number: 1,
    layout: {
      dividerY: 410,
      lines: [
        { text: '가😀AA', x: 100, y: 200, size: 40, weight: 700, color: '#10151f' },
        { text: 'A가😀', x: 101, y: 200, size: 40, weight: 700, color: '#214de5' },
      ],
    },
  };
  const texts = [
    { text: '001  /  오늘의 표현', size: 22, weight: 600 },
    { text: '하루 한 표현', size: 20, weight: 400 },
    ...prepared.layout.lines,
  ];
  const parts: Atlas[] = [];
  const seen = new Set<string>();
  for (const line of texts)
    for (const character of line.text) {
      const key = atlasKey(character, line.size, line.weight);
      if (seen.has(key)) continue;
      seen.add(key);
      // Distinct, unaligned backing views and nonzero source offsets. Small
      // advances intentionally overlap glyphs; spaces have zero-size pixels.
      const pixels = new Uint8Array(24).subarray(3, 20);
      pixels.set([0, 31, 12, 5, 0, 31, 4, 31, 0], 4);
      const width = character === ' ' ? 0 : 3;
      parts.push({
        glyphs: { [key]: { width, height: width, offset: 4, left: -1, top: -1, advance: 1.25 } },
        pixels,
      });
    }
  return { prepared, parts };
}

it('keeps original pixel views and offsets without allocating the merged pixel buffer', () => {
  const { parts } = example();
  const actual = referenceAtlases(parts);
  expect(actual.pixels.byteLength).toBe(0);
  for (const part of parts)
    for (const [key, glyph] of Object.entries(part.glyphs)) {
      expect(actual.glyphs[key]).toBe(glyph);
      expect(actual.pixelSources![key]).toBe(part.pixels);
    }
  expect(mergeAtlases(parts).pixels.byteLength).toBeGreaterThan(0);
});

it.each([1080, 800, 720] as const)(
  '%i: references preserve PNG, overlaps, colors, empty glyphs and source data',
  (size) => {
    const { prepared, parts } = example();
    const before = parts.map((part) => part.pixels.slice());
    const metadata = JSON.stringify(parts.map((part) => part.glyphs));
    const baseline = atlasPngPrepared(prepared, mergeAtlases(parts), { size, rle: true });
    for (const painter of [undefined, paintExtracted, paintPacked, paintSpans]) {
      const actual = atlasPngPrepared(prepared, referenceAtlases(parts), {
        size,
        rle: true,
        nativeCrc: true,
        ...(painter ? { painter } : {}),
      });
      expect(actual).toEqual(baseline);
    }
    parts.forEach((part, index) => expect(part.pixels).toEqual(before[index]));
    expect(JSON.stringify(parts.map((part) => part.glyphs))).toBe(metadata);
  },
);

it('preserves duplicate and aggregate selected-pixel limits even when sources are shared', () => {
  const { parts } = example();
  expect(() => referenceAtlases([parts[0]!, parts[0]!])).toThrow('중복');
  const pixels = new Uint8Array(40000);
  const large: Atlas[] = Array.from({ length: 53 }, (_, index) => ({
    pixels,
    glyphs: {
      [`700:40:${index + 100}`]: {
        width: 200,
        height: 200,
        offset: 0,
        top: 0,
        left: 0,
        advance: 1,
      },
    },
  }));
  expect(() => referenceAtlases(large.slice(0, 52))).not.toThrow();
  expect(() => referenceAtlases(large)).toThrow('용량');
  expect(() => mergeAtlases(large)).toThrow('용량');
});

it('fails closed on missing sources and keeps request-local mappings isolated', () => {
  const { prepared, parts } = example();
  const first = referenceAtlases(parts),
    second = referenceAtlases(parts);
  const key = Object.keys(parts[0]!.glyphs)[0]!;
  delete first.pixelSources![key];
  expect(() => atlasPngPrepared(prepared, first)).toThrow('픽셀 자료 누락');
  expect(() => atlasPngPrepared(prepared, second)).not.toThrow();
  delete second.glyphs[key];
  expect(() => atlasPngPrepared(prepared, second)).toThrow('준비되지 않은 문자');
});
