import { readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { nativePng } from './native-png';
import { fastPng, rasterizeFast } from './fast-png';
import { BAND_COUNT, joinBands, renderBand } from './bands';

const rows: {
  fixture: string;
  phase: string;
  count: number;
  process_cpu_ms: number;
  thread_cpu_ms: number | null;
  wall_ms: number;
}[] = [];
async function time(fixture: string, phase: string, run: () => unknown, count = 50) {
  const start = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  for (let index = 0; index < count; index++) await run();
  const cpu = process.cpuUsage(start);
  const cpuThread = thread ? process.threadCpuUsage(thread) : null;
  rows.push({
    fixture,
    phase,
    count,
    process_cpu_ms: (cpu.user + cpu.system) / count / 1000,
    thread_cpu_ms: cpuThread ? (cpuThread.user + cpuThread.system) / count / 1000 : null,
    wall_ms: (performance.now() - wall) / count,
  });
}

await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const results = [];
for (const fixture of ['expression', 'comparison', 'long', 'long_comparison']) {
  const svg = await readFile(`.automation-png/${fixture}.svg`, 'utf8');
  await time(fixture, 'parse_and_free', () => {
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
    renderer.free();
  });
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    await time(fixture, 'render_and_free', () => {
      const output = renderer.render();
      output.free();
    });
    const rendered = renderer.render();
    try {
      await time(fixture, 'rgba_copy', () => rendered.pixels);
      await time(fixture, 'wasm_png', () => rendered.asPng());
      const pixels = rendered.pixels;
      await time(fixture, 'native_png', () => nativePng(pixels));
      await time(fixture, 'fast_png', () => fastPng(pixels));
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
  await time(fixture, 'fast_whole_raster', () => rasterizeFast(svg));
  const bands = Array.from({ length: BAND_COUNT }, (_, index) => renderBand(svg, index));
  for (let index = 0; index < BAND_COUNT; index++)
    await time(fixture, `band_${index}`, () => renderBand(svg, index));
  await time(fixture, 'join_bands', () => joinBands(bands));
  const joined = joinBands(bands);
  await writeFile(`.automation-png/${fixture}-bands.png`, joined);
  const png = rasterizeFast(svg);
  await writeFile(`.automation-png/${fixture}-fast.png`, png);
  results.push({ fixture, bytes: png.length, bands_bytes: joined.length });
}
const report = {
  measured_at_utc: new Date().toISOString(),
  environment: { runtime: process.version, cpu: cpus()[0]?.model },
  scope:
    'Local phase diagnostics. Raster phase reuses parsed SVG. Whole-raster includes parsing and PNG validation, excludes card-to-SVG. Not Cloudflare invocation CPU.',
  qualification: 'not_qualified',
  rows,
  results,
};
await writeFile('.automation-png/profile.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
