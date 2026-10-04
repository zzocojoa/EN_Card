// Compare the same real frames with the old routing and direct binding routing.
// Workerd child computation/transport is mocked; CPU samples are diagnostic only.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { readFile } from 'node:fs/promises';
      import { atlasAdvance, decodeCommonAtlas } from './experiments/automation-png/atlas-pages';
      import { pipelinePlan, packAtlasBundle, assembleAtlasBundle, readBoundedBody } from './experiments/automation-png/atlas-pipeline';
      import { loadAtlasChunk, packAtlasChunk } from './experiments/automation-png/atlas-chunks';
      import { fixtures, atlasCoverageCard } from './experiments/automation-png/fixtures';
      const advance = atlasAdvance(JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')));
      export const replies = new Map(), inputs = [], preparation = [];
      const benchmarks = [], cache = new Map();
      for (const size of [800, 720]) {
        const root = '.automation-png/atlas-optimized/' + size;
        const common = decodeCommonAtlas(await readFile(root + '/common.bin'));
        for (const chunkSize of [3, 4, 6, 8]) {
          const runtime = { advance, common, options: { size, slots: 64, chunkSize, compactRead: true, rle: true } };
          for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
            const plan = pipelinePlan(card, runtime), frames = [], runs = [];
            for (const name of plan.pages.keys()) {
              const path = root + '/64/' + name;
              if (!cache.has(path)) cache.set(path, await readFile(path));
            }
            for (const [i, chunk] of plan.chunks.entries()) {
              const run = async () => {
                const current = pipelinePlan(card, runtime);
                const loaded = await loadAtlasChunk(current.chunks[i], name => readBoundedBody(new Response(cache.get(root + '/64/' + name)), 4 * 1048576, true), 64);
                return packAtlasChunk(loaded, i, current.chunks.length);
              };
              const frame = await run(); runs.push(run); frames.push(frame);
              replies.set('/lean' + chunkSize + '/' + size + '/pipeline/glyphs/' + fixture + '/' + i, frame);
              if (chunkSize === 3) replies.set('/optimized/' + size + '/pipeline/glyphs/' + fixture + '/' + i, frame);
            }
            const png = assembleAtlasBundle(card, runtime, packAtlasBundle(frames));
            const baseline = await readFile('.automation-png/optimized-combined' + size + '_64-' + fixture + '.png');
            if (!Buffer.from(png).equals(baseline)) throw new Error('Chunk regrouping changed PNG');
            replies.set('/lean' + chunkSize + '/' + size + '/pipeline/assemble/' + fixture, png);
            if (chunkSize === 3) {
              replies.set('/optimized/' + size + '/pipeline/assemble/' + fixture, png);
              inputs.push({ size, fixture, png });
            }
            const row = { size, fixture, chunk_size: chunkSize, pages: plan.pages.size, chunks: frames.length, max_frame_bytes: Math.max(...frames.map(f => f.length)), chunk_wall_ms: [] };
            preparation.push(row); benchmarks.push({ runs, row });
          }
        }
      }
      for (const { runs } of benchmarks) for (let warm = 0; warm < 3; warm++) for (const run of runs) await run();
      for (let round = 0; round < 5; round++) {
        const offset = round * 7 % benchmarks.length;
        const order = [...benchmarks.slice(offset), ...benchmarks.slice(0, offset)];
        if (round % 2) order.reverse();
        for (const { runs, row } of order) {
          const times = [];
          for (const run of runs) {
            const start = performance.now();
            for (let repeat = 0; repeat < 10; repeat++) await run();
            times.push((performance.now() - start) / 10);
          }
          row.chunk_wall_ms.push(times);
        }
      }
    `,
  },
  outfile: '.automation-png/lean-profile-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { replies, inputs, preparation } =
  await import('../../.automation-png/lean-profile-inputs.mjs');
const compiled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import oldProbe from './experiments/automation-png/atlas-optimized-probe';
      import { createPipelineProbe } from './experiments/automation-png/atlas-pipeline';
      import { leanRuntime } from './experiments/automation-png/atlas-lean-runtime';
      const probes = {};
      for (const size of ['800', '720']) for (const count of [3,4,6,8])
        probes['atlas_lean' + count + '_' + size] = createPipelineProbe(leanRuntime(size, count), { encoder: 'atlas_lean' + count + '_' + size, rendererPrefix: '/lean' + count + '/' + size });
      export default { fetch(request, env) {
        const encoder = new URL(request.url).pathname.split('/').pop();
        return encoder.startsWith('atlas_optimized') ? oldProbe.fetch(request, env) : probes[encoder].fetch(request, env);
      } };
    `,
  },
  bundle: true,
  write: false,
  platform: 'neutral',
  format: 'esm',
  external: ['node:*'],
  mainFields: ['module', 'main'],
  loader: { '.bin': 'binary', '.data': 'text' },
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: '127.0.0.1',
    port: 0,
    inspectorHost: '127.0.0.1',
    inspectorPort: 0,
    cf: false,
    telemetry: { enabled: false },
    modules: true,
    script: compiled.outputFiles[0].text,
    compatibilityDate: '2026-09-01',
    bindings: { BENCH_TOKEN: 'local-synthetic-token-not-for-deployment' },
    serviceBindings: {
      RENDERER: async (request) => {
        const path = new URL(request.url).pathname,
          bytes = replies.get(path);
        assert.ok(bytes, 'Unexpected child request');
        if (request.body) await request.arrayBuffer();
        return new Response(bytes, {
          headers: {
            'Content-Type': path.includes('/assemble/') ? 'image/png' : 'application/octet-stream',
          },
        });
      },
    },
  }),
);
const variants = ['optimized', 'lean3', 'lean4', 'lean6', 'lean8'];
const measurements = Object.fromEntries(
  variants.map((v) => [v, { requests: 0, non_idle_samples: 0, top_self: {}, wall_ms: [] }]),
);
let ws;
try {
  await mf.ready;
  const listing = new URL('/json/list', await mf.getInspectorURL());
  listing.protocol = 'http:';
  const target = (await (await fetch(listing)).json()).find((t) => t.webSocketDebuggerUrl);
  assert.ok(target);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Local inspector unavailable'));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const r = JSON.parse(event.data),
      p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    clearTimeout(p.timeout);
    r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result);
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const seq = ++id;
      const timeout = setTimeout(() => {
        pending.delete(seq);
        reject(new Error('Local profiler timeout'));
      }, 15000);
      pending.set(seq, { resolve, reject, timeout });
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  const run = async (variant, input) => {
    const encoder =
      variant === 'optimized'
        ? 'atlas_optimized' + input.size
        : 'atlas_' + variant + '_' + input.size;
    const start = performance.now();
    const response = await mf.dispatchFetch(
      'http://localhost/probe/' + input.fixture + '/' + encoder,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-synthetic-token-not-for-deployment' },
      },
    );
    assert.equal(response.status, 200);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(input.png));
    return performance.now() - start;
  };
  await cdp('Profiler.enable');
  await cdp('Profiler.setSamplingInterval', { interval: 1000 });
  for (const v of variants) for (const input of inputs) await run(v, input);
  for (let round = 0; round < 5; round++) {
    const order = [...variants.slice(round), ...variants.slice(0, round)];
    if (round % 2) order.reverse();
    for (const variant of order) {
      const row = measurements[variant];
      await cdp('Profiler.start');
      for (let repeat = 0; repeat < 5; repeat++)
        for (const input of inputs) {
          row.wall_ms.push(await run(variant, input));
          row.requests++;
        }
      const { profile } = await cdp('Profiler.stop');
      const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
      for (const sample of profile.samples ?? []) {
        const frame = nodes.get(sample).callFrame,
          name = frame.functionName || '(anonymous)';
        if (name === '(idle)' || name === '(root)') continue;
        row.non_idle_samples++;
        row.top_self[name] = (row.top_self[name] ?? 0) + 1;
      }
    }
    console.log('Collector comparison round ' + (round + 1) + '/5');
  }
  const report = {
    measured_at_utc: new Date().toISOString(),
    qualification: 'not_qualified',
    scope:
      'Local Node preparation wall time (50 repetitions per chunk) and local workerd warm collector profile (250 requests per variant, 5 rotated/reversed rounds). Real prebuilt child frames and PNG supplied by a mock binding; excludes actual child CPU and remote transport. Wall time and 1ms profiler samples are not Cloudflare per-request CPU evidence.',
    measurements,
    preparation,
  };
  await writeFile(
    'docs/evidence/AI_PNG_LEAN_LOCAL_2026-10-03.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  for (const [variant, row] of Object.entries(measurements))
    console.log(
      JSON.stringify({
        variant,
        requests: row.requests,
        samples: row.non_idle_samples,
        mean_wall_ms: row.wall_ms.reduce((a, b) => a + b, 0) / row.wall_ms.length,
        top: Object.entries(row.top_self)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8),
      }),
    );
} finally {
  ws?.close();
  await mf.dispose();
}
