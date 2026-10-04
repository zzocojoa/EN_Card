import { readFile, writeFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { atlasAdvance, decodeCommonAtlas, type AtlasMetrics } from './atlas-pages';
import { loadAtlasChunk, packAtlasChunk } from './atlas-chunks';
import {
  assembleAtlasBundle,
  createPipelineProbe,
  packAtlasBundle,
  pipelinePlan,
} from './atlas-pipeline';
import { fixtures, atlasCoverageCard } from './fixtures';

const runtime = {
  advance: atlasAdvance(
    JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')) as AtlasMetrics,
  ),
  common: decodeCommonAtlas(await readFile('.automation-png/atlas-common.bin')),
};
Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
  value: timingSafeEqual,
  configurable: true,
});
async function measure(run: () => unknown) {
  for (let index = 0; index < 5; index++) await run();
  const count = 50;
  const cpu = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  for (let index = 0; index < count; index++) await run();
  const delta = process.cpuUsage(cpu);
  const threadDelta = thread ? process.threadCpuUsage(thread) : null;
  return {
    count,
    process_cpu_ms: (delta.user + delta.system) / count / 1000,
    thread_cpu_ms: threadDelta ? (threadDelta.user + threadDelta.system) / count / 1000 : null,
    wall_ms: (performance.now() - wall) / count,
  };
}
const results = [];
for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
  const plan = pipelinePlan(card, runtime);
  const assets = new Map<string, Uint8Array>();
  for (const name of plan.pages.keys())
    assets.set(name, await readFile(`.automation-png/atlas-v2-assets/${name}`));
  const frames: Uint8Array<ArrayBuffer>[] = [];
  const preparation = [];
  for (const [index, chunk] of plan.chunks.entries()) {
    const run = async () => {
      const current = pipelinePlan(card, runtime);
      return packAtlasChunk(
        await loadAtlasChunk(current.chunks[index]!, async (name) => assets.get(name)!),
        index,
        current.chunks.length,
      );
    };
    frames.push(await run());
    preparation.push({ index, pages: chunk.length, ...(await measure(run)) });
  }
  const bundle = packAtlasBundle(frames);
  const png = assembleAtlasBundle(card, runtime, bundle);
  const baseline = await readFile(`.automation-png/${fixture}-atlas-full.png`);
  if (!Buffer.from(png).equals(baseline)) throw new Error(`${fixture}: PNG differs`);
  const token = 'synthetic-local-pipeline-benchmark-token';
  const probe = createPipelineProbe(runtime);
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/glyphs/'))
      return new Response(frames[Number(url.pathname.split('/').at(-1))]!);
    if (init?.method !== 'POST') throw new Error('Expected assembly POST');
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  };
  results.push({
    fixture,
    pages: plan.pages.size,
    glyph_calls: plan.chunks.length,
    total_worker_invocations: plan.chunks.length + 2,
    bundle_bytes: bundle.length,
    png_bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
    identical_png: true,
    preparation,
    assembly: await measure(() => assembleAtlasBundle(card, runtime, bundle)),
    collector: await measure(async () => {
      const response = await probe.fetch(
        new Request(`https://probe.test/probe/${fixture}/atlas_pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        { BENCH_TOKEN: token, RENDERER: { fetch: fetchMock } as unknown as Fetcher },
      );
      if (!response.ok) throw new Error('Collector failed');
      await response.body?.cancel();
    }),
  });
  await writeFile(`.automation-png/${fixture}-atlas-pipeline.png`, png);
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local Node warm phase estimates. Assets pre-read; startup/network excluded. Collector includes mocked Response creation and bounded frame reads, excludes remote glyph/assembly work. Preparation and assembly are independent phase means. Not Cloudflare CPU or peak memory.',
  results,
};
await writeFile(
  '.automation-png/atlas-pipeline-report.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    results.map(({ preparation, ...result }) => ({
      ...result,
      preparation_max_process_cpu_ms: Math.max(...preparation.map((value) => value.process_cpu_ms)),
    })),
    null,
    2,
  ),
);
