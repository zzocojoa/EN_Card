import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { CardFonts } from '../experiments/automation-png/svg';
import { loadFonts } from '../experiments/automation-png/fonts';
import { fixtures, atlasCoverageCard } from '../experiments/automation-png/fixtures';
import {
  atlasKey,
  atlasPng,
  atlasPngPrepared,
  type Atlas,
} from '../experiments/automation-png/atlas';
import { buildAtlas, encodeAtlasPage } from '../experiments/automation-png/atlas-build';
import {
  atlasAdvance,
  decodeAtlasPage,
  loadCardAtlas,
  planCardAtlas,
  pageSize,
  type AtlasMetrics,
} from '../experiments/automation-png/atlas-pages';
import {
  atlasChunks,
  loadAtlasChunk,
  packAtlasChunk,
  unpackAtlasChunk,
  mergeAtlases,
  selectAtlas,
} from '../experiments/automation-png/atlas-chunks';
import { validatePng } from '../src/worker/png';
import {
  assembleAtlasBundle,
  createPipelineProbe,
  createPipelineWorker,
  maxAssemblyBytes,
  packAtlasBundle,
  pipelinePlan,
  readBoundedBody,
  unpackAtlasBundle,
} from '../experiments/automation-png/atlas-pipeline';

let fonts: CardFonts;
let atlas: Atlas;
let metrics: AtlasMetrics;
let common: Atlas;
const pages = new Map<string, Uint8Array>();
const timingDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
beforeAll(async () => {
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value: timingSafeEqual,
    configurable: true,
  });
  await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  fonts = new CardFonts(await loadFonts());
  const characters =
    Object.values({ ...fixtures, coverage: atlasCoverageCard })
      .flatMap(Object.values)
      .join('') + '0123456789 /오늘의 표현 비교 하루 한 표현 가힣 꽃 굉 쐐 office AV';
  atlas = buildAtlas(fonts, characters);
  const fixed = new Set(
    Array.from('오늘의 표현 비교 하루 한 표현').map((character) => character.codePointAt(0)!),
  );
  common = {
    pixels: atlas.pixels,
    glyphs: Object.fromEntries(
      Object.entries(atlas.glyphs).filter(
        ([key]) => Number(key.split(':')[2]) < 0x3000 || fixed.has(Number(key.split(':')[2])),
      ),
    ),
  };
  metrics = {
    points: [
      ...new Set(
        Array.from(characters)
          .filter((char) => char !== '\n')
          .map((char) => char.codePointAt(0)!),
      ),
    ],
    weights: {},
  };
  const grouped = new Map<string, Atlas>();
  for (const [key, sprite] of Object.entries(atlas.glyphs)) {
    const [weight, size, point] = key.split(':').map(Number) as [number, number, number];
    metrics.weights[weight] ??= {};
    if (sprite.advance / size !== 1) metrics.weights[weight]![point] = sprite.advance / size;
    const name = `${weight}-${size}-${Math.floor(point / pageSize)}.bin`;
    const group = grouped.get(name) ?? { glyphs: {}, pixels: atlas.pixels };
    group.glyphs[key] = sprite;
    grouped.set(name, group);
  }
  for (const [name, group] of grouped) {
    const [weight, size, page] = name.slice(0, -4).split('-').map(Number) as [
      number,
      number,
      number,
    ];
    pages.set(name, encodeAtlasPage(group, page, { size, weight }));
  }
});
afterAll(() => {
  if (timingDescriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', timingDescriptor);
  else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
});
function indexedPixels(png: Uint8Array<ArrayBuffer>) {
  validatePng(png);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(png[25]).toBe(3);
  let offset = 8;
  let palette = new Uint8Array();
  let pixels = new Uint8Array();
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const kind = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (kind === 'PLTE') palette = png.slice(offset + 8, offset + 8 + length);
    if (kind === 'IDAT')
      pixels = new Uint8Array(inflateSync(png.subarray(offset + 8, offset + 8 + length)));
    offset += 12 + length;
  }
  expect(pixels.length).toBe(1081 * 1080);
  for (let row = 0; row < 1080; row++) expect(pixels[row * 1081]).toBe(0);
  expect(pixels.every((index) => index < palette.length / 3)).toBe(true);
  return { pixels, palette };
}
it.each(Object.keys(fixtures))('%s: 페이지 선택·모든 PNG 픽셀·용량을 검증한다', async (name) => {
  const card = fixtures[name]!;
  const loaded = await loadCardAtlas(card, atlasAdvance(metrics), async (page) => pages.get(page)!);
  const direct = atlasPng(card, atlas);
  const png = atlasPng(card, loaded);
  expect(png).toEqual(direct);
  expect(png.length).toBeLessThan(1048576);
  const { pixels, palette } = indexedPixels(png);
  const accent = pixels[83 * 1081 + 89]! * 3;
  expect([...palette.subarray(accent, accent + 3)]).toEqual([33, 77, 229]);
  expect(pixels.slice(0, 1081 * 70).every((pixel) => pixel === 0)).toBe(true);
});
it('준비한 문자로 새 문장을 만들며 미리 만든 카드 이미지를 반환하지 않는다', async () => {
  const card = { ...fixtures.expression!, expression: 'office AV', meaning_ko: '가힣 꽃 굉 쐐' };
  const loaded = await loadCardAtlas(
    card,
    atlasAdvance(metrics),
    async (page) => pages.get(page)!,
    12,
  );
  const png = atlasPng(card, loaded, 12);
  const plan = planCardAtlas(card, atlasAdvance(metrics), 12);
  expect(atlasPngPrepared(plan.prepared, loaded)).toEqual(png);
  indexedPixels(png);
  expect(png).not.toEqual(atlasPng(fixtures.expression!, atlas));
});
it('glyph alpha 양자화 오차는 원래 폰트 래스터 대비 255/62 이내다', () => {
  const spec = fonts.sprite('한', 44, 700);
  const renderer = new Resvg(spec.svg, { font: { loadSystemFonts: false } });
  const rendered = renderer.render();
  try {
    const sprite = buildAtlas(fonts, '한', [{ size: 44, weight: 700 }]);
    const rgba = rendered.pixels;
    expect(sprite.pixels.length).toBe(rendered.width * rendered.height);
    for (let index = 0; index < sprite.pixels.length; index++)
      expect(
        Math.abs((sprite.pixels[index]! * 255) / 31 - rgba[index * 4 + 3]!),
      ).toBeLessThanOrEqual(255 / 62);
  } finally {
    rendered.free();
    renderer.free();
  }
});
it('없는 문자·넘치는 내용·잘못된 카드 번호를 거부한다', async () => {
  expect(() => atlasPng({ ...fixtures.expression!, meaning_ko: '🙂' }, atlas)).toThrow(
    '준비되지 않은 문자',
  );
  expect(() =>
    atlasPng(
      {
        ...fixtures.expression!,
        expression: 'W'.repeat(200),
        example_en: 'Long '.repeat(100).trim(),
        example_ko: '긴 문장 '.repeat(99).trim(),
      },
      atlas,
    ),
  ).toThrow();
  expect(() => atlasPng(fixtures.expression!, atlas, -1)).toThrow('카드 번호');
});
it('손상된 페이지·다른 페이지·빠진 글리프를 거부한다', () => {
  const key = atlasKey('가', 44, 700);
  const page = pages.get(`700-44-${Math.floor('가'.codePointAt(0)! / pageSize)}.bin`)!;
  expect(() => decodeAtlasPage(page.subarray(0, 10), [key])).toThrow('크기');
  expect(() => decodeAtlasPage(page, [atlasKey('A', 44, 700)])).toThrow('식별자');
  const damaged = page.slice();
  new DataView(damaged.buffer).setUint32(
    16 + ('가'.codePointAt(0)! % pageSize) * 32 + 16,
    page.length + 1,
  );
  expect(() => decodeAtlasPage(damaged, [key])).toThrow('범위');
});

it('정상 분량의 50페이지 비교형을 공통 글자 번들로 처리한다', async () => {
  const advance = atlasAdvance(metrics);
  await expect(
    loadCardAtlas(atlasCoverageCard, advance, async (page) => pages.get(page)!),
  ).rejects.toThrow('페이지가 너무 많');
  let requests = 0;
  const selected = await loadCardAtlas(
    atlasCoverageCard,
    advance,
    async (page) => {
      requests++;
      return pages.get(page)!;
    },
    1,
    common,
  );
  expect(requests).toBe(33);
  const png = atlasPng(atlasCoverageCard, selected);
  indexedPixels(png);
  expect(png).toEqual(atlasPng(atlasCoverageCard, atlas));
});

it.each(Object.keys({ ...fixtures, coverage: atlasCoverageCard }))(
  '%s: 세 페이지씩 준비한 글자를 합쳐 같은 PNG를 만든다',
  async (name) => {
    const cards: typeof fixtures = { ...fixtures, coverage: atlasCoverageCard };
    const card = cards[name]!;
    const advance = atlasAdvance(metrics);
    const plan = planCardAtlas(card, advance, 1, common);
    const chunks = atlasChunks(plan.pages);
    expect(chunks.length).toBeLessThanOrEqual(29);
    const parts = [selectAtlas(common, plan.commonKeys)];
    for (const [index, chunk] of chunks.entries()) {
      let calls = 0;
      const prepared = await loadAtlasChunk(chunk, async (name) => {
        calls++;
        return pages.get(name)!;
      });
      expect(calls).toBeLessThanOrEqual(3);
      const frame = packAtlasChunk(prepared, index, chunks.length);
      const keys = new Set(chunk.flatMap(([, keys]) => [...keys]));
      parts.push(unpackAtlasChunk(frame, index, chunks.length, keys));
      expect(() => unpackAtlasChunk(frame, index + 1, chunks.length, keys)).toThrow('형식');
      expect(() => unpackAtlasChunk(frame, index, chunks.length, new Set())).toThrow('목록');
      expect(() => unpackAtlasChunk(frame.subarray(0, 11), index, chunks.length, keys)).toThrow(
        '크기',
      );
    }
    expect(atlasPngPrepared(plan.prepared, mergeAtlases(parts, advance))).toEqual(
      atlasPng(card, atlas),
    );
  },
);

it('글자 조립에서 중복·손상 데이터와 과도한 호출을 거부한다', () => {
  const subset = selectAtlas(atlas, [atlasKey('한', 44, 700)]);
  expect(() => mergeAtlases([subset, subset])).toThrow('중복');
  const frame = packAtlasChunk(mergeAtlases([subset]), 0, 1);
  frame[frame.length - 1] = 255;
  expect(() => unpackAtlasChunk(frame, 0, 1, new Set(Object.keys(subset.glyphs)))).toThrow('픽셀');
  expect(() =>
    atlasChunks(
      new Map(Array.from({ length: 88 }, (_, index) => [String(index), new Set<string>()])),
    ),
  ).toThrow('한도');
});

it.each(
  Object.keys({ ...fixtures, coverage: atlasCoverageCard }).flatMap((name) =>
    [false, true].map((lean) => ({ name, lean })),
  ),
)(
  '$name (직접 경로 $lean): 수집·별도 조립 파이프라인이 동일 PNG와 제한된 호출을 사용한다',
  async ({ name, lean }) => {
    const runtime = { advance: atlasAdvance(metrics), common };
    const worker = createPipelineWorker(
      runtime,
      lean ? { prefix: '/lean/800', assetPrefix: '/800' } : {},
    );
    const probe = createPipelineProbe(
      runtime,
      lean ? { encoder: 'atlas_lean800', rendererPrefix: '/lean/800' } : {},
    );
    const assetFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(typeof input).toBe('string');
      const path = new URL(String(input)).pathname;
      if (lean) expect(path.startsWith('/800/')).toBe(true);
      const key = path.slice(lean ? 5 : 1);
      const data = pages.get(key);
      return data ? new Response(data.slice().buffer) : new Response('Not found', { status: 404 });
    });
    let glyphCalls = 0;
    let assemblyCalls = 0;
    const serviceFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(typeof input).toBe('string');
      if (lean)
        expect(String(input).startsWith('https://png.internal/lean/800/pipeline/')).toBe(true);
      const before = assetFetch.mock.calls.length;
      const request = new Request(input, init);
      const response = await worker.fetch(request, {
        ATLAS_ASSETS: { fetch: assetFetch } as unknown as Fetcher,
      });
      if (request.url.includes('/glyphs/')) {
        glyphCalls++;
        expect(assetFetch.mock.calls.length - before).toBeLessThanOrEqual(2);
      } else {
        assemblyCalls++;
        expect(request.method).toBe('POST');
        expect(assetFetch.mock.calls.length).toBe(before);
      }
      return response;
    });
    const token = 'synthetic-pipeline-test-token-32-bytes';
    const response = await probe.fetch(
      new Request(`https://probe.test/probe/${name}/${lean ? 'atlas_lean800' : 'atlas_pipeline'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      { BENCH_TOKEN: token, RENDERER: { fetch: serviceFetch } as unknown as Fetcher },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const card = { ...fixtures, coverage: atlasCoverageCard }[name]!;
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(atlasPng(card, atlas));
    expect(assemblyCalls).toBe(1);
    expect(glyphCalls).toBe(pipelinePlan(card, runtime).chunks.length);
    expect(glyphCalls + assemblyCalls + 1).toBeLessThanOrEqual(31);
    expect(assetFetch).toHaveBeenCalledTimes(pipelinePlan(card, runtime).pages.size);
  },
);

it.each([false, true])(
  '원본 참조 %s: 조립 프레임 개수·순서·잘림·잔여 바이트와 실제 글자 손상을 거부한다',
  async (referencePixels) => {
    const runtime = { advance: atlasAdvance(metrics), common, options: { referencePixels } };
    const plan = pipelinePlan(fixtures.expression!, runtime);
    const frames = await Promise.all(
      plan.chunks.map(async (chunk, index) =>
        packAtlasChunk(
          await loadAtlasChunk(chunk, async (name) => pages.get(name)!),
          index,
          plan.chunks.length,
        ),
      ),
    );
    const bundle = packAtlasBundle(frames);
    expect(unpackAtlasBundle(bundle, frames.length)).toHaveLength(frames.length);
    expect(() => unpackAtlasBundle(bundle, frames.length + 1)).toThrow('형식');
    expect(() => unpackAtlasBundle(bundle.subarray(0, bundle.length - 1), frames.length)).toThrow();
    expect(() => unpackAtlasBundle(new Uint8Array([...bundle, 0]), frames.length)).toThrow('잔여');
    expect(() => packAtlasBundle([...frames].reverse())).toThrow('형식');
    const damaged = bundle.slice();
    damaged[damaged.length - 1] = 255;
    expect(() => assembleAtlasBundle(fixtures.expression!, runtime, damaged)).toThrow('픽셀');
    expect(() => unpackAtlasBundle(new Uint8Array(maxAssemblyBytes + 1), frames.length)).toThrow(
      '크기',
    );
    expect(() =>
      atlasChunks(
        new Map(Array.from({ length: 59 }, (_, index) => [String(index), new Set<string>()])),
        2,
      ),
    ).toThrow('한도');
  },
);

it('입구 인증·경로·하위 오류는 조립과 재시도를 막는다', async () => {
  const runtime = { advance: atlasAdvance(metrics), common };
  const probe = createPipelineProbe(runtime);
  const serviceFetch = vi.fn(async () => new Response('failed', { status: 500 }));
  const env = {
    BENCH_TOKEN: 'synthetic-pipeline-test-token-32-bytes',
    RENDERER: { fetch: serviceFetch } as unknown as Fetcher,
  };
  const request = (path: string, token = env.BENCH_TOKEN, method = 'POST') =>
    new Request(`https://probe.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
  expect((await probe.fetch(request('/probe/expression/atlas_pipeline', 'bad'), env)).status).toBe(
    401,
  );
  expect(
    (await probe.fetch(request('/probe/expression/atlas_pipeline', env.BENCH_TOKEN, 'GET'), env))
      .status,
  ).toBe(405);
  expect(
    (await probe.fetch(request('/probe/expression/atlas_pipeline?url=https://other.test'), env))
      .status,
  ).toBe(404);
  expect((await probe.fetch(request('/probe/unknown/atlas_pipeline'), env)).status).toBe(404);
  expect(serviceFetch).not.toHaveBeenCalled();
  expect((await probe.fetch(request('/probe/expression/atlas_pipeline'), env)).status).toBe(502);
  expect(serviceFetch).toHaveBeenCalledTimes(1);
  serviceFetch.mockResolvedValueOnce(new Response('invalid frame'));
  expect((await probe.fetch(request('/probe/expression/atlas_pipeline'), env)).status).toBe(502);
  expect(serviceFetch).toHaveBeenCalledTimes(2);
  const worker = createPipelineWorker(runtime);
  const assets = vi.fn();
  const workerEnv = { ATLAS_ASSETS: { fetch: assets } as unknown as Fetcher };
  expect(
    (await worker.fetch(new Request('https://private.test/800-82-0.bin'), workerEnv)).status,
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request('https://private.test/pipeline/assemble/expression'),
        workerEnv,
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await worker.fetch(
        new Request('https://private.test/pipeline/glyphs/expression/999'),
        workerEnv,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request('https://private.test/pipeline/assemble/expression', {
          method: 'POST',
          body: 'invalid',
        }),
        workerEnv,
      )
    ).status,
  ).toBe(400);
  expect(assets).not.toHaveBeenCalled();
});

it('Content-Length가 없는 스트림과 잘못된 길이 헤더도 실제 크기로 제한한다', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(6));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readBoundedBody(new Response(stream, { headers: { 'Content-Length': '1' } }), 10),
  ).rejects.toThrow('크기');
  expect(cancelled).toBe(true);
  await expect(readBoundedBody(new Response(new Uint8Array(11)), 10)).rejects.toThrow('크기');
  expect(await readBoundedBody(new Response(new Uint8Array(10)), 10)).toHaveLength(10);
});
