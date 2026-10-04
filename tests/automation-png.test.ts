import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { CardFonts, cardSvg } from '../experiments/automation-png/svg';
import { loadFonts } from '../experiments/automation-png/fonts';
import { fixtures } from '../experiments/automation-png/fixtures';
import { rasterize, rasterizeNative } from '../experiments/automation-png/raster';
import { fastPng, rasterizeFast } from '../experiments/automation-png/fast-png';
import { BAND_COUNT, joinBands, renderBand } from '../experiments/automation-png/bands';
import { validatePng } from '../src/worker/png';

let fonts: CardFonts;
beforeAll(async () => {
  fonts = new CardFonts(await loadFonts());
  await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
});

describe('무료 무인 PNG 실행 가능성 검증 (실제 AI·발송 없음)', () => {
  it.each(Object.keys(fixtures))(
    '%s: 두 인코더의 PNG 구조·크기와 RGBA 일치를 검증한다',
    async (name) => {
      const svg = cardSvg(fixtures[name]!, fonts);
      const baseline = rasterize(svg);
      expect(() => validatePng(baseline)).not.toThrow();
      const native = await rasterizeNative(svg);
      expect(() => validatePng(native)).not.toThrow();
      expect(native.length).toBeLessThanOrEqual(1048576);
      // The alternate encoder uses filter 0. Compare every decoded byte to the
      // actual resvg raster, not a hash captured from this implementation.
      const idatLength = new DataView(native.buffer).getUint32(33);
      const decoded = inflateSync(native.subarray(41, 41 + idatLength));
      const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
      const rendered = renderer.render();
      try {
        const pixels = rendered.pixels;
        expect(rendered.width).toBe(1080);
        expect(rendered.height).toBe(1080);
        expect(decoded.length).toBe((1080 * 4 + 1) * 1080);
        for (let row = 0; row < 1080; row++) {
          expect(decoded[row * 4321]).toBe(0);
          expect(
            Buffer.from(decoded.subarray(row * 4321 + 1, (row + 1) * 4321)).equals(
              Buffer.from(pixels.subarray(row * 4320, (row + 1) * 4320)),
            ),
          ).toBe(true);
        }
        expect(pixels.some((pixel) => pixel !== 255)).toBe(true);
      } finally {
        rendered.free();
        renderer.free();
      }
    },
  );

  it('긴 내용·없는 글리프를 조용히 자르거나 대체하지 않는다', () => {
    expect(() =>
      cardSvg(
        {
          ...fixtures.expression!,
          expression: 'W'.repeat(200),
          example_en: 'Long '.repeat(100).trim(),
          example_ko: '긴 문장 '.repeat(99).trim(),
        },
        fonts,
      ),
    ).toThrow('카드에 내용이 모두');
    expect(() => cardSvg({ ...fixtures.expression!, meaning_ko: '🙂' }, fonts)).toThrow(
      /폰트에 없는|글리프 누락/,
    );
  });

  it('입력의 태그·따옴표·앰퍼샌드는 SVG 요소로 실행하지 않는다', () => {
    const svg = cardSvg({ ...fixtures.expression!, expression: '<script>& "hello"' }, fonts);
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('href=');
    expect(() => validatePng(rasterize(svg))).not.toThrow();
  });

  it('반복 실행은 같은 PNG를 만들고 오류 다음에도 렌더링한다', () => {
    expect(() => rasterize('invalid svg')).toThrow();
    const svg = cardSvg(fixtures.expression!, fonts);
    expect(rasterize(svg)).toEqual(rasterize(svg));
  });

  it.each(Object.keys(fixtures))('%s: 낮은 압축률도 모든 픽셀을 보존한다', async (name) => {
    const svg = cardSvg(fixtures[name]!, fonts);
    const png = rasterizeFast(svg);
    expect(() => validatePng(png)).not.toThrow();
    const baseline = await rasterizeNative(svg);
    const readRows = (value: Uint8Array<ArrayBuffer>) =>
      inflateSync(value.subarray(41, 41 + new DataView(value.buffer).getUint32(33)));
    expect(Buffer.from(readRows(png)).equals(Buffer.from(readRows(baseline)))).toBe(true);
  });

  it('낮은 압축률도 잘못된 픽셀 크기를 거부한다', () => {
    expect(() => fastPng(new Uint8Array(4))).toThrow('1080×1080 RGBA');
  });

  it.each(Object.keys(fixtures))('%s: 분할 렌더와 합성이 원본 픽셀을 보존한다', (name) => {
    const svg = cardSvg(fixtures[name]!, fonts);
    const bands = Array.from({ length: BAND_COUNT }, (_, index) => renderBand(svg, index));
    const joined = joinBands(bands);
    const whole = rasterizeFast(svg);
    const readRows = (value: Uint8Array<ArrayBuffer>) =>
      inflateSync(value.subarray(41, 41 + new DataView(value.buffer).getUint32(33)));
    expect(Buffer.from(readRows(joined)).equals(Buffer.from(readRows(whole)))).toBe(true);
    expect(() => joinBands(bands.slice(1))).toThrow('부족');
    expect(() => joinBands([...bands].reverse())).toThrow('순서');
    expect(() => renderBand(svg, -1)).toThrow('구간');
    expect(() => renderBand(svg, BAND_COUNT)).toThrow('구간');
  });
});
