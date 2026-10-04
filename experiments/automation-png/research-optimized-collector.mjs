// Profile only the remaining collector in local workerd. Child responses are
// prebuilt, bounded real frames: this isolates collector work, not network/PNG CPU.
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
    import { pipelinePlan, packAtlasBundle, assembleAtlasBundle } from './experiments/automation-png/atlas-pipeline';
    import { loadAtlasChunk, packAtlasChunk } from './experiments/automation-png/atlas-chunks';
    import { fixtures, atlasCoverageCard } from './experiments/automation-png/fixtures';
    const advance = atlasAdvance(JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')));
    export const replies = new Map(), inputs = [];
    for (const size of [800, 720]) {
      const root = '.automation-png/atlas-optimized/' + size;
      const runtime = { advance, common: decodeCommonAtlas(await readFile(root + '/common.bin')),
        options: { size, slots: 64, chunkSize: 3, compactRead: true, rle: true } };
      for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
        const plan = pipelinePlan(card, runtime), frames = [];
        for (const [i, chunk] of plan.chunks.entries()) {
          const frame = packAtlasChunk(await loadAtlasChunk(chunk, name => readFile(root + '/64/' + name), 64), i, plan.chunks.length);
          frames.push(frame); replies.set('/optimized/' + size + '/pipeline/glyphs/' + fixture + '/' + i, frame);
        }
        const png = assembleAtlasBundle(card, runtime, packAtlasBundle(frames));
        replies.set('/optimized/' + size + '/pipeline/assemble/' + fixture, png);
        inputs.push({ size, fixture, png, chunks: frames.length });
      }
    }
  `,
  },
  outfile: '.automation-png/optimized-profile-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { replies, inputs } = await import('../../.automation-png/optimized-profile-inputs.mjs');
const compiled = await build({
  entryPoints: ['experiments/automation-png/atlas-optimized-probe.ts'],
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
        const path = new URL(request.url).pathname;
        const bytes = replies.get(path);
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
  const run = async (input) => {
    const response = await mf.dispatchFetch(
      'http://localhost/probe/' + input.fixture + '/atlas_optimized' + input.size,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-synthetic-token-not-for-deployment' },
      },
    );
    assert.equal(response.status, 200);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(input.png));
  };
  await cdp('Profiler.enable');
  await cdp('Profiler.setSamplingInterval', { interval: 1000 });
  for (const input of inputs) await run(input);
  await cdp('Profiler.start');
  for (let round = 0; round < 20; round++) for (const input of inputs) await run(input);
  const { profile } = await cdp('Profiler.stop');
  await writeFile('.automation-png/optimized-collector.cpuprofile', JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
    counts = new Map();
  for (const sample of profile.samples ?? []) {
    const frame = nodes.get(sample).callFrame;
    const key = (frame.functionName || '(anonymous)') + ' @ ' + frame.url;
    if (key.startsWith('(idle)') || key.startsWith('(root)')) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const report = {
    measured_at_utc: new Date().toISOString(),
    qualification: 'not_qualified',
    scope:
      'Local workerd warm collector sampling, 200 synthetic requests. Real prebuilt frame/PNG responses supplied by a local mock child binding. Excludes actual child computation and remote transport; not remote CPU or per-request limit evidence. Native work may be attributed to JS caller.',
    requests: 200,
    non_idle_samples: total,
    top_self: [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, samples]) => ({ name, samples, fraction: samples / total })),
  };
  await writeFile(
    'docs/evidence/AI_PNG_OPTIMIZED_COLLECTOR_PROFILE_2026-10-02.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws?.close();
  await mf.dispose();
}
