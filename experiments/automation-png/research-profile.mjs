// Local CPU sampling of the unchanged pipeline, with preloaded local font assets.
// The inspector and HTTP listener bind only to loopback. No Cloudflare deployment.
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
    import { loadAtlasChunk, packAtlasChunk } from './experiments/automation-png/atlas-chunks';
    import { pipelinePlan, packAtlasBundle } from './experiments/automation-png/atlas-pipeline';
    import { fixtures, atlasCoverageCard } from './experiments/automation-png/fixtures';
    const runtime = {
      advance: atlasAdvance(JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8'))),
      common: decodeCommonAtlas(await readFile('.automation-png/atlas-common.bin')),
    };
    export const assets = new Map();
    export const inputs = [];
    for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
      const plan = pipelinePlan(card, runtime);
      for (const name of plan.pages.keys())
        if (!assets.has(name)) assets.set(name, await readFile('.automation-png/atlas-v2-assets/' + name));
      const frames = [];
      for (const [index, chunk] of plan.chunks.entries())
        frames.push(packAtlasChunk(await loadAtlasChunk(chunk, async name => assets.get(name)), index, plan.chunks.length));
      inputs.push({ fixture, bundle: packAtlasBundle(frames), chunks: plan.chunks.length,
        pages: plan.pages.size,
        asset_bytes: [...plan.pages.keys()].reduce((sum, name) => sum + assets.get(name).length, 0),
        requested_glyphs: [...plan.pages.values()].reduce((sum, keys) => sum + keys.size, 0),
        expected: await readFile('.automation-png/remote-' + fixture + '-atlas_pipeline-0.png') });
    }
  `,
  },
  outfile: '.automation-png/research-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { inputs, assets } = await import('../../.automation-png/research-inputs.mjs');
const compiled = await build({
  entryPoints: ['experiments/automation-png/atlas-pipeline-worker.ts'],
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
    serviceBindings: {
      ATLAS_ASSETS: async (request) => {
        const name = new URL(request.url).pathname.slice(1);
        const bytes = assets.get(name);
        return bytes ? new Response(bytes) : new Response('Missing', { status: 404 });
      },
    },
  }),
);
let ws;
const profiles = [];
try {
  await mf.ready;
  const inspector = await mf.getInspectorURL();
  const listing = new URL('/json/list', inspector);
  listing.protocol = 'http:';
  const targets = await (await fetch(listing)).json();
  const target = targets.find((t) => t.webSocketDebuggerUrl);
  assert.ok(target, 'Missing local inspector target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Local inspector connection failed'));
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const response = JSON.parse(event.data);
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timeout);
    response.error
      ? entry.reject(new Error(response.error.message))
      : entry.resolve(response.result);
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, 15000);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await cdp('Profiler.enable');
  await cdp('Profiler.setSamplingInterval', { interval: 1000 });
  const assembly = async (input) => {
    const response = await mf.dispatchFetch('http://localhost/pipeline/assemble/' + input.fixture, {
      method: 'POST',
      body: input.bundle,
    });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.equals(input.expected), input.fixture + ': pipeline changed output');
  };
  const glyphs = async (input) => {
    for (let i = 0; i < input.chunks; i++) {
      const response = await mf.dispatchFetch(
        'http://localhost/pipeline/glyphs/' + input.fixture + '/' + i,
      );
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
  };
  for (const [name, run, rounds] of [
    ['assembly', assembly, 50],
    ['glyphs', glyphs, 10],
  ]) {
    for (const input of inputs) await run(input);
    await cdp('Profiler.start');
    for (let round = 0; round < rounds; round++) for (const input of inputs) await run(input);
    const { profile } = await cdp('Profiler.stop');
    await writeFile('.automation-png/research-' + name + '.cpuprofile', JSON.stringify(profile));
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map();
    for (const id of profile.samples ?? []) {
      const frame = nodes.get(id).callFrame;
      const key = (frame.functionName || '(anonymous)') + ' @ ' + frame.url;
      self.set(key, (self.get(key) ?? 0) + 1);
    }
    const all = [...self.entries()].sort((a, b) => b[1] - a[1]);
    const nonIdle = all.filter(
      ([name]) => !name.startsWith('(idle)') && !name.startsWith('(root)'),
    );
    const total = nonIdle.reduce((sum, [, count]) => sum + count, 0);
    const result = {
      name,
      rounds,
      fixtures: inputs.length,
      total_samples: profile.samples?.length,
      non_idle_samples: total,
      top_self: nonIdle
        .slice(0, 20)
        .map(([name, samples]) => ({ name, samples, fraction: samples / total })),
    };
    profiles.push(result);
    console.log(JSON.stringify(result));
  }
  await cdp('Profiler.disable');
} finally {
  ws?.close();
  await mf.dispose();
}
await writeFile(
  'docs/evidence/AI_PNG_WORKERD_PROFILE_RESEARCH_2026-10-02.json',
  JSON.stringify(
    {
      measured_at_utc: new Date().toISOString(),
      qualification: 'not_qualified',
      scope:
        'Local workerd warm sampling via V8 Inspector; unchanged pipeline code, local preloaded font asset binding; not remote CPU, wall time or per-request limit evidence. Self samples include runtime work and idle is excluded from displayed fractions. Native work may be attributed to its JS caller.',
      inputs: inputs.map(({ fixture, pages, chunks, asset_bytes, requested_glyphs, bundle }) => ({
        fixture,
        pages,
        chunks,
        asset_bytes,
        requested_glyphs,
        bundle_bytes: bundle.length,
      })),
      profiles,
    },
    null,
    2,
  ) + '\n',
);
