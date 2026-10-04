import { readFile, writeFile } from 'node:fs/promises';
import { atlasAdvance, loadCardAtlas, decodeCommonAtlas, type AtlasMetrics } from './atlas-pages';
import { atlasPng } from './atlas';
import { fixtures, atlasCoverageCard } from './fixtures';

const metrics = JSON.parse(
  await readFile('.automation-png/atlas-metrics.json', 'utf8'),
) as AtlasMetrics;
const advance = atlasAdvance(metrics);
const common = decodeCommonAtlas(await readFile('.automation-png/atlas-common.bin'));
const results = [];
for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
  const pages = new Map<string, Uint8Array>();
  const getPage = async (name: string) => {
    if (!pages.has(name))
      pages.set(name, new Uint8Array(await readFile(`.automation-png/atlas-v2-assets/${name}`)));
    return pages.get(name)!;
  };
  const atlas = await loadCardAtlas(card, advance, getPage, 1, common);
  const png = atlasPng(card, atlas);
  await writeFile(`.automation-png/${fixture}-atlas-full.png`, png);
  const start = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  const count = 50;
  for (let index = 0; index < count; index++)
    atlasPng(card, await loadCardAtlas(card, advance, getPage, 1, common));
  const cpu = process.cpuUsage(start);
  const threadCpu = thread ? process.threadCpuUsage(thread) : null;
  results.push({
    fixture,
    count,
    process_cpu_ms: (cpu.user + cpu.system) / count / 1000,
    thread_cpu_ms: threadCpu ? (threadCpu.user + threadCpu.system) / count / 1000 : null,
    wall_ms: (performance.now() - wall) / count,
    page_fetches: pages.size,
    fetched_bytes: [...pages.values()].reduce((sum, page) => sum + page.length, 0),
    selected_pixels: atlas.pixels.length,
    png_bytes: png.length,
  });
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local full-character page decoding + glyph selection + dynamic layout + PNG. Page bytes pre-read; I/O not measured. Not Cloudflare CPU.',
  results,
};
await writeFile('.automation-png/atlas-pages-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
