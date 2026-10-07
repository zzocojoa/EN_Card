// Local assembly-copy elimination experiment. Never deploys or calls providers.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const smokeOnly = process.argv.includes('--smoke');
const token = 'local-synthetic-token-not-for-deployment';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const variants = ['copy_scalar', 'ref_scalar', 'copy_native', 'ref_native'];
const compileOptions = {
  bundle: true,
  write: false,
  platform: 'neutral',
  format: 'esm',
  external: ['node:*'],
  mainFields: ['module', 'main'],
  loader: { '.bin': 'binary', '.data': 'text' },
};
const sources = [];
for (const file of [
  ...[
    'atlas.ts',
    'atlas-blit.ts',
    'atlas-reference.ts',
    'atlas-reference-worker.ts',
    'atlas-pipeline.ts',
    'atlas-chunks.ts',
    'atlas-pages.ts',
    'atlas-lean-runtime.ts',
    'atlas-optimized-runtime.ts',
    'atlas-lean-probe.ts',
    'fixtures.ts',
    'probe.ts',
    'reference-inputs.ts',
    'research-reference-workerd.mjs',
    'wrangler.atlas-reference.jsonc',
  ].map((name) => 'experiments/automation-png/' + name),
  'src/worker/png.ts',
  'src/shared/card-layout.ts',
  'src/shared/model.ts',
  'package-lock.json',
])
  sources.push({ file, sha256: hash(await readFile(file)) });
await build({
  entryPoints: ['experiments/automation-png/reference-inputs.ts'],
  outfile: '.automation-png/reference-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { inputs, assetRoot, assetHashes } =
  await import('../../.automation-png/reference-inputs.mjs');
assert.equal(inputs.length, 10);
const probe = (
  await build({
    ...compileOptions,
    entryPoints: ['experiments/automation-png/atlas-lean-probe.ts'],
  })
).outputFiles[0].text;
const scripts = {};
for (const variant of variants)
  scripts[variant] = (
    await build({
      ...compileOptions,
      entryPoints: ['experiments/automation-png/atlas-reference-worker.ts'],
      define: {
        REFERENCE_PIXELS: String(variant.startsWith('ref_')),
        PAINT_MODE: JSON.stringify(variant.endsWith('native') ? 'native' : 'scalar'),
      },
    })
  ).outputFiles[0].text;
const scriptHashes = Object.fromEntries(
  Object.entries(scripts).map(([name, source]) => [name, hash(source)]),
);
function local(variant) {
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
          script: probe,
          compatibilityDate: '2026-09-01',
          bindings: { BENCH_TOKEN: token },
          serviceBindings: { RENDERER: 'renderer' },
        },
        {
          name: 'renderer',
          modules: true,
          script: scripts[variant],
          compatibilityDate: '2026-09-01',
          assets: {
            directory: assetRoot,
            binding: 'ATLAS_ASSETS',
            run_worker_first: true,
            routerConfig: { has_user_worker: true },
            assetConfig: { html_handling: 'none', not_found_handling: 'none' },
          },
        },
      ],
    }),
  );
}
let verifiedPngs = 0;
async function run(instance, renderer, scope, input) {
  const start = performance.now();
  const response =
    scope === 'assembly'
      ? await renderer.fetch(
          `http://localhost/lean/${input.size}/pipeline/assemble/${input.fixture}`,
          { method: 'POST', body: input.bundle },
        )
      : await instance.dispatchFetch(
          `http://localhost/probe/${input.fixture}/atlas_lean${input.size}`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
        );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const elapsed = performance.now() - start;
  assert.equal(response.status, 200);
  assert.ok(Buffer.from(bytes).equals(input.png));
  verifiedPngs++;
  return elapsed;
}
const verification = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'local_workerd_only',
  source_manifest_version: 2,
  sources,
  scriptHashes,
  probe_sha256: hash(probe),
  assets: Object.fromEntries(assetHashes),
  workloads: inputs.map(({ bundle, png, ...input }) => ({
    ...input,
    bundle_bytes: bundle.length,
    bundle_sha256: hash(bundle),
    png_sha256: hash(png),
  })),
  rejected: [],
  verified_pngs: 0,
};
for (const variant of variants) {
  const instance = local(variant);
  try {
    await instance.ready;
    const renderer = await instance.getWorker('renderer');
    for (const input of inputs) await run(instance, renderer, 'full', input);
    const input = inputs[0],
      damaged = input.bundle.slice();
    damaged[damaged.length - 1] = 255;
    for (const [name, body] of [
      ['invalid_header', new Uint8Array(16)],
      ['truncated', input.bundle.subarray(0, -1)],
      ['over_limit', new Uint8Array(4 * 1048576 + 1)],
      ['bad_alpha', damaged],
    ]) {
      const response = await renderer.fetch(
        'http://localhost/lean/800/pipeline/assemble/expression',
        { method: 'POST', body },
      );
      assert.equal(response.status, 400);
      await response.arrayBuffer();
      verification.rejected.push(variant + ':' + name);
    }
    for (const [path, method, authorized, status] of [
      ['/probe/expression/atlas_lean800', 'POST', false, 401],
      ['/probe/expression/atlas_lean800', 'GET', true, 405],
      ['/probe/expression/atlas_lean800?url=https://other.test', 'POST', true, 404],
      ['/probe/constructor/atlas_lean800', 'POST', true, 404],
    ]) {
      const response = await instance.dispatchFetch('http://localhost' + path, {
        method,
        headers: authorized ? { Authorization: `Bearer ${token}` } : {},
      });
      assert.equal(response.status, status);
      await response.arrayBuffer();
      verification.rejected.push(`${variant}:${method} ${path} ${status}`);
    }
  } finally {
    await instance.dispose();
  }
}
verification.verified_pngs = verifiedPngs;
await writeFile(
  'docs/evidence/AI_PNG_REFERENCE_WORKER_2026-10-03.json',
  JSON.stringify(verification, null, 2) + '\n',
);
console.log(
  `Local reference smoke: ${verifiedPngs} exact PNGs; ${verification.rejected.length} rejections.`,
);
if (smokeOnly) process.exit(0);
const rows = [];
for (const scope of ['assembly', 'full'])
  for (let round = 0; round < 4; round++) {
    for (const input of round % 2 ? [...inputs].reverse() : inputs) {
      const offset = (round + inputs.indexOf(input)) % variants.length;
      const order = [...variants.slice(offset), ...variants.slice(0, offset)];
      for (const variant of order) {
        const start = performance.now(),
          instance = local(variant);
        try {
          await instance.ready;
          const renderer = await instance.getWorker('renderer');
          const setup_wall_ms = performance.now() - start;
          const first_wall_ms = await run(instance, renderer, scope, input);
          const settling_wall_ms = [],
            warm_wall_ms = [];
          for (let i = 0; i < 2; i++)
            settling_wall_ms.push(await run(instance, renderer, scope, input));
          for (let i = 0; i < 10; i++)
            warm_wall_ms.push(await run(instance, renderer, scope, input));
          rows.push({
            scope,
            round,
            variant,
            position: order.indexOf(variant),
            size: input.size,
            fixture: input.fixture,
            setup_wall_ms,
            first_wall_ms,
            settling_wall_ms,
            warm_wall_ms,
          });
        } finally {
          await instance.dispose();
        }
      }
      console.log(
        JSON.stringify({
          completed_instances: rows.length,
          expected: 320,
          scope,
          round,
          size: input.size,
          fixture: input.fixture,
        }),
      );
    }
  }
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const summaries = [];
for (const scope of ['assembly', 'full'])
  for (const variant of variants) {
    const matching = rows.filter((row) => row.scope === scope && row.variant === variant);
    const first = matching.map((row) => row.first_wall_ms).sort((a, b) => a - b);
    const warm = matching.flatMap((row) => row.warm_wall_ms);
    summaries.push({
      scope,
      variant,
      fresh_instances: matching.length,
      first_min_ms: first[0],
      first_max_ms: first.at(-1),
      first_mean_ms: average(first),
      first_median_ms: (first[first.length / 2 - 1] + first[first.length / 2]) / 2,
      warm_samples: warm.length,
      warm_mean_ms: average(warm),
    });
  }
const pairs = [];
for (const scope of ['assembly', 'full'])
  for (const painter of ['scalar', 'native']) {
    const matching = rows.filter((row) => row.scope === scope && row.variant === `ref_${painter}`);
    let first_faster = 0,
      warm_faster = 0;
    for (const candidate of matching) {
      const control = rows.find(
        (row) =>
          row.scope === scope &&
          row.variant === `copy_${painter}` &&
          row.round === candidate.round &&
          row.fixture === candidate.fixture &&
          row.size === candidate.size,
      );
      assert.ok(control);
      if (candidate.first_wall_ms < control.first_wall_ms) first_faster++;
      if (average(candidate.warm_wall_ms) < average(control.warm_wall_ms)) warm_faster++;
    }
    pairs.push({ scope, painter, pairs: matching.length, first_faster, warm_faster });
  }
// Evidence must describe exactly the sources/assets used throughout the run.
for (const source of sources) assert.equal(hash(await readFile(source.file)), source.sha256);
for (const [file, expected] of assetHashes) assert.equal(hash(await readFile(file)), expected);
const result = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'local_elapsed_not_cloudflare_cpu',
  source_manifest_version: 2,
  method:
    '4 cyclic position-balanced rounds x 10 inputs x 4 variants x 2 scopes = 320 fresh instances. Each first +2 settling +10 warm. Setup/common module initialization excluded and separately recorded. Assembly excludes preparation/collector; full includes real assets/preparation/collector/assembly. No profiler. Response read included; byte equality checks excluded from timer. Copy controls include the shared optional-source renderer branch. Native means extracted painter plus native CRC; compare within painter pairs. No remote calls or parallel benchmarks.',
  sources,
  scriptHashes,
  probe_sha256: hash(probe),
  assets: Object.fromEntries(assetHashes),
  computed_pngs: verifiedPngs,
  smoke_pngs: verification.verified_pngs,
  summaries,
  pairs,
  rows,
};
assert.equal(rows.length, 320);
assert.equal(verifiedPngs, 4200);
await writeFile(
  'docs/evidence/AI_PNG_REFERENCE_LOCAL_2026-10-03.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify({ summaries, pairs, computed_pngs: verifiedPngs }));
