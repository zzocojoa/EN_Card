import { readFile, writeFile } from 'node:fs/promises';
import { atlasAdvance, decodeCommonAtlas, planCardAtlas, type AtlasMetrics } from './atlas-pages';
import {
  atlasChunks,
  loadAtlasChunk,
  mergeAtlases,
  packAtlasChunk,
  selectAtlas,
  unpackAtlasChunk,
} from './atlas-chunks';
import { atlasPngPrepared } from './atlas';
import { fixtures, atlasCoverageCard } from './fixtures';

const advance = atlasAdvance(
  JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')) as AtlasMetrics,
);
const common = decodeCommonAtlas(await readFile('.automation-png/atlas-common.bin'));
const results = [];
async function measure(run: () => unknown) {
  const cpu = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  const count = 50;
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
for (const [name, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
  const plan = planCardAtlas(card, advance, 1, common);
  const chunks = atlasChunks(plan.pages);
  const pages = new Map<string, Uint8Array>();
  for (const key of plan.pages.keys())
    pages.set(key, await readFile(`.automation-png/atlas-v2-assets/${key}`));
  const frames: Uint8Array<ArrayBuffer>[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const run = async () => {
      const current = atlasChunks(planCardAtlas(card, advance, 1, common).pages);
      return packAtlasChunk(
        await loadAtlasChunk(current[index]!, async (name) => pages.get(name)!),
        index,
        current.length,
      );
    };
    frames.push(await run());
    results.push({
      fixture: name,
      phase: `glyph_chunk_${index}`,
      pages: chunk.length,
      ...(await measure(run)),
    });
  }
  const run = () => {
    const current = planCardAtlas(card, advance, 1, common);
    const requests = atlasChunks(current.pages);
    const parts = [selectAtlas(common, current.commonKeys)];
    for (const [index, request] of requests.entries())
      parts.push(
        unpackAtlasChunk(
          frames[index]!,
          index,
          requests.length,
          new Set(request.flatMap(([, keys]) => [...keys])),
        ),
      );
    return atlasPngPrepared(current.prepared, mergeAtlases(parts, advance));
  };
  results.push({
    fixture: name,
    phase: 'assemble_png',
    chunks: chunks.length,
    ...(await measure(run)),
  });
  await writeFile(`.automation-png/${name}-atlas-chunks.png`, run());
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local separate font preparation / assembly invocation candidates. Includes dynamic plans and binary frame validation. Assets pre-read, I/O and startup excluded. Not Cloudflare CPU.',
  results,
};
await writeFile('.automation-png/atlas-chunks-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
