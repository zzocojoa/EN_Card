import { readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { deflateSync } from 'node:zlib';
import { initWasm } from '@resvg/resvg-wasm';
import { loadFonts } from './fonts';
import { CardFonts } from './svg';
import { buildAtlas, atlasStyles } from './atlas-build';
import { atlasPng } from './atlas';
import { fixtures } from './fixtures';

await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const fonts = new CardFonts(await loadFonts());
const characters =
  Object.values(fixtures).flatMap(Object.values).join('') +
  '0123456789  /  오늘의 표현 비교 하루 한 표현';
const buildStart = performance.now();
const atlas = buildAtlas(fonts, characters);
await writeFile('.automation-png/atlas-glyphs.json', JSON.stringify(atlas.glyphs));
await writeFile('.automation-png/atlas-pixels.bin', atlas.pixels);
const buildMs = performance.now() - buildStart;
const rows = [];
for (const [fixture, card] of Object.entries(fixtures)) {
  const png = atlasPng(card, atlas);
  await writeFile(`.automation-png/${fixture}-atlas.png`, png);
  const start = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  const count = 100;
  for (let iteration = 0; iteration < count; iteration++) atlasPng(card, atlas, iteration + 1);
  const cpu = process.cpuUsage(start);
  const cpuThread = thread ? process.threadCpuUsage(thread) : null;
  rows.push({
    fixture,
    iterations: count,
    process_cpu_ms: (cpu.user + cpu.system) / count / 1000,
    thread_cpu_ms: cpuThread ? (cpuThread.user + cpuThread.system) / count / 1000 : null,
    wall_ms: (performance.now() - wall) / count,
    bytes: png.length,
  });
}
const report = {
  measured_at_utc: new Date().toISOString(),
  environment: { runtime: process.version, cpu: cpus()[0]?.model },
  scope:
    'Local card validation, dynamic layout, sprite blit, indexed PNG, PNG validation. Build and atlas loading excluded. Example character subset only; not full alphabet coverage or Cloudflare CPU.',
  qualification: 'not_qualified',
  raster_difference:
    'Same fonts/layout. Independent character advances, integer positions and 31 alpha levels; no kerning/ligatures. Needs visual assessment and broader charset/storage validation.',
  atlas: {
    styles: atlasStyles.length,
    glyphs: Object.keys(atlas.glyphs).length,
    pixels_bytes: atlas.pixels.length,
    compressed_pixels_bytes: deflateSync(atlas.pixels).length,
    metadata_bytes: JSON.stringify(atlas.glyphs).length,
    build_ms: buildMs,
  },
  rows,
};
await writeFile('.automation-png/atlas-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
