// N2 only: ATC JSON vs fixed binary records, both over fetch. Never deploys.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const smokeOnly = process.argv.includes('--smoke');
const token = 'local-synthetic-token-not-for-deployment';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [
  'atlas-binary.ts',
  'atlas-binary-runtime.ts',
  'atlas-binary-worker.ts',
  'atlas-binary-probe.ts',
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
  'research-binary-workerd.mjs',
].map((name) => 'experiments/automation-png/' + name);
sourceFiles.push('src/worker/png.ts', 'src/web/canvas.ts', 'src/shared/model.ts');
const sources = [];
for (const file of sourceFiles) sources.push({ file, sha256: hash(await readFile(file)) });
// Build both inputs from the same decoded pages. Equality to an older preserved
// PNG guards against a shared encoder/decoder bug changing the visible result.
await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
    import { readFile } from 'node:fs/promises';
    import { atlasAdvance, decodeCommonAtlas } from './experiments/automation-png/atlas-pages';
    import { pipelinePlan, packAtlasBundle, assembleAtlasBundle } from './experiments/automation-png/atlas-pipeline';
    import { loadAtlasChunk, jsonAtlasChunkCodec } from './experiments/automation-png/atlas-chunks';
    import { binaryAtlasChunkCodec } from './experiments/automation-png/atlas-binary';
    import { fixtures, atlasCoverageCard } from './experiments/automation-png/fixtures';
    const advance = atlasAdvance(JSON.parse(await readFile('.automation-png/atlas-metrics.json','utf8')));
    export const inputs = [];
    for (const size of [800,720]) {
      const root = '.automation-png/atlas-optimized/' + size;
      const runtime = { advance, common: decodeCommonAtlas(await readFile(root + '/common.bin')),
        options: { size, slots:64, chunkSize:6, compactRead:true, rle:true } };
      for (const [fixture, card] of Object.entries({...fixtures,coverage:atlasCoverageCard})) {
        const plan = pipelinePlan(card,runtime), atlases = [];
        for (const chunk of plan.chunks) atlases.push(await loadAtlasChunk(chunk,name => readFile(root + '/64/' + name),64));
        const variants = {};
        for (const [variant,codec] of [['json',jsonAtlasChunkCodec],['binary',binaryAtlasChunkCodec]]) {
          const frames = atlases.map((atlas,index) => codec.pack(atlas,index,atlases.length));
          const bundle = packAtlasBundle(frames,codec);
          variants[variant] = { frames,bundle,png:assembleAtlasBundle(card,{...runtime,options:{...runtime.options,chunkCodec:codec}},bundle) };
        }
        inputs.push({size,fixture,chunks:plan.chunks.length,variants});
      }
    }
  `,
  },
  outfile: '.automation-png/binary-inputs.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { inputs } = await import('../../.automation-png/binary-inputs.mjs');
assert.equal(inputs.length, 10);
assert.equal(
  inputs.reduce((sum, input) => sum + input.chunks, 0),
  72,
);
for (const input of inputs) {
  input.png = await readFile(
    `.automation-png/optimized-combined${input.size}_64-${input.fixture}.png`,
  );
  for (const v of Object.values(input.variants)) assert.ok(Buffer.from(v.png).equals(input.png));
}
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
for (const [variant, name] of [
  ['json', 'lean'],
  ['binary', 'binary'],
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
          bindings: { BENCH_TOKEN: token },
          serviceBindings: { RENDERER: 'renderer' },
        },
        {
          name: 'renderer',
          modules: true,
          script: scripts[variant].renderer,
          compatibilityDate: '2026-09-01',
          assets: {
            directory: '.automation-png/atlas-optimized/assets',
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
const prefix = (variant) => (variant === 'json' ? 'lean' : 'binary');
let verifiedPngs = 0,
  verifiedFrames = 0;
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
    const response =
      scope === 'assembly'
        ? await renderer.fetch(
            `http://localhost/${prefix(variant)}/${input.size}/pipeline/assemble/${input.fixture}`,
            { method: 'POST', body: expected.bundle },
          )
        : await instance.dispatchFetch(
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
for (const variant of ['json', 'binary']) {
  const instance = local(variant);
  try {
    await instance.ready;
    const renderer = await instance.getWorker('renderer');
    for (const input of inputs) {
      for (const scope of ['preparation', 'assembly', 'full'])
        await run(instance, renderer, scope, variant, input);
      verification.rows.push({
        variant,
        size: input.size,
        fixture: input.fixture,
        chunks: input.chunks,
        png_sha256: hash(input.png),
        bundle_bytes: input.variants[variant].bundle.length,
        metadata_bytes: input.variants[variant].frames.reduce(
          (sum, frame) =>
            sum + new DataView(frame.buffer, frame.byteOffset, frame.length).getUint32(4),
          0,
        ),
      });
    }
    const input = inputs[0];
    for (const [name, body] of [
      ['wrong_codec', input.variants[variant === 'json' ? 'binary' : 'json'].bundle],
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
await writeFile(
  'docs/evidence/AI_PNG_BINARY_WORKER_2026-10-03.json',
  JSON.stringify(verification, null, 2) + '\n',
);
console.log(
  `Local binary verification: ${verifiedPngs} exact PNGs, ${verifiedFrames} exact frames, ${verification.rejected.length} rejections.`,
);
if (smokeOnly) process.exit(0);
const rows = [];
for (const scope of ['preparation', 'assembly', 'full'])
  for (let round = 0; round < 2; round++) {
    for (const input of round ? [...inputs].reverse() : inputs) {
      const variants =
        (round + inputs.indexOf(input)) % 2 ? ['binary', 'json'] : ['json', 'binary'];
      for (const variant of variants) {
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
const summaries = [];
for (const scope of ['preparation', 'assembly', 'full'])
  for (const variant of ['json', 'binary']) {
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
    'Local host elapsed time through complete response body; byte equality outside timing; mf.ready and getWorker excluded and reported as setup. No profiler, remote CPU, account, AI or Kakao calls. Two counterbalanced rounds; one first, two settling, ten warm samples per fresh scope/variant/fixture instance.',
  populations: {
    preparation:
      'All sequential preparation HTTP requests per card, actual local Static Assets; includes host-worker boundary for each request.',
    assembly:
      'Single actual assembly HTTP request with prepared bundle; includes host-worker boundary and PNG validation.',
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
    metadata: 'ATC1 JSON vs ATC2 32-byte records; no RPC',
  },
  verified_computed_pngs: verifiedPngs,
  verified_preparation_frames: verifiedFrames,
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
  'docs/evidence/AI_PNG_BINARY_LOCAL_2026-10-03.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ summaries, verifiedPngs, verifiedFrames }));
