import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { atlasAdvance, decodeCommonAtlas, planCardAtlas, type AtlasMetrics } from './atlas-pages';
import {
  atlasChunks,
  loadAtlasChunk,
  mergeAtlases,
  packAtlasChunk,
  selectAtlas,
  unpackAtlasChunk,
} from './atlas-chunks';
import { atlasPng, atlasPngPrepared, packIndexedPng, paintAtlasRows } from './atlas';
import { fixtures, atlasCoverageCard } from './fixtures';

// Local diagnostics only. Pre-read assets, startup and network excluded. Each
// phase receives prepared inputs; phase means are not additive request timings.
const advance = atlasAdvance(
  JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')) as AtlasMetrics,
);
const common = decodeCommonAtlas(await readFile('.automation-png/atlas-common.bin'));
const results = [];
function measure(run: () => unknown) {
  for (let index = 0; index < 5; index++) run();
  const count = 100;
  const cpu = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  for (let index = 0; index < count; index++) run();
  const delta = process.cpuUsage(cpu);
  const threadDelta = thread ? process.threadCpuUsage(thread) : null;
  return {
    count,
    process_cpu_ms: (delta.user + delta.system) / count / 1000,
    thread_cpu_ms: threadDelta ? (threadDelta.user + threadDelta.system) / count / 1000 : null,
    wall_ms: (performance.now() - wall) / count,
  };
}
for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
  const plan = planCardAtlas(card, advance, 1, common);
  const chunks = atlasChunks(plan.pages);
  const frames: Uint8Array[] = [];
  for (const [index, chunk] of chunks.entries())
    frames.push(
      packAtlasChunk(
        await loadAtlasChunk(chunk, async (name) =>
          readFile(`.automation-png/atlas-v2-assets/${name}`),
        ),
        index,
        chunks.length,
      ),
    );
  const keys = chunks.map((chunk) => new Set(chunk.flatMap(([, keys]) => [...keys])));
  const unpack = () =>
    frames.map((frame, index) => unpackAtlasChunk(frame, index, chunks.length, keys[index]!));
  const parts = [selectAtlas(common, plan.commonKeys), ...unpack()];
  const atlas = mergeAtlases(parts, advance);
  const rows = paintAtlasRows(plan.prepared, atlas);
  const compressed = deflateSync(rows, { level: 1 });
  const assemble = (reuse: boolean) => {
    const current = planCardAtlas(card, advance, 1, common);
    const requests = atlasChunks(current.pages);
    const loaded = [
      selectAtlas(common, current.commonKeys),
      ...requests.map((request, index) =>
        unpackAtlasChunk(
          frames[index]!,
          index,
          requests.length,
          new Set(request.flatMap(([, keys]) => [...keys])),
        ),
      ),
    ];
    const merged = mergeAtlases(loaded, advance);
    return reuse ? atlasPngPrepared(current.prepared, merged) : atlasPng(card, merged);
  };
  const previous = assemble(false);
  const prepared = assemble(true);
  if (!Buffer.from(previous).equals(Buffer.from(prepared)))
    throw new Error(`${fixture}: PNG changed`);
  const phases = Object.fromEntries(
    Object.entries({
      plan: () => planCardAtlas(card, advance, 1, common),
      unpack_and_validate: unpack,
      merge: () => mergeAtlases(parts, advance),
      paint: () => paintAtlasRows(plan.prepared, atlas),
      deflate: () => deflateSync(rows, { level: 1 }),
      pack_and_validate_png: () => packIndexedPng(compressed),
      assembly_duplicate_layout: () => assemble(false),
      assembly_reuse_layout: () => assemble(true),
    }).map(([name, run]) => [name, measure(run)]),
  );
  results.push({
    fixture,
    phases,
    png_bytes: prepared.length,
    sha256: createHash('sha256').update(prepared).digest('hex'),
    identical_png: true,
  });
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local Node warm diagnostics only; not Cloudflare CPU. Assets/startup/network excluded. Prepared phase inputs; means are not additive. Full assembly includes plan, validation, merge, paint, compression and PNG validation. Baseline is measured before reuse, so ordering/JIT/GC effects remain.',
  results,
};
await writeFile(
  '.automation-png/atlas-assembly-profile.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    results.map(({ fixture, phases, identical_png }) => ({
      fixture,
      identical_png,
      process_cpu_ms: Object.fromEntries(
        Object.entries(phases).map(([key, value]) => [key, value.process_cpu_ms]),
      ),
    })),
    null,
    2,
  ),
);
