// Independently recalculate the recorded comparison; never runs a benchmark.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const variants = ['copy_scalar', 'ref_scalar', 'copy_native', 'ref_native'];
const scopes = ['assembly', 'full'];
const average = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const expectedSources = [
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
  'src/web/canvas.ts',
  'src/shared/model.ts',
  'package-lock.json',
].sort();
const requiredAssets = [
  '.automation-png/atlas-optimized/800/metrics.data',
  '.automation-png/atlas-optimized/800/common.bin',
  '.automation-png/atlas-optimized/720/common.bin',
];
// This verifier targets the frozen five-fixture/two-size experiment, not an
// arbitrary manifest: 244 distinct page assets plus metrics and two commons.
const expectedAssetCount = 247;
const digest = (value) =>
  assert.ok(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Invalid SHA-256');
export function validateReferenceManifest(evidence) {
  assert.ok(evidence && typeof evidence === 'object' && !Array.isArray(evidence));
  assert.ok(Array.isArray(evidence.sources), 'Missing source manifest');
  assert.deepEqual(evidence.sources.map((entry) => entry.file).sort(), expectedSources);
  for (const entry of evidence.sources) digest(entry.sha256);
  assert.ok(
    evidence.assets && typeof evidence.assets === 'object' && !Array.isArray(evidence.assets),
    'Missing asset manifest',
  );
  const files = Object.keys(evidence.assets);
  assert.equal(files.length, expectedAssetCount, 'Incomplete asset manifest');
  for (const file of requiredAssets)
    assert.ok(Object.hasOwn(evidence.assets, file), 'Missing embedded asset');
  for (const [file, sha256] of Object.entries(evidence.assets)) {
    assert.ok(
      requiredAssets.includes(file) ||
        /^\.automation-png\/atlas-optimized\/assets\/(800|720)\/\d+-\d+-\d+\.bin$/.test(file),
      'Unexpected asset path',
    );
    digest(sha256);
  }
  assert.ok(
    evidence.scriptHashes &&
      typeof evidence.scriptHashes === 'object' &&
      !Array.isArray(evidence.scriptHashes),
    'Missing script manifest',
  );
  assert.deepEqual(Object.keys(evidence.scriptHashes).sort(), [...variants].sort());
  for (const sha256 of Object.values(evidence.scriptHashes)) digest(sha256);
  digest(evidence.probe_sha256);
}
export async function verifyReferenceEvidence(result, smoke) {
  validateReferenceManifest(result);
  validateReferenceManifest(smoke);
  const unique = new Set();
  assert.equal(result.rows.length, 320);
  assert.equal(result.summaries.length, 8);
  assert.equal(result.pairs.length, 4);
  assert.equal(smoke.workloads.length, 10);
  assert.equal(new Set(smoke.workloads.map((input) => `${input.size}:${input.fixture}`)).size, 10);
  assert.equal(smoke.verified_pngs, 40);
  assert.equal(smoke.rejected.length, 32);
  assert.equal(new Set(smoke.rejected).size, 32);
  assert.equal(result.smoke_pngs, 40);
  assert.equal(result.computed_pngs, 40 + 320 * 13);
  for (const row of result.rows) {
    assert.ok(scopes.includes(row.scope) && variants.includes(row.variant));
    assert.ok(Number.isInteger(row.round) && row.round >= 0 && row.round < 4);
    assert.ok(Number.isInteger(row.position) && row.position >= 0 && row.position < 4);
    assert.ok(
      smoke.workloads.some((input) => input.size === row.size && input.fixture === row.fixture),
    );
    const key = [row.scope, row.variant, row.round, row.size, row.fixture].join(':');
    assert.ok(!unique.has(key));
    unique.add(key);
    assert.equal(row.warm_wall_ms.length, 10);
    assert.equal(row.settling_wall_ms.length, 2);
    for (const ms of [
      row.setup_wall_ms,
      row.first_wall_ms,
      ...row.settling_wall_ms,
      ...row.warm_wall_ms,
    ])
      assert.ok(Number.isFinite(ms) && ms > 0);
  }
  for (const scope of scopes)
    for (const variant of variants) {
      const rows = result.rows.filter((row) => row.scope === scope && row.variant === variant);
      assert.equal(rows.length, 40);
      for (const input of smoke.workloads) {
        const matching = rows.filter(
          (row) => row.size === input.size && row.fixture === input.fixture,
        );
        assert.equal(new Set(matching.map((row) => row.position)).size, 4);
        assert.equal(new Set(matching.map((row) => row.round)).size, 4);
      }
      const first = rows.map((row) => row.first_wall_ms).sort((a, b) => a - b);
      const warm = rows.flatMap((row) => row.warm_wall_ms);
      const entries = result.summaries.filter(
        (summary) => summary.scope === scope && summary.variant === variant,
      );
      assert.equal(entries.length, 1);
      const summary = entries[0];
      assert.equal(summary.fresh_instances, 40);
      assert.equal(summary.warm_samples, 400);
      close(summary.first_min_ms, first[0]);
      close(summary.first_max_ms, first.at(-1));
      close(summary.first_mean_ms, average(first));
      close(summary.first_median_ms, (first[19] + first[20]) / 2);
      close(summary.warm_mean_ms, average(warm));
    }
  for (const scope of scopes)
    for (const input of smoke.workloads)
      for (let round = 0; round < 4; round++) {
        const matching = result.rows.filter(
          (row) =>
            row.scope === scope &&
            row.size === input.size &&
            row.fixture === input.fixture &&
            row.round === round,
        );
        assert.equal(matching.length, 4);
        assert.equal(new Set(matching.map((row) => row.position)).size, 4);
      }
  for (const scope of scopes)
    for (const painter of ['scalar', 'native']) {
      let firstFaster = 0,
        warmFaster = 0;
      for (const candidate of result.rows.filter(
        (row) => row.scope === scope && row.variant === `ref_${painter}`,
      )) {
        const baseline = result.rows.find(
          (row) =>
            row.scope === scope &&
            row.variant === `copy_${painter}` &&
            row.round === candidate.round &&
            row.size === candidate.size &&
            row.fixture === candidate.fixture,
        );
        assert.ok(baseline);
        firstFaster += candidate.first_wall_ms < baseline.first_wall_ms ? 1 : 0;
        warmFaster += average(candidate.warm_wall_ms) < average(baseline.warm_wall_ms) ? 1 : 0;
      }
      const entries = result.pairs.filter(
        (pair) => pair.scope === scope && pair.painter === painter,
      );
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0], {
        scope,
        painter,
        pairs: 40,
        first_faster: firstFaster,
        warm_faster: warmFaster,
      });
    }
  assert.deepEqual(result.sources, smoke.sources);
  assert.deepEqual(result.assets, smoke.assets);
  assert.deepEqual(result.scriptHashes, smoke.scriptHashes);
  assert.equal(result.probe_sha256, smoke.probe_sha256);
  for (const { file, sha256 } of result.sources)
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      sha256,
      file,
    );
  for (const [file, sha256] of Object.entries(result.assets))
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      sha256,
      file,
    );
  return {
    result: 'passed',
    rows: 320,
    summaries: 8,
    pairs: 4,
    source_hashes: result.sources.length,
    asset_hashes: Object.keys(result.assets).length,
    computed_pngs: result.computed_pngs,
    rejected: smoke.rejected.length,
    eliminated_copy_bytes: {
      min: Math.min(...smoke.workloads.map((x) => x.eliminated_pixel_copy_bytes)),
      max: Math.max(...smoke.workloads.map((x) => x.eliminated_pixel_copy_bytes)),
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = 'docs/evidence/AI_PNG_REFERENCE_';
  const result = JSON.parse(await readFile(root + 'LOCAL_2026-10-03.json', 'utf8'));
  const smoke = JSON.parse(await readFile(root + 'WORKER_2026-10-03.json', 'utf8'));
  console.log(JSON.stringify(await verifyReferenceEvidence(result, smoke)));
}
