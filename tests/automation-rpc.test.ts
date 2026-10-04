import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { timingSafeEqual } from 'node:crypto';
import {
  createAtlasRpc,
  createRpcProbe,
  boundedRpcBytes,
} from '../experiments/automation-png/atlas-rpc';
import {
  createPipelineWorker,
  pipelinePlan,
  packAtlasBundle,
  maxAssemblyBytes,
} from '../experiments/automation-png/atlas-pipeline';
import { packAtlasChunk } from '../experiments/automation-png/atlas-chunks';
import { encodeAtlasPage } from '../experiments/automation-png/atlas-build';
import { fixtures } from '../experiments/automation-png/fixtures';
import type { Atlas } from '../experiments/automation-png/atlas';
import { validatePng } from '../src/worker/png';

const runtimes = Object.fromEntries(
  ([800, 720] as const).map((size) => [
    String(size),
    {
      advance: () => 5,
      common: { glyphs: {}, pixels: new Uint8Array() },
      options: { size, slots: 64 as const, chunkSize: 6, compactRead: true, rle: true },
    },
  ]),
) as unknown as Parameters<typeof createAtlasRpc>[0];
const rpc = createAtlasRpc(runtimes),
  probe = createRpcProbe(runtimes);
const token = 'a'.repeat(32);
const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
beforeAll(() =>
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value: timingSafeEqual,
    configurable: true,
  }),
);
afterAll(() => {
  if (descriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', descriptor);
  else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
});
function request(path = '/probe/expression/atlas_rpc800', method = 'POST', secret = token) {
  return new Request('https://probe.test' + path, {
    method,
    headers: { Authorization: `Bearer ${secret}` },
  });
}
function fakeAtlas(keys: Iterable<string>): Atlas {
  const all = [...keys];
  return {
    pixels: new Uint8Array(all.length).fill(31),
    glyphs: Object.fromEntries(
      all.map((key, offset) => [key, { width: 1, height: 1, left: 0, top: 0, offset, advance: 5 }]),
    ),
  };
}
function inputs(size: '800' | '720') {
  const plan = pipelinePlan(fixtures.expression!, runtimes[size]);
  const pages = new Map(
    [...plan.pages].map(([name, keys]) => {
      const [weight, logicalSize, index] = name.slice(0, -4).split('-').map(Number);
      return [
        `/${size}/${name}`,
        encodeAtlasPage(fakeAtlas(keys), index!, { size: logicalSize!, weight: weight! }, 64),
      ];
    }),
  );
  const read = vi.fn(async (url: RequestInfo | URL) => {
    const bytes = pages.get(new URL(String(url)).pathname);
    return bytes ? new Response(new Uint8Array(bytes)) : new Response('missing', { status: 404 });
  });
  const frames = plan.chunks.map((chunk, index) =>
    packAtlasChunk(fakeAtlas(chunk.flatMap(([, keys]) => [...keys])), index, plan.chunks.length),
  );
  return { plan, frames, read, assets: { fetch: read } as unknown as Fetcher };
}
it('RPC도 인증·메서드·고정 경로를 통과하기 전 하위 호출을 하지 않는다', async () => {
  const renderer = { glyphs: vi.fn(), assemble: vi.fn() };
  for (const [req, secret, status] of [
    [request(), '', 503],
    [request(undefined, 'POST', 'b'.repeat(32)), token, 401],
    [request(undefined, 'GET'), token, 405],
    [request('/probe/constructor/atlas_rpc800'), token, 404],
    [request('/probe/expression/atlas_rpc1080'), token, 404],
    [request('/probe/expression/atlas_rpc800?url=https://other.test'), token, 404],
  ] as const)
    expect((await probe.fetch(req, { BENCH_TOKEN: secret, RENDERER: renderer })).status).toBe(
      status,
    );
  expect(renderer.glyphs).not.toHaveBeenCalled();
  expect(renderer.assemble).not.toHaveBeenCalled();
});
it('RPC 수신측은 크기·예제·인덱스를 검증해 임의 자산 조회를 막는다', async () => {
  const { assets, read, plan } = inputs('800');
  for (const args of [
    [800, 'expression', 0],
    ['800', 'constructor', 0],
    ['800', '../expression', 0],
    ['800', 'expression', -1],
    ['800', 'expression', NaN],
    ['800', 'expression', '0'],
    ['800', 'expression', plan.chunks.length],
  ])
    await expect(rpc.glyphs(args[0], args[1], args[2], assets)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it('두 해상도의 RPC 글자 프레임과 PNG가 같은 계산을 쓰는 HTTP 기준과 일치한다', async () => {
  for (const size of ['800', '720'] as const) {
    const { plan, assets } = inputs(size),
      frames: Uint8Array[] = [];
    const http = createPipelineWorker(runtimes[size], {
      prefix: `/lean/${size}`,
      assetPrefix: `/${size}`,
    });
    for (let index = 0; index < plan.chunks.length; index++) {
      const actual = await rpc.glyphs(size, 'expression', index, assets);
      const response = await http.fetch(
        new Request(`https://renderer.test/lean/${size}/pipeline/glyphs/expression/${index}`),
        { ATLAS_ASSETS: assets },
      );
      expect(response.status).toBe(200);
      expect(new Uint8Array(actual)).toEqual(new Uint8Array(await response.arrayBuffer()));
      frames.push(new Uint8Array(actual));
    }
    const bundle = packAtlasBundle(frames);
    const png = rpc.assemble(size, 'expression', bundle.buffer);
    validatePng(new Uint8Array(png), size === '800' ? 800 : 720);
    const response = await http.fetch(
      new Request(`https://renderer.test/lean/${size}/pipeline/assemble/expression`, {
        method: 'POST',
        body: bundle,
      }),
      { ATLAS_ASSETS: assets },
    );
    expect(response.status).toBe(200);
    expect(new Uint8Array(png)).toEqual(new Uint8Array(await response.arrayBuffer()));
  }
});
it('RPC 조립은 타입·4MiB·순서·픽셀 검증을 유지한다', () => {
  const { frames } = inputs('800'),
    valid = packAtlasBundle(frames);
  for (const value of [
    undefined,
    new Uint8Array(valid),
    new ArrayBuffer(0),
    new ArrayBuffer(maxAssemblyBytes + 1),
    valid.buffer.slice(0, -1),
  ])
    expect(() => rpc.assemble('800', 'expression', value)).toThrow();
  expect(() => rpc.assemble('1080', 'expression', valid.buffer)).toThrow();
  const reordered = new Uint8Array(valid);
  new DataView(reordered.buffer).setUint16(12 + 8, 1);
  expect(() => rpc.assemble('800', 'expression', reordered.buffer)).toThrow();
  const corruptFrames = frames.map((frame) => new Uint8Array(frame));
  corruptFrames[0]![corruptFrames[0]!.length - 1] = 32;
  expect(() => rpc.assemble('800', 'expression', packAtlasBundle(corruptFrames).buffer)).toThrow(
    /픽셀/,
  );
});
it('수집기는 잘못된 RPC 프레임·초과·예외에 재시도하거나 조립하지 않는다', async () => {
  const { frames } = inputs('800');
  const wrongIndex = new Uint8Array(frames[0]!);
  new DataView(wrongIndex.buffer).setUint16(8, 1);
  for (const value of [
    new Uint8Array(10),
    new ArrayBuffer(0),
    new ArrayBuffer(1048577),
    wrongIndex.buffer,
  ]) {
    const renderer = { glyphs: vi.fn(async () => value as ArrayBuffer), assemble: vi.fn() };
    expect((await probe.fetch(request(), { BENCH_TOKEN: token, RENDERER: renderer })).status).toBe(
      502,
    );
    expect(renderer.glyphs).toHaveBeenCalledTimes(1);
    expect(renderer.assemble).not.toHaveBeenCalled();
  }
  const renderer = {
    glyphs: vi.fn(async () => {
      throw new Error('internal-sensitive-error');
    }),
    assemble: vi.fn(),
  };
  const response = await probe.fetch(request(), { BENCH_TOKEN: token, RENDERER: renderer });
  expect(response.status).toBe(502);
  expect(await response.text()).toBe('PNG pipeline failed');
  expect(renderer.glyphs).toHaveBeenCalledTimes(1);
  expect(renderer.assemble).not.toHaveBeenCalled();
});
it('RPC 조립 실패·잘못된 반환은 응답으로 노출하지 않고 실패한다', async () => {
  const { frames } = inputs('800');
  for (const output of [new Uint8Array(3), new ArrayBuffer(0), new ArrayBuffer(1048577)]) {
    const renderer = {
      glyphs: vi.fn(async (_s, _f, i) => frames[i]!.buffer),
      assemble: vi.fn(async () => output as ArrayBuffer),
    };
    expect((await probe.fetch(request(), { BENCH_TOKEN: token, RENDERER: renderer })).status).toBe(
      502,
    );
    expect(renderer.assemble).toHaveBeenCalledTimes(1);
  }
  expect(() => boundedRpcBytes(new SharedArrayBuffer(12), 12)).toThrow();
});
it('페이지 읽기 실패·상한 초과도 RPC에서 전파되어 조립을 진행하지 않는다', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response(new Uint8Array(maxAssemblyBytes + 1)),
  ]) {
    const assets = { fetch: vi.fn(async () => response) } as unknown as Fetcher;
    await expect(rpc.glyphs('800', 'expression', 0, assets)).rejects.toThrow();
  }
});
