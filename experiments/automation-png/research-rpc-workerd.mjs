// HTTP and binary RPC over real local workerd Service Bindings. Never deploys.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const smokeOnly = process.argv.includes('--smoke');
const token = 'local-synthetic-token-not-for-deployment';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
execFileSync(
  process.execPath,
  ['experiments/automation-png/research-assembly-workerd.mjs', '--prepare-only'],
  { stdio: 'inherit' },
);
const { inputs } = await import('../../.automation-png/assembly-profile-inputs.mjs');
const canned = {};
let glyphCount = 0;
for (const input of inputs) {
  const view = new DataView(input.bundle.buffer, input.bundle.byteOffset, input.bundle.length);
  const count = view.getUint16(4);
  input.chunks = count;
  let offset = 8;
  for (let index = 0; index < count; index++) {
    const length = view.getUint32(offset);
    offset += 4;
    canned[`${input.size}/${input.fixture}/${index}`] = Buffer.from(
      input.bundle.subarray(offset, offset + length),
    ).toString('base64');
    offset += length;
    glyphCount++;
  }
  assert.equal(offset, input.bundle.length);
  canned[`${input.size}/${input.fixture}/png`] = Buffer.from(input.png).toString('base64');
}
assert.equal(glyphCount, 72);
async function compile(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'neutral',
    format: 'esm',
    external: ['node:*', 'cloudflare:workers'],
    mainFields: ['module', 'main'],
    loader: { '.bin': 'binary', '.data': 'text' },
  });
  return result.outputFiles[0].text;
}
const probeScript = await compile('experiments/automation-png/atlas-rpc-probe.ts');
const fullScript = await compile('experiments/automation-png/atlas-rpc-worker.ts');
const sourceFiles = [
  'experiments/automation-png/atlas-pipeline.ts',
  'experiments/automation-png/atlas-rpc.ts',
  'experiments/automation-png/atlas-rpc-worker.ts',
  'experiments/automation-png/atlas-rpc-probe.ts',
  'experiments/automation-png/research-rpc-workerd.mjs',
];
const sources = [];
for (const file of sourceFiles) sources.push({ file, sha256: hash(await readFile(file)) });
// Prepared replies deliberately exclude glyph/PNG computation in collector scope.
// Both variants still cross an actual workerd service/RPC boundary, not Node callbacks.
const cannedScript = `import { WorkerEntrypoint } from 'cloudflare:workers';
const values = Object.fromEntries(Object.entries(${JSON.stringify(canned)}).map(([key, value]) => [key, Uint8Array.fromBase64(value)]));
export default class extends WorkerEntrypoint {
  glyphs(size, fixture, index) { return values[size + '/' + fixture + '/' + index].buffer; }
  assemble(size, fixture, bytes) { if (!(bytes instanceof ArrayBuffer)) throw new Error('Expected buffer'); return values[size + '/' + fixture + '/png'].buffer; }
  async fetch(request) {
    const m = /^\\/lean\\/(800|720)\\/pipeline\\/(glyphs|assemble)\\/([a-z_]+)(?:\\/(\\d+))?$/.exec(new URL(request.url).pathname);
    if (!m) return new Response('Not found', {status:404});
    if (m[2] === 'assemble') await request.arrayBuffer();
    return new Response(values[m[1] + '/' + m[3] + '/' + (m[2] === 'assemble' ? 'png' : m[4])], {headers:{'Content-Type':m[2] === 'assemble' ? 'image/png' : 'application/octet-stream'}});
  }
}`;
// Keep negative RPC calls inside workerd as well. Node's getWorker property
// bridge creates RPC method stubs; it is not the transport under evaluation.
const validationScript = `export default { async fetch(request, env) {
  const rejected = [], accepted = [];
  for (const [name, args] of [['size',[1080,'expression',0]],['fixture',['800','constructor',0]],['index',['800','expression',999]],['string_index',['800','expression','0']]]) {
    try { await env.RENDERER.glyphs(...args); accepted.push(name); } catch { rejected.push(name); }
  }
  for (const [name, bytes] of [['typed_array',new Uint8Array(16)],['over_4MiB',new ArrayBuffer(4*1048576+1)],['truncated_bundle',new ArrayBuffer(16)]]) {
    try { await env.RENDERER.assemble('800','expression',bytes); accepted.push(name); } catch { rejected.push(name); }
  }
  const hidden = await env.RENDERER.fetch('http://localhost/800/FONT-LICENSE.txt');
  if (hidden.status === 404) rejected.push('direct_asset_http_404'); else accepted.push('direct_asset_http');
  await hidden.arrayBuffer();
  return Response.json({ rejected, accepted });
} };`;
function local(scope, validate = false) {
  return new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      cf: false,
      telemetry: { enabled: false },
      workers: [
        {
          name: 'probe',
          modules: true,
          script: probeScript,
          compatibilityDate: '2026-09-01',
          bindings: { BENCH_TOKEN: token },
          serviceBindings: { RENDERER: 'renderer' },
        },
        {
          name: 'renderer',
          modules: true,
          script: scope === 'full' ? fullScript : cannedScript,
          compatibilityDate: '2026-09-01',
          ...(scope === 'full'
            ? {
                assets: {
                  directory: '.automation-png/atlas-optimized/assets',
                  binding: 'ATLAS_ASSETS',
                  run_worker_first: true,
                  routerConfig: { has_user_worker: true },
                  assetConfig: { html_handling: 'none', not_found_handling: 'none' },
                },
              }
            : {}),
        },
        ...(validate
          ? [
              {
                name: 'validator',
                modules: true,
                script: validationScript,
                compatibilityDate: '2026-09-01',
                serviceBindings: { RENDERER: 'renderer' },
              },
            ]
          : []),
      ],
    }),
  );
}
async function run(mf, variant, input) {
  const start = performance.now();
  const response = await mf.dispatchFetch(
    `http://localhost/probe/${input.fixture}/atlas_${variant === 'fetch' ? 'lean' : 'rpc'}${input.size}`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  const wall_ms = performance.now() - start; // Equality checks are outside timing.
  assert.equal(
    response.status,
    200,
    `${variant}/${input.size}/${input.fixture}: ${bytes.subarray(0, 80)}`,
  );
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(Number(response.headers.get('X-Atlas-Chunks')), input.chunks);
  assert.ok(bytes.equals(input.png), 'Exact PNG mismatch');
  return wall_ms;
}
const verification = {
  checked_at_utc: new Date().toISOString(),
  scope: 'Local workerd real assets, HTTP and RPC Service Bindings. No remote CPU.',
  rows: [],
  rejected: [],
};
const mf = local('full', true);
try {
  await mf.ready;
  for (const input of inputs)
    for (const variant of ['fetch', 'rpc']) {
      await run(mf, variant, input);
      verification.rows.push({
        variant,
        size: input.size,
        fixture: input.fixture,
        chunks: input.chunks,
        png_bytes: input.png.length,
        png_sha256: hash(input.png),
      });
    }
  const validator = await mf.getWorker('validator');
  const checks = await (await validator.fetch('http://localhost/')).json();
  assert.deepEqual(checks.accepted, []);
  assert.equal(checks.rejected.length, 8);
  verification.rejected.push(...checks.rejected);
  for (const [path, method, authorized, status] of [
    ['/probe/expression/atlas_rpc800', 'POST', false, 401],
    ['/probe/expression/atlas_rpc800', 'GET', true, 405],
    ['/probe/expression/atlas_rpc800?url=https://other.test', 'POST', true, 404],
    ['/probe/constructor/atlas_rpc800', 'POST', true, 404],
  ]) {
    const response = await mf.dispatchFetch('http://localhost' + path, {
      method,
      headers: authorized ? { Authorization: `Bearer ${token}` } : {},
    });
    assert.equal(response.status, status);
    await response.arrayBuffer();
    verification.rejected.push(`${method} ${path} ${status}`);
  }
} finally {
  await mf.dispose();
}
await writeFile(
  'docs/evidence/AI_PNG_RPC_WORKER_2026-10-03.json',
  JSON.stringify(verification, null, 2) + '\n',
);
console.log(
  `Local RPC verification: ${verification.rows.length} exact PNGs; ${verification.rejected.length} rejection cases.`,
);
if (smokeOnly) process.exit(0);

const rows = [];
for (const scope of ['collector', 'full']) {
  for (let round = 0; round < 2; round++) {
    const order = round % 2 ? [...inputs].reverse() : inputs;
    for (const input of order) {
      const modes = (round + inputs.indexOf(input)) % 2 ? ['rpc', 'fetch'] : ['fetch', 'rpc'];
      for (const variant of modes) {
        const start = performance.now();
        const instance = local(scope);
        try {
          await instance.ready;
          const setup_wall_ms = performance.now() - start;
          const first_wall_ms = await run(instance, variant, input);
          const settling_wall_ms = [];
          for (let i = 0; i < 2; i++) settling_wall_ms.push(await run(instance, variant, input));
          const warm_wall_ms = [];
          for (let i = 0; i < 10; i++) warm_wall_ms.push(await run(instance, variant, input));
          rows.push({
            scope,
            round,
            variant,
            size: input.size,
            fixture: input.fixture,
            chunks: input.chunks,
            setup_wall_ms,
            first_wall_ms,
            settling_wall_ms,
            warm_wall_ms,
          });
          console.log(
            JSON.stringify({
              scope,
              round,
              variant,
              size: input.size,
              fixture: input.fixture,
              first_wall_ms,
              warm_mean_ms: warm_wall_ms.reduce((a, b) => a + b, 0) / warm_wall_ms.length,
            }),
          );
        } finally {
          await instance.dispose();
        }
      }
    }
  }
}
const summaries = [];
for (const scope of ['collector', 'full'])
  for (const variant of ['fetch', 'rpc']) {
    const matching = rows.filter((r) => r.scope === scope && r.variant === variant);
    const first = matching.map((r) => r.first_wall_ms).sort((a, b) => a - b),
      warm = matching.flatMap((r) => r.warm_wall_ms);
    summaries.push({
      scope,
      variant,
      fresh_instances: matching.length,
      first_median_ms: (first[first.length / 2 - 1] + first[first.length / 2]) / 2,
      first_min_ms: first[0],
      first_max_ms: first.at(-1),
      warm_mean_ms: warm.reduce((a, b) => a + b, 0) / warm.length,
      warm_min_ms: Math.min(...warm),
      warm_max_ms: Math.max(...warm),
      warm_requests: warm.length,
    });
  }
for (const source of sources)
  assert.equal(
    hash(await readFile(source.file)),
    source.sha256,
    'Source changed during measurement',
  );
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local host elapsed time, dispatch through complete response body. Equality checks outside timing. Fresh workerd per scope/variant/fixture/repetition after mf.ready; module/process/assets setup excluded and reported separately. No profiler attached. Two counterbalanced rounds, one first request, two settling, ten warm per instance. No remote CPU, account, AI or Kakao calls.',
  populations: {
    collector:
      'Prepared 72 real glyph frames and 10 PNGs served from an actual workerd RPC/HTTP stub; excludes preparation/assembly computation and asset reads.',
    full: 'Actual workerd renderer computes glyphs and PNGs from real local Static Assets; includes local bindings, asset reads and all worker stages.',
  },
  conditions: {
    sizes: [800, 720],
    page_slots: 64,
    pages_per_call: 6,
    compression: 'Z_RLE',
    painter: 'scalar',
    crc: 'JS baseline',
    fixtures: 5,
    binary_rpc: 'ArrayBuffer; same ATC/ATB formats, counts and validations',
  },
  verified_pngs: verification.rows.length + rows.length * 13,
  verified_computed_pngs:
    verification.rows.length + rows.filter((r) => r.scope === 'full').length * 13,
  verified_canned_png_responses: rows.filter((r) => r.scope === 'collector').length * 13,
  compiled_sha256: {
    probe: hash(probeScript),
    renderer: hash(fullScript),
    canned_renderer: hash(cannedScript),
  },
  rows,
  summaries,
  sources,
};
await writeFile(
  'docs/evidence/AI_PNG_RPC_LOCAL_2026-10-03.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ summaries, verified_pngs: report.verified_pngs }));
