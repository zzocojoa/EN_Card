import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { initWasm } from '@resvg/resvg-wasm';
import {
  atlasStyles,
  buildAtlas,
  encodeAtlasPage,
} from '../experiments/automation-png/atlas-build';
import { CardFonts } from '../experiments/automation-png/svg';
import { loadFonts } from '../experiments/automation-png/fonts';
import {
  atlasPngPrepared,
  prepareAtlasCard,
  type Atlas,
  type AtlasSize,
} from '../experiments/automation-png/atlas';
import {
  atlasAdvance,
  decodeAtlasPage,
  type AtlasMetrics,
} from '../experiments/automation-png/atlas-pages';
import { fixtures, atlasCoverageCard } from '../experiments/automation-png/fixtures';
import {
  assembleAtlasBundle,
  pipelinePlan,
  packAtlasBundle,
  readBoundedBody,
  type PipelineRuntime,
} from '../experiments/automation-png/atlas-pipeline';
import {
  atlasChunks,
  loadAtlasChunk,
  packAtlasChunk,
} from '../experiments/automation-png/atlas-chunks';
import { validatePng } from '../src/worker/png';
import { paintExtracted, paintPacked, paintSpans } from '../experiments/automation-png/atlas-blit';
import { binaryAtlasChunkCodec } from '../experiments/automation-png/atlas-binary';
import { blockPageDecoder } from '../experiments/automation-png/atlas-blocks';
import { encodeBlockPage } from '../experiments/automation-png/atlas-block-build';

let fonts: CardFonts;
let metrics: AtlasMetrics;
const atlases = new Map<AtlasSize, Atlas>();
const cards = {
  ...fixtures,
  coverage: atlasCoverageCard,
  dynamic: {
    ...fixtures.expression!,
    expression: 'A fresh idea',
    meaning_ko: '꽃처럼 새로운 생각',
    example_en: 'A fresh idea can help us solve this problem.',
    example_ko: '새로운 생각은 이 문제를 푸는 데 도움이 돼요.',
  },
};
beforeAll(async () => {
  await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  fonts = new CardFonts(await loadFonts());
  const characters =
    Object.values(cards).flatMap(Object.values).join('') +
    '0123456789 /오늘의 표현 비교 하루 한 표현';
  for (const size of [1080, 800, 720] as const)
    atlases.set(size, buildAtlas(fonts, characters, atlasStyles, size / 1080));
  metrics = {
    points: [
      ...new Set(
        Array.from(characters)
          .filter((c) => c !== '\n')
          .map((c) => c.codePointAt(0)!),
      ),
    ],
    weights: {},
  };
  for (const [key, glyph] of Object.entries(atlases.get(1080)!.glyphs)) {
    const [weight, size, point] = key.split(':').map(Number);
    metrics.weights[weight!] ??= {};
    metrics.weights[weight!]![point!] = glyph.advance / size!;
  }
}, 30000);
function decoded(png: Uint8Array<ArrayBuffer>, size: AtlasSize) {
  validatePng(png, size);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    if (new TextDecoder().decode(png.subarray(offset + 4, offset + 8)) === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const result = inflateSync(Buffer.concat(chunks));
  expect(result.length).toBe((size + 1) * size);
  for (let row = 0; row < size; row++) expect(result[row * (size + 1)]).toBe(0);
  expect(result.every((pixel) => pixel < 218)).toBe(true);
  expect(result.some((pixel) => pixel > 0)).toBe(true);
  return result;
}
it('픽셀 묶음과 행 구간 복사는 동적 한영 카드의 전체 PNG 바이트를 유지한다', () => {
  for (const size of [1080, 800, 720] as const) {
    const runtime = {
      advance: atlasAdvance(metrics),
      common: { glyphs: {}, pixels: new Uint8Array() },
    };
    for (const card of Object.values(cards)) {
      const { prepared } = pipelinePlan(card, runtime);
      const atlas = atlases.get(size)!;
      const baseline = atlasPngPrepared(prepared, atlas, { size, rle: true });
      for (const painter of [paintExtracted, paintPacked, paintSpans])
        expect(atlasPngPrepared(prepared, atlas, { size, rle: true, painter })).toEqual(baseline);
      expect(
        atlasPngPrepared(prepared, atlas, {
          size,
          rle: true,
          painter: paintExtracted,
          nativeCrc: true,
        }),
      ).toEqual(baseline);
    }
  }
});
it.each([1080, 800, 720] as const)(
  '%i: 원래 크기의 글자로 직접 생성하고 RLE 픽셀을 유지한다',
  (size) => {
    const atlas = atlases.get(size)!;
    for (const card of Object.values(cards)) {
      const advance = atlasAdvance(metrics);
      const runtime = { advance, common: { glyphs: {}, pixels: new Uint8Array() } };
      const plan = pipelinePlan(card, runtime);
      const png = atlasPngPrepared(plan.prepared, atlas, { size });
      const rle = atlasPngPrepared(plan.prepared, atlas, { size, rle: true });
      expect(decoded(rle, size)).toEqual(decoded(png, size));
      if (size !== 1080) expect(() => validatePng(rle)).toThrow('1080');
    }
    const smallGlyph = atlas.glyphs['800:82:65'];
    if (smallGlyph && size !== 1080)
      expect(smallGlyph.height).toBeLessThan(atlases.get(1080)!.glyphs['800:82:65']!.height);
  },
);
it.each([32, 64] as const)(
  '%i 슬롯: 동적 문장과 각 해상도의 페이지 조립이 직접 생성과 일치한다',
  async (slots) => {
    for (const size of [1080, 800, 720] as const) {
      const atlas = atlases.get(size)!;
      const fixed = new Set(
        Array.from('오늘의 표현 비교 하루 한 표현').map((c) => c.codePointAt(0)!),
      );
      const common = {
        pixels: atlas.pixels,
        glyphs: Object.fromEntries(
          Object.entries(atlas.glyphs).filter(([key]) => {
            const point = Number(key.split(':')[2]);
            return point < 0x3000 || fixed.has(point);
          }),
        ),
      };
      const grouped = new Map<string, Atlas>();
      for (const [key, glyph] of Object.entries(atlas.glyphs)) {
        const [weight, logicalSize, point] = key.split(':').map(Number);
        const name = `${weight}-${logicalSize}-${Math.floor(point! / slots)}.bin`;
        const page = grouped.get(name) ?? { glyphs: {}, pixels: atlas.pixels };
        page.glyphs[key] = glyph;
        grouped.set(name, page);
      }
      const pages = new Map<string, Uint8Array>();
      for (const [name, page] of grouped) {
        const [weight, logicalSize, index] = name.slice(0, -4).split('-').map(Number);
        pages.set(
          name,
          encodeAtlasPage(page, index!, { size: logicalSize!, weight: weight! }, slots),
        );
      }
      const runtime: PipelineRuntime = {
        advance: atlasAdvance(metrics),
        common,
        options: { size, slots, rle: true, compactRead: true, chunkSize: 3 },
      };
      for (const chunkSize of [3, 4, 6, 8]) {
        runtime.options!.chunkSize = chunkSize;
        for (const card of Object.values(cards)) {
          const plan = pipelinePlan(card, runtime);
          expect(plan.chunks.length + 2).toBeLessThanOrEqual(31);
          const frames: Uint8Array[] = [];
          const binaryFrames: Uint8Array[] = [];
          const checkBinary = slots === 64 && chunkSize === 6 && size !== 1080;
          for (const [index, chunk] of plan.chunks.entries()) {
            const loaded = await loadAtlasChunk(chunk, async (name) => pages.get(name)!, slots);
            frames.push(packAtlasChunk(loaded, index, plan.chunks.length));
            if (checkBinary)
              binaryFrames.push(binaryAtlasChunkCodec.pack(loaded, index, plan.chunks.length));
          }
          const actual = assembleAtlasBundle(card, runtime, packAtlasBundle(frames));
          const direct = atlasPngPrepared(plan.prepared, atlas, runtime.options);
          expect(actual).toEqual(direct);
          if (slots === 64 && chunkSize === 6)
            for (const native of [false, true])
              expect(
                assembleAtlasBundle(
                  card,
                  {
                    ...runtime,
                    options: {
                      ...runtime.options,
                      referencePixels: true,
                      ...(native ? { painter: paintExtracted, nativeCrc: true } : {}),
                    },
                  },
                  packAtlasBundle(frames),
                ),
              ).toEqual(direct);
          if (checkBinary)
            expect(
              assembleAtlasBundle(
                card,
                { ...runtime, options: { ...runtime.options, chunkCodec: binaryAtlasChunkCodec } },
                packAtlasBundle(binaryFrames, binaryAtlasChunkCodec),
              ),
            ).toEqual(direct);
          decoded(actual, size);
          if (checkBinary)
            for (const blockSize of [4, 8] as const) {
              const frames = [];
              for (const [index, chunk] of plan.chunks.entries()) {
                const loaded = await loadAtlasChunk(
                  chunk,
                  async (name) => {
                    const [weight, logicalSize, page] = name.slice(0, -4).split('-').map(Number);
                    return encodeBlockPage(
                      grouped.get(name)!,
                      page! * 64,
                      logicalSize!,
                      weight!,
                      blockSize,
                    );
                  },
                  64,
                  blockPageDecoder(blockSize),
                );
                frames.push(packAtlasChunk(loaded, index, plan.chunks.length));
              }
              expect(assembleAtlasBundle(card, runtime, packAtlasBundle(frames))).toEqual(direct);
            }
        }
      }
      const [name, page] = pages.entries().next().value!;
      expect(() => decodeAtlasPage(page, Object.keys(grouped.get(name)!.glyphs), 1024)).toThrow();
    }
  },
  30000,
);
it('작은 페이지 묶음만 8개까지 허용하며 상한 위반은 읽기 전에 거절한다', async () => {
  const pages = new Map(Array.from({ length: 9 }, (_, i) => [String(i), new Set<string>()]));
  expect(atlasChunks(pages, 8, 64).map((chunk) => chunk.length)).toEqual([8, 1]);
  expect(() => atlasChunks(pages, 4, 1024)).toThrow('묶음');
  for (const size of [0, -1, 9, 1.5, NaN])
    expect(() => atlasChunks(pages, size, 64)).toThrow('묶음');
  let reads = 0;
  await expect(
    loadAtlasChunk(
      [...pages],
      async () => {
        reads++;
        return new Uint8Array();
      },
      64,
    ),
  ).rejects.toThrow('묶음');
  await expect(
    loadAtlasChunk([...pages].slice(0, 4), async () => {
      reads++;
      return new Uint8Array();
    }),
  ).rejects.toThrow('묶음');
  expect(reads).toBe(0);
});
it('축소해도 긴 입력의 넘침 검사를 생략하지 않는다', () => {
  expect(() =>
    prepareAtlasCard(
      { ...cards.dynamic, expression: 'A'.repeat(10000) },
      fonts.measure.bind(fonts),
    ),
  ).toThrow();
});
it.each([undefined, '1', '200', 'invalid'])(
  '복사 절감: Content-Length %s와 여러 청크를 실제 바이트로 검증한다',
  async (header) => {
    const expected = Uint8Array.from({ length: 200 }, (_, i) => i);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 200; i += 7) controller.enqueue(expected.slice(i, i + 7));
        controller.close();
      },
    });
    const response = new Response(stream, header ? { headers: { 'Content-Length': header } } : {});
    expect(await readBoundedBody(response, 200, true)).toEqual(expected);
  },
);
it('복사 절감: 단일 청크·빈 본문·상한 초과·스트림 실패를 처리한다', async () => {
  expect(await readBoundedBody(new Response(new Uint8Array([1, 2])), 2, true)).toEqual(
    new Uint8Array([1, 2]),
  );
  expect(await readBoundedBody(new Response(null), 2, true)).toHaveLength(0);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readBoundedBody(new Response(stream, { headers: { 'Content-Length': '1' } }), 10, true),
  ).rejects.toThrow('크기');
  expect(cancelled).toBe(true);
  await expect(readBoundedBody(new Response(new Uint8Array(11)), 10, true)).rejects.toThrow('크기');
  await expect(
    readBoundedBody(
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('interrupted'));
          },
        }),
      ),
      10,
      true,
    ),
  ).rejects.toThrow('interrupted');
});
