import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { initWasm } from '@resvg/resvg-wasm';
import { CardFonts, cardSvg } from './svg';
import { loadFonts } from './fonts';
import { fixtures } from './fixtures';
import { rasterize, rasterizeNative } from './raster';

const output = '.automation-png';
await mkdir(output, { recursive: true });
const sources = await loadFonts();

function measure<T>(run: () => T): {
  value: T;
  cpu_ms: number;
  thread_cpu_ms: number | null;
  wall_ms: number;
} {
  const start = process.cpuUsage();
  const thread = process.threadCpuUsage?.();
  const wall = performance.now();
  const value = run();
  const wall_ms = performance.now() - wall;
  const cpu = process.cpuUsage(start);
  const threadCpu = thread ? process.threadCpuUsage(thread) : null;
  return {
    value,
    cpu_ms: (cpu.user + cpu.system) / 1000,
    thread_cpu_ms: threadCpu ? (threadCpu.user + threadCpu.system) / 1000 : null,
    wall_ms,
  };
}
const wasm = await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm');
const initialCpu = process.cpuUsage();
const initialWall = performance.now();
await initWasm(wasm);
const initWall = performance.now() - initialWall;
const initCpu = process.cpuUsage(initialCpu);
const rows = [];
const alternatives = [];
for (const [name, card] of Object.entries(fixtures)) {
  const fonts = new CardFonts(sources);
  for (let iteration = 0; iteration < 6; iteration++) {
    globalThis.gc?.();
    const memoryBefore = process.memoryUsage();
    const svg = measure(() => cardSvg(card, fonts));
    const png = measure(() => rasterize(svg.value));
    const memoryAfter = process.memoryUsage();
    rows.push({
      fixture: name,
      iteration,
      font_cache: iteration === 0 ? 'cold' : 'warm',
      svg_cpu_ms: svg.cpu_ms,
      svg_wall_ms: svg.wall_ms,
      png_cpu_ms: png.cpu_ms,
      png_wall_ms: png.wall_ms,
      svg_thread_cpu_ms: svg.thread_cpu_ms,
      png_thread_cpu_ms: png.thread_cpu_ms,
      local_total_cpu_ms: svg.cpu_ms + png.cpu_ms,
      bytes: png.value.length,
      png_sha256: createHash('sha256').update(png.value).digest('hex'),
      memory_before: memoryBefore,
      memory_after: memoryAfter,
    });
    if (iteration === 0) {
      await writeFile(`${output}/${name}.svg`, svg.value);
      await writeFile(`${output}/${name}.png`, png.value);
    }
  }
  const svg = cardSvg(card, fonts);
  // Aggregate 20 iterations because Windows CPU counters have coarse resolution.
  const baseline = measure(() => {
    for (let n = 0; n < 20; n++) rasterize(svg);
  });
  const cpu = process.cpuUsage();
  const wall = performance.now();
  let native: Uint8Array<ArrayBuffer> | undefined;
  for (let n = 0; n < 20; n++) native = await rasterizeNative(svg);
  const nativeWall = performance.now() - wall;
  const nativeCpu = process.cpuUsage(cpu);
  await writeFile(`${output}/${name}-native.png`, native!);
  alternatives.push({
    fixture: name,
    iterations: 20,
    baseline_mean_process_cpu_ms: baseline.cpu_ms / 20,
    baseline_mean_thread_cpu_ms:
      baseline.thread_cpu_ms === null ? null : baseline.thread_cpu_ms / 20,
    baseline_mean_wall_ms: baseline.wall_ms / 20,
    native_mean_process_cpu_ms: (nativeCpu.user + nativeCpu.system) / 1000 / 20,
    native_mean_wall_ms: nativeWall / 20,
    native_bytes: native!.length,
  });
}
const report = {
  measured_at_utc: new Date().toISOString(),
  environment: {
    runtime: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
  },
  renderer: '@resvg/resvg-wasm@2.6.2',
  wasm_sha256: createHash('sha256').update(wasm).digest('hex'),
  fonts_sha256: createHash('sha256')
    .update(Buffer.concat(sources.map((source) => source.bytes)))
    .digest('hex'),
  wasm_init: { cpu_ms: (initCpu.user + initCpu.system) / 1000, wall_ms: initWall },
  limits: { worker_cpu_ms: 10, worker_memory_bytes: 128 * 1024 * 1024, image_bytes: 1048576 },
  qualification: 'not_qualified',
  remote_cpu: 'not_measured',
  memory_scope: 'Node process snapshots; neither peak memory nor Worker isolate memory',
  cpu_scope:
    'Local Node process and calling thread; Windows counters are coarse, use batch means. Native compression may run on another thread. Not Cloudflare invocation CPU.',
  prebuild:
    'Font WOFF2 to TTF decompression is excluded; generated from the existing OFL-licensed fonts.',
  note: 'Local process CPU is diagnostic only. No Worker Free approval, real AI calls, database writes, scheduling or message sending.',
  rows,
  alternatives,
};
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      ...report,
      rows: rows.map(({ memory_before: _before, memory_after: _after, ...row }) => row),
    },
    null,
    2,
  ),
);
