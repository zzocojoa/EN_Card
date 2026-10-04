import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';

const root = '.automation-png/';
const json = async (name) => JSON.parse(await readFile(root + name, 'utf8'));
const lines = async (name) =>
  (await readFile(root + name, 'utf8')).trim().split('\n').map(JSON.parse);
const local = await json('atlas-optimized-local.json');
const worker = await json('atlas-optimized-worker-report.json');
const responses = await json('remote-atlas_optimized-responses.json');
const ledger = await lines('remote-atlas_optimized-attempts.jsonl');
const traces = await lines('remote-atlas_optimized-invocations.jsonl');
assert.equal(responses.length, 10);
assert.equal(ledger.filter((r) => r.state === 'started').length, 10);
assert.equal(ledger.filter((r) => r.state === 'completed').length, 10);
assert.equal(ledger.filter((r) => r.state === 'unknown').length, 0);
const expected = new Map();
for (const r of worker.rows) {
  const remote = responses.filter(
    (p) => p.fixture === r.fixture && p.encoder === `atlas_optimized${r.size}`,
  );
  assert.equal(remote.length, 1);
  assert.equal(remote[0].status, 200);
  assert.equal(remote[0].sha256, r.sha256);
  assert.equal(remote[0].bytes, r.bytes);
  for (let i = 0; i < r.chunks; i++)
    expected.set(`/optimized/${r.size}/pipeline/glyphs/${r.fixture}/${i}`, {
      size: r.size,
      stage: 'glyphs',
    });
  expected.set(`/optimized/${r.size}/pipeline/assemble/${r.fixture}`, {
    size: r.size,
    stage: 'assembly',
  });
  expected.set(`/probe/${r.fixture}/atlas_optimized${r.size}`, {
    size: r.size,
    stage: 'collector',
  });
}
const begin = ledger[0].at;
const samples = traces.filter((t) => t.at >= begin && expected.has(t.path));
assert.equal(
  new Set(samples.map((r) => r.path)).size,
  samples.length,
  'Duplicate invocation sample',
);
const seen = new Set(samples.map((r) => r.path));
const missing = [...expected.keys()].filter((p) => !seen.has(p));
const cpu = [];
for (const size of [800, 720])
  for (const stage of ['glyphs', 'assembly', 'collector']) {
    const matching = samples.filter(
      (r) => expected.get(r.path).size === size && expected.get(r.path).stage === stage,
    );
    cpu.push({
      size,
      stage,
      expected: [...expected.values()].filter((r) => r.size === size && r.stage === stage).length,
      captured: matching.length,
      min_ms: Math.min(...matching.map((r) => r.cpu_ms)),
      max_ms: Math.max(...matching.map((r) => r.cpu_ms)),
      over_10ms: matching.filter((r) => r.cpu_ms > 10).length,
      samples: matching.map((r) => ({ path: r.path, cpu_ms: r.cpu_ms })),
    });
  }
const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length;
const localMeans = [...new Set(local.results.map((r) => r.variant))].map((variant) => {
  const cases = local.results.filter((r) => r.variant === variant);
  return {
    variant,
    preparation_wall_ms: mean(cases.map((r) => r.preparation_total.wall_ms)),
    assembly_wall_ms: mean(cases.map((r) => r.assembly.wall_ms)),
    read_reduction_min: Math.min(
      ...cases.map(
        (r) =>
          1 -
          r.fetched_bytes /
            local.results.find((b) => b.fixture === r.fixture && b.variant === 'baseline')
              .fetched_bytes,
      ),
    ),
    read_reduction_max: Math.max(
      ...cases.map(
        (r) =>
          1 -
          r.fetched_bytes /
            local.results.find((b) => b.fixture === r.fixture && b.variant === 'baseline')
              .fetched_bytes,
      ),
    ),
  };
});
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    '10 approved real Cloudflare Free PNG generations. HTTP success and exact local hash match are independent of CPU qualification. Missing traces are not successful samples. Local means are warm Node wall times, not remote CPU.',
  remote_png: responses.length,
  cumulative_remote_png: 66,
  expected_generation_invocations: expected.size,
  captured_generation_invocations: samples.length,
  excluded_pretrial_events: traces.length - samples.length,
  missing_invocations: missing,
  cpu,
  localMeans,
  collector_over_limit: samples.filter(
    (r) => expected.get(r.path).stage === 'collector' && r.cpu_ms > 10,
  ).length,
  all_captured_outcomes_ok: samples.every((r) => r.outcome === 'ok' && r.exceptions === 0),
  tail_diagnostics: await json('remote-atlas_optimized-tail-diagnostics.json'),
};
await writeFile(
  'docs/evidence/AI_PNG_OPTIMIZED_SUMMARY_2026-10-02.json',
  JSON.stringify(report, null, 2) + '\n',
);
for (const [from, to] of [
  ['atlas-optimized-build.json', 'BUILD.json'],
  ['atlas-optimized-local.json', 'LOCAL.json'],
  ['atlas-optimized-worker-report.json', 'WORKER.json'],
  ['remote-atlas_optimized-responses.json', 'RESPONSES.json'],
  ['remote-atlas_optimized-attempts.jsonl', 'ATTEMPTS.jsonl'],
  ['remote-atlas_optimized-invocations.jsonl', 'REMOTE.jsonl'],
  ['remote-atlas_optimized-tail-diagnostics.json', 'TAIL.json'],
])
  await copyFile(root + from, 'docs/evidence/AI_PNG_OPTIMIZED_2026-10-02_' + to);
console.log(
  JSON.stringify(
    {
      ...report,
      missing_invocations: missing.length,
      tail_diagnostics: undefined,
      cpu: cpu.map(({ samples, ...r }) => r),
    },
    null,
    2,
  ),
);
