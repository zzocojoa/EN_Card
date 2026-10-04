// Fresh local workerd instances distinguish first assembly from warmed assembly.
// Module startup and glyph fetches are deliberately outside the measured scope.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
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
    export const inputs = [];
    for (const size of [800, 720]) {
      const root = '.automation-png/atlas-optimized/' + size;
      const runtime = { advance, common: decodeCommonAtlas(await readFile(root + '/common.bin')),
        options: { size, slots: 64, chunkSize: 6, compactRead: true, rle: true } };
      for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
        const plan = pipelinePlan(card, runtime), frames = [];
        for (const [i, chunk] of plan.chunks.entries()) frames.push(packAtlasChunk(await loadAtlasChunk(chunk, name => readFile(root + '/64/' + name), 64), i, plan.chunks.length));
        const bundle = packAtlasBundle(frames), png = assembleAtlasBundle(card, runtime, bundle);
        inputs.push({ size, fixture, bundle, png });
      }
    }
  `,
  },
  outfile: '.automation-png/assembly-profile-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { inputs } = await import('../../.automation-png/assembly-profile-inputs.mjs');
for (const input of inputs)
  assert.ok(
    Buffer.from(input.png).equals(
      await readFile(`.automation-png/optimized-combined${input.size}_64-${input.fixture}.png`),
    ),
  );
if (process.argv.includes('--prepare-only')) {
  console.log('Prepared 10 bounded assembly inputs; all match preserved baseline PNGs.');
  process.exit(0);
}
const compiled = await build({
  entryPoints: ['experiments/automation-png/atlas-lean-worker.ts'],
  bundle: true,
  write: false,
  platform: 'neutral',
  format: 'esm',
  external: ['node:*'],
  mainFields: ['module', 'main'],
  loader: { '.bin': 'binary', '.data': 'text' },
});
const rows = [],
  profiles = { first: {}, warm: {} };
function collect(profile, bucket) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const id of profile.samples ?? []) {
    const frame = nodes.get(id).callFrame,
      name = (frame.functionName || '(anonymous)') + ' @ ' + frame.url;
    if (name.startsWith('(idle)') || name.startsWith('(root)')) continue;
    bucket[name] = (bucket[name] ?? 0) + 1;
  }
}
for (let repeat = 0; repeat < 2; repeat++)
  for (const input of repeat ? [...inputs].reverse() : inputs) {
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
      const run = async () => {
        const start = performance.now();
        const response = await mf.dispatchFetch(
          `http://localhost/lean/${input.size}/pipeline/assemble/${input.fixture}`,
          { method: 'POST', body: input.bundle },
        );
        assert.equal(response.status, 200);
        assert.ok(Buffer.from(await response.arrayBuffer()).equals(input.png));
        return performance.now() - start;
      };
      await cdp('Profiler.enable');
      await cdp('Profiler.setSamplingInterval', { interval: 100 });
      await cdp('Profiler.start');
      const first = await run();
      collect((await cdp('Profiler.stop')).profile, profiles.first);
      const subsequent = [];
      for (let i = 0; i < 4; i++) subsequent.push(await run());
      await cdp('Profiler.start');
      const warm = [];
      for (let i = 0; i < 20; i++) warm.push(await run());
      collect((await cdp('Profiler.stop')).profile, profiles.warm);
      rows.push({
        repeat,
        size: input.size,
        fixture: input.fixture,
        first_wall_ms: first,
        subsequent_wall_ms: subsequent,
        warm_wall_ms: warm,
      });
      console.log(
        JSON.stringify({
          repeat,
          size: input.size,
          fixture: input.fixture,
          first_wall_ms: first,
          warm_mean_wall_ms: warm.reduce((a, b) => a + b, 0) / warm.length,
        }),
      );
    } finally {
      ws?.close();
      await mf.dispose();
    }
  }
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    '20 fresh local workerd instances (2 per size/fixture), each first assembly + 4 subsequent + 20 warm assemblies. Real bounded bundles; exact PNG parity on every response. Module startup and glyph preparation excluded. 100us profiler samples and host wall time, not remote per-request CPU. First/warm totals have different request counts; compare proportions or per-request counts, never raw totals.',
  rows,
  profiles,
};
await writeFile(
  'docs/evidence/AI_PNG_ASSEMBLY_COLD_LOCAL_2026-10-03.json',
  JSON.stringify(report, null, 2) + '\n',
);
for (const [phase, counts] of Object.entries(profiles))
  console.log(
    JSON.stringify({
      phase,
      non_idle_samples: Object.values(counts).reduce((a, b) => a + b, 0),
      top: Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    }),
  );
