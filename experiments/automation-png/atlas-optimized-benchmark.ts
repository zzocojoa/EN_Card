import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { atlasAdvance, decodeCommonAtlas, loadCardAtlas, type AtlasMetrics } from './atlas-pages';
import { atlasPng } from './atlas';
import { loadAtlasChunk, packAtlasChunk } from './atlas-chunks';
import {
  assembleAtlasBundle,
  pipelinePlan,
  packAtlasBundle,
  readBoundedBody,
  type PipelineOptions,
  type PipelineRuntime,
} from './atlas-pipeline';
import { fixtures, atlasCoverageCard } from './fixtures';

export const variants: Record<string, PipelineOptions> = {
  baseline: { size: 1080, slots: 1024, chunkSize: 2 },
  pages64: { size: 1080, slots: 64, chunkSize: 3 },
  pages32: { size: 1080, slots: 32, chunkSize: 3 },
  compact: { size: 1080, slots: 1024, chunkSize: 2, compactRead: true },
  size800: { size: 800, slots: 1024, chunkSize: 2 },
  size720: { size: 720, slots: 1024, chunkSize: 2 },
  rle: { size: 1080, slots: 1024, chunkSize: 2, rle: true },
  combined800_64: { size: 800, slots: 64, chunkSize: 3, compactRead: true, rle: true },
  combined800_32: { size: 800, slots: 32, chunkSize: 3, compactRead: true, rle: true },
  combined720_64: { size: 720, slots: 64, chunkSize: 3, compactRead: true, rle: true },
  combined720_32: { size: 720, slots: 32, chunkSize: 3, compactRead: true, rle: true },
};
const advance = atlasAdvance(
  JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')) as AtlasMetrics,
);
async function measure(run: () => unknown) {
  const count = 10,
    start = performance.now(),
    cpu = process.threadCpuUsage?.();
  for (let i = 0; i < count; i++) await run();
  const delta = cpu ? process.threadCpuUsage(cpu) : null;
  return {
    count,
    wall_ms: (performance.now() - start) / count,
    thread_cpu_ms: delta ? (delta.user + delta.system) / count / 1000 : null,
  };
}
const results = [];
const cases: {
  preparation: () => Promise<void>;
  assembly: () => unknown;
  prep: number[];
  asm: number[];
  prepCpu: (number | null)[];
  asmCpu: (number | null)[];
}[] = [];
const assetCache = new Map<string, Uint8Array<ArrayBuffer>>();
for (const [variant, options] of Object.entries(variants)) {
  const root = `.automation-png/atlas-optimized/${options.size}`;
  const runtime: PipelineRuntime = {
    advance,
    common: decodeCommonAtlas(await readFile(`${root}/common.bin`)),
    options,
  };
  for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
    const plan = pipelinePlan(card, runtime);
    const pages = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const name of plan.pages.keys()) {
      const path = `${root}/${options.slots}/${name}`;
      if (!assetCache.has(path)) assetCache.set(path, new Uint8Array(await readFile(path)));
      pages.set(name, assetCache.get(path)!);
    }
    let frames: Uint8Array<ArrayBuffer>[] = [];
    const preparation = async () => {
      const next = [];
      for (let i = 0; i < plan.chunks.length; i++) {
        const current = pipelinePlan(card, runtime);
        const atlas = await loadAtlasChunk(
          current.chunks[i]!,
          async (name) =>
            readBoundedBody(new Response(pages.get(name)!), 4 * 1048576, options.compactRead),
          options.slots,
        );
        next.push(packAtlasChunk(atlas, i, current.chunks.length));
      }
      frames = next;
    };
    await preparation();
    const bundle = packAtlasBundle(frames);
    const assembly = () => assembleAtlasBundle(card, runtime, bundle);
    const png = assembleAtlasBundle(card, runtime, bundle);
    await writeFile(`.automation-png/optimized-${variant}-${fixture}.png`, png);
    if (variant === 'baseline') {
      const loaded = await loadCardAtlas(
        card,
        advance,
        async (name) => pages.get(name)!,
        1,
        runtime.common,
      );
      const previous = atlasPng(card, loaded);
      if (!Buffer.from(png).equals(previous)) throw new Error(`Local baseline changed: ${fixture}`);
    }
    results.push({
      variant,
      fixture,
      options,
      pages: pages.size,
      invocations: plan.chunks.length + 2,
      fetched_bytes: [...pages.values()].reduce((s, b) => s + b.length, 0),
      bundle_bytes: bundle.length,
      png_bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    cases.push({ preparation, assembly, prep: [], asm: [], prepCpu: [], asmCpu: [] });
  }
  console.log(`Prepared ${variant}`);
}
// Warm every case before any measurement. Rotate and reverse case order across
// rounds so the baseline does not uniquely pay JIT/Response initialization cost.
for (const c of cases)
  for (let i = 0; i < 5; i++) {
    await c.preparation();
    c.assembly();
  }
for (let round = 0; round < 5; round++) {
  const offset = (round * 13) % cases.length;
  const order = [...cases.slice(offset), ...cases.slice(0, offset)];
  if (round % 2) order.reverse();
  for (const c of order) {
    const prep = await measure(c.preparation),
      asm = await measure(c.assembly);
    c.prep.push(prep.wall_ms);
    c.prepCpu.push(prep.thread_cpu_ms);
    c.asm.push(asm.wall_ms);
    c.asmCpu.push(asm.thread_cpu_ms);
  }
  console.log(`Measured counterbalanced round ${round + 1}/5`);
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const cpuMean = (values: (number | null)[]) =>
  values.every((v): v is number => v !== null) ? mean(values) : null;
const measured = results.map((result, i) => ({
  ...result,
  preparation_total: {
    count: 50,
    wall_ms: mean(cases[i]!.prep),
    thread_cpu_ms: cpuMean(cases[i]!.prepCpu),
    batch_wall_ms: cases[i]!.prep,
  },
  assembly: {
    count: 50,
    wall_ms: mean(cases[i]!.asm),
    thread_cpu_ms: cpuMean(cases[i]!.asmCpu),
    batch_wall_ms: cases[i]!.asm,
  },
}));
await writeFile(
  '.automation-png/atlas-optimized-local.json',
  JSON.stringify(
    {
      measured_at_utc: new Date().toISOString(),
      qualification: 'not_qualified',
      scope:
        'Local Node warm phase measurements, not remote CPU. All cases prewarmed; 5 counterbalanced rounds of 10 repetitions. Pre-read assets wrapped in local Response streams; startup and network excluded. Preparation includes all glyph chunks, assembly receives prepared bundle. Mean phases are not request percentiles. pages-only variants also require changing the chunk size to stay inside invocation limits.',
      results: measured,
    },
    null,
    2,
  ) + '\n',
);
