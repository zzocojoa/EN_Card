// N3 only: single-glyph vs 4/8-slot zlib blocks; JSON/fetch retained. Never deploys.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const smokeOnly = process.argv.includes('--smoke');
const token = 'local-synthetic-token-not-for-deployment';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [
  'atlas-blocks.ts',
  'atlas-block-build.ts',
  'atlas-block-runtime.ts',
  'atlas-block-worker.ts',
  'atlas-block-probe.ts',
  'atlas-block-micro.ts',
  'prepare-block-pages.ts',
  'block-inputs.ts',
  'atlas-chunks.ts',
  'atlas-pipeline.ts',
  'atlas.ts',
  'atlas-pages.ts',
  'atlas-lean-runtime.ts',
  'atlas-optimized-runtime.ts',
  'atlas-lean-worker.ts',
  'atlas-lean-probe.ts',
  'fixtures.ts',
  'probe.ts',
  'research-blocks-workerd.mjs',
].map((name) => 'experiments/automation-png/' + name);
sourceFiles.push(
  'scripts/prepare-automation-blocks.mjs',
  'src/worker/png.ts',
  'src/web/canvas.ts',
  'src/shared/model.ts',
);
const sources = [];
for (const file of sourceFiles) sources.push({ file, sha256: hash(await readFile(file)) });
await build({
  entryPoints: ['experiments/automation-png/block-inputs.ts'],
  outfile: '.automation-png/block-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { inputs, microInputs, variants, assetRoot } =
  await import('../../.automation-png/block-inputs.mjs');
assert.equal(inputs.length, 10);
assert.equal(microInputs.length, 6);
assert.equal(
  inputs.reduce((sum, input) => sum + input.chunks, 0),
  72,
);
async function compile(entry) {
  return (
    await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'neutral',
      format: 'esm',
      external: ['node:*', 'cloudflare:workers'],
      mainFields: ['module', 'main'],
      loader: { '.bin': 'binary', '.data': 'text' },
    })
  ).outputFiles[0].text;
}
const scripts = {};
const microScript = await compile('experiments/automation-png/atlas-block-micro.ts');
for (const [variant, name] of [
  ['single', 'lean'],
  ['b4', 'block'],
  ['b8', 'block'],
])
  scripts[variant] = {
    probe: await compile(`experiments/automation-png/atlas-${name}-probe.ts`),
    renderer: await compile(`experiments/automation-png/atlas-${name}-worker.ts`),
  };
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
          script: scripts[variant].probe,
          compatibilityDate: '2026-09-01',
          bindings: { BENCH_TOKEN: token, BLOCK_SIZE: variant === 'b4' ? '4' : '8' },
          serviceBindings: { RENDERER: 'renderer' },
        },
        {
          name: 'renderer',
          modules: true,
          script: scripts[variant].renderer,
          bindings: { BLOCK_SIZE: variant === 'b4' ? '4' : '8' },
          compatibilityDate: '2026-09-01',
          assets: {
            directory: assetRoot(variant),
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
const prefix = (variant) => (variant === 'single' ? 'lean' : 'blocks');
let verifiedPngs = 0,
  verifiedFrames = 0;
let verifiedMicroFrames = 0;
function microLocal(variant, input) {
  return new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      cf: false,
      telemetry: { enabled: false },
      modules: true,
      script: microScript,
      compatibilityDate: '2026-09-01',
      bindings: { MODE: variant, KEYS: JSON.stringify(input.keys) },
    }),
  );
}
async function microRun(instance, variant, input) {
  const start = performance.now();
  const response = await instance.dispatchFetch('http://localhost/', {
    method: 'POST',
    body: input.variants[variant].page,
  });
  const bytes = new Uint8Array(await response.arrayBuffer()),
    elapsed = performance.now() - start;
  assert.equal(response.status, 200);
  assert.ok(Buffer.from(bytes).equals(input.variants.single.frame));
  verifiedMicroFrames++;
  return elapsed;
}
async function run(instance, renderer, scope, variant, input) {
  const expected = input.variants[variant],
    actual = [];
  const start = performance.now();
  if (scope === 'preparation') {
    // One sample is all preparation requests for one card, sequentially. It is
    // NOT a single worker invocation and cannot be compared to Free CPU 10ms.
    for (let index = 0; index < input.chunks; index++) {
      const response = await renderer.fetch(
        `http://localhost/${prefix(variant)}/${input.size}/pipeline/glyphs/${input.fixture}/${index}`,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      actual.push({ status: response.status, bytes });
    }
  } else {
    const response = await instance.dispatchFetch(
      `http://localhost/probe/${input.fixture}/atlas_${prefix(variant)}${input.size}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );
    actual.push({
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
      type: response.headers.get('Content-Type'),
    });
  }
  const elapsed = performance.now() - start;
  for (const [index, result] of actual.entries()) {
    assert.equal(result.status, 200, `${scope}/${variant}/${input.size}/${input.fixture}/${index}`);
    assert.ok(
      Buffer.from(result.bytes).equals(
        scope === 'preparation' ? Buffer.from(expected.frames[index]) : input.png,
      ),
    );
    if (scope === 'preparation') verifiedFrames++;
    else {
      assert.equal(result.type, 'image/png');
      verifiedPngs++;
    }
  }
  return elapsed;
}
const verification = {
  measured_at_utc: new Date().toISOString(),
  scope: 'Actual local workerd fetch/Static Assets, no remote calls',
  rows: [],
  rejected: [],
};
for (const variant of variants) {
  const instance = local(variant);
  try {
    await instance.ready;
    const renderer = await instance.getWorker('renderer');
    for (const input of inputs) {
      for (const scope of ['preparation', 'full'])
        await run(instance, renderer, scope, variant, input);
      verification.rows.push({
        variant,
        size: input.size,
        fixture: input.fixture,
        chunks: input.chunks,
        png_sha256: hash(input.png),
        bundle_bytes: input.variants[variant].bundle.length,
        stats: input.variants[variant].stats,
      });
    }
    const input = inputs[0];
    for (const [name, body] of [
      ['invalid_header', new Uint8Array(16)],
      ['truncated', input.variants[variant].bundle.subarray(0, -1)],
      ['over_limit', new Uint8Array(4 * 1048576 + 1)],
    ]) {
      const response = await renderer.fetch(
        `http://localhost/${prefix(variant)}/800/pipeline/assemble/expression`,
        { method: 'POST', body },
      );
      assert.equal(response.status, 400);
      await response.arrayBuffer();
      verification.rejected.push(variant + ':' + name);
    }
    for (const [path, method, authorized, status] of [
      [`/probe/expression/atlas_${prefix(variant)}800`, 'POST', false, 401],
      [`/probe/expression/atlas_${prefix(variant)}800`, 'GET', true, 405],
      [`/probe/expression/atlas_${prefix(variant)}800?url=https://other.test`, 'POST', true, 404],
      [`/probe/constructor/atlas_${prefix(variant)}800`, 'POST', true, 404],
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
verification.verified_frames = verifiedFrames;
verification.micro_workloads = [];
for (const input of microInputs)
  for (const variant of variants) {
    const instance = microLocal(variant, input);
    try {
      await instance.ready;
      await microRun(instance, variant, input);
      verification.micro_workloads.push({
        variant,
        size: input.size,
        fixture: input.fixture,
        stats: input.variants[variant].stats,
      });
      // Check actual workerd inflate failures, not only the Node unit-test runtime.
      const page = input.variants[variant].page,
        bad = page.slice(),
        view = new DataView(bad.buffer);
      const table = variant === 'single' ? 16 : 24 + 64 * 32;
      const start = view.getUint32(table + (variant === 'single' ? 16 : 0)),
        length = view.getUint32(table + (variant === 'single' ? 20 : 4));
      bad[start + length - 1] ^= 255;
      const corrupt = await instance.dispatchFetch('http://localhost/', {
        method: 'POST',
        body: bad,
      });
      assert.equal(corrupt.status, 400);
      await corrupt.arrayBuffer();
      verification.rejected.push(`${variant}:${input.size}:${input.fixture}:checksum`);
      if (variant !== 'single') {
        const limited = page.slice(),
          v = new DataView(limited.buffer);
        v.setUint32(table + 8, v.getUint32(table + 8) - 1);
        const bounded = await instance.dispatchFetch('http://localhost/', {
          method: 'POST',
          body: limited,
        });
        assert.equal(bounded.status, 400);
        await bounded.arrayBuffer();
        verification.rejected.push(`${variant}:${input.size}:${input.fixture}:inflate_limit`);
      }
    } finally {
      await instance.dispose();
    }
  }
verification.verified_micro_frames = verifiedMicroFrames;
await writeFile(
  'docs/evidence/AI_PNG_BLOCK_WORKER_2026-10-03.json',
  JSON.stringify(verification, null, 2) + '\n',
);
console.log(
  `Local block verification: ${verifiedPngs} exact PNGs, ${verifiedFrames} exact frames, ${verification.rejected.length} rejections.`,
);
if (smokeOnly) process.exit(0);
const rows = [];
for (const scope of ['preparation', 'full'])
  for (let round = 0; round < 3; round++) {
    for (const input of round % 2 ? [...inputs].reverse() : inputs) {
      const offset = (round + inputs.indexOf(input)) % 3;
      const order = [...variants.slice(offset), ...variants.slice(0, offset)];
      for (const variant of order) {
        const start = performance.now(),
          instance = local(variant);
        try {
          await instance.ready;
          const renderer = await instance.getWorker('renderer');
          const setup_wall_ms = performance.now() - start;
          const first_wall_ms = await run(instance, renderer, scope, variant, input),
            settling_wall_ms = [],
            warm_wall_ms = [];
          for (let i = 0; i < 2; i++)
            settling_wall_ms.push(await run(instance, renderer, scope, variant, input));
          for (let i = 0; i < 10; i++)
            warm_wall_ms.push(await run(instance, renderer, scope, variant, input));
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
const microRows = [];
for (let round = 0; round < 3; round++)
  for (const input of round % 2 ? [...microInputs].reverse() : microInputs) {
    const offset = (round + microInputs.indexOf(input)) % 3,
      order = [...variants.slice(offset), ...variants.slice(0, offset)];
    for (const variant of order) {
      const start = performance.now(),
        instance = microLocal(variant, input);
      try {
        await instance.ready;
        const setup_wall_ms = performance.now() - start;
        const first_wall_ms = await microRun(instance, variant, input),
          settling_wall_ms = [],
          warm_wall_ms = [];
        for (let i = 0; i < 2; i++) settling_wall_ms.push(await microRun(instance, variant, input));
        for (let i = 0; i < 10; i++) warm_wall_ms.push(await microRun(instance, variant, input));
        microRows.push({
          round,
          variant,
          size: input.size,
          fixture: input.fixture,
          setup_wall_ms,
          first_wall_ms,
          settling_wall_ms,
          warm_wall_ms,
        });
        console.log(
          JSON.stringify({
            scope: 'page_decode',
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
const microSummaries = [];
for (const fixture of ['single', 'dense', 'sparse'])
  for (const variant of variants) {
    const matching = microRows.filter((r) => r.fixture === fixture && r.variant === variant),
      first = matching.map((r) => r.first_wall_ms).sort((a, b) => a - b),
      warm = matching.flatMap((r) => r.warm_wall_ms);
    microSummaries.push({
      fixture,
      variant,
      fresh_instances: matching.length,
      first_median_ms: (first[2] + first[3]) / 2,
      first_min_ms: first[0],
      first_max_ms: first.at(-1),
      warm_mean_ms: warm.reduce((a, b) => a + b, 0) / warm.length,
      warm_samples: warm.length,
    });
  }
const summaries = [];
for (const scope of ['preparation', 'full'])
  for (const variant of variants) {
    const matching = rows.filter((r) => r.scope === scope && r.variant === variant),
      first = matching.map((r) => r.first_wall_ms).sort((a, b) => a - b),
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
      warm_samples: warm.length,
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
    'Local host elapsed time through complete response body; byte equality outside timing; mf.ready and getWorker excluded and reported as setup. No profiler, remote CPU, account, AI or Kakao calls. Three cyclic-position-balanced rounds; one first, two settling, ten warm samples per fresh scope/variant/fixture instance.',
  populations: {
    page_decode:
      'One actual workerd HTTP request carrying a prepared full Hangul page; single/dense/sparse requested keys; includes body reads, decoding, ATC1 packing and response. No asset fetch. Not isolated CPU time.',
    preparation:
      'All sequential preparation HTTP requests per card, actual local Static Assets; includes host-worker boundary for each request.',
    full: 'Authenticated collector through actual fetch Service Binding, local Static Assets, assembly and complete PNG body.',
  },
  conditions: {
    sizes: [800, 720],
    page_slots: 64,
    pages_per_call: 6,
    compression: 'Z_RLE',
    painter: 'scalar',
    crc: 'JS baseline',
    transport: 'fetch',
    fixtures: 5,
    metadata: 'Unchanged ATC1 JSON and ATB1; no binary metadata or RPC',
    atlas_compression: 'ATG1 single glyph vs ATG2 4-slot/8-slot blocks',
  },
  verified_computed_pngs: verifiedPngs,
  verified_preparation_frames: verifiedFrames,
  verified_micro_frames: verifiedMicroFrames,
  micro_compiled_sha256: hash(microScript),
  micro_rows: microRows,
  micro_summaries: microSummaries,
  compiled_sha256: Object.fromEntries(
    Object.entries(scripts).map(([variant, entries]) => [
      variant,
      Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, hash(value)])),
    ]),
  ),
  rows,
  summaries,
  sources,
};
await writeFile(
  'docs/evidence/AI_PNG_BLOCK_LOCAL_2026-10-03.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ summaries, verifiedPngs, verifiedFrames }));
