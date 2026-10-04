import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';

const root = '.automation-png/';
const json = async (name) => JSON.parse(await readFile(root + name, 'utf8'));
const lines = async (name) =>
  (await readFile(root + name, 'utf8')).trim().split('\n').map(JSON.parse);
const worker = await json('atlas-lean-worker-report.json');
const responses = await json('remote-atlas_lean-responses.json');
const ledger = await lines('remote-atlas_lean-attempts.jsonl');
const traces = await lines('remote-atlas_lean-invocations.jsonl');
assert.equal(responses.length, 10);
assert.equal(ledger[0].planned_attempts, 10);
for (const state of ['started', 'completed'])
  assert.equal(ledger.filter((r) => r.state === state).length, 10);
assert.equal(ledger.filter((r) => r.state === 'unknown').length, 0);
const expected = new Map();
for (const r of worker.rows) {
  const remote = responses.filter(
    (p) => p.fixture === r.fixture && p.encoder === `atlas_lean${r.size}`,
  );
  assert.equal(remote.length, 1);
  assert.equal(remote[0].status, 200);
  assert.equal(remote[0].sha256, r.sha256);
  assert.equal(remote[0].bytes, r.bytes);
  for (let i = 0; i < r.chunks; i++)
    expected.set(`/lean/${r.size}/pipeline/glyphs/${r.fixture}/${i}`, {
      size: r.size,
      stage: 'glyphs',
      script: 'en-card-png-feasibility',
    });
  expected.set(`/lean/${r.size}/pipeline/assemble/${r.fixture}`, {
    size: r.size,
    stage: 'assembly',
    script: 'en-card-png-feasibility',
  });
  expected.set(`/probe/${r.fixture}/atlas_lean${r.size}`, {
    size: r.size,
    stage: 'collector',
    script: 'en-card-png-probe',
  });
}
const begin = ledger[0].at;
const filtered = traces.filter(
  (t) => t.at >= begin && expected.has(t.path) && t.script === expected.get(t.path).script,
);
const unique = new Map();
for (const t of filtered) {
  assert.ok(Number.isFinite(t.cpu_ms) && t.cpu_ms >= 0 && typeof t.version === 'string');
  const key = JSON.stringify([t.script, t.version, t.at, t.path]);
  const prior = unique.get(key);
  if (prior) {
    for (const field of ['cpu_ms', 'wall_ms', 'outcome', 'exceptions'])
      assert.equal(t[field], prior[field], `Conflicting duplicate ${field}`);
    assert.ok(!prior.channels.includes(t.channel), 'Same channel emitted duplicate invocation');
    prior.channels.push(t.channel);
  } else unique.set(key, { ...t, channels: [t.channel] });
}
const samples = [...unique.values()];
assert.equal(
  new Set(samples.map((r) => r.path)).size,
  samples.length,
  'Unexpected repeated generation path',
);
for (const script of ['en-card-png-feasibility', 'en-card-png-probe'])
  assert.ok(
    new Set(samples.filter((r) => r.script === script).map((r) => r.version)).size <= 1,
    'Mixed deployed versions',
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
      min_ms: matching.length ? Math.min(...matching.map((r) => r.cpu_ms)) : null,
      max_ms: matching.length ? Math.max(...matching.map((r) => r.cpu_ms)) : null,
      over_10ms: matching.filter((r) => r.cpu_ms > 10).length,
      samples: matching.map((r) => ({ path: r.path, cpu_ms: r.cpu_ms, channels: r.channels })),
    });
  }
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    '10 approved Cloudflare Free PNG generations; current trial only. Full renderer and server-filtered POST tails deduplicated by script/version/timestamp/path with identical CPU/outcome checks. Missing events are not passes. Local data are not remote CPU.',
  remote_png: responses.length,
  cumulative_remote_png: 76,
  expected_generation_invocations: expected.size,
  captured_generation_invocations: samples.length,
  captured_channel_events: filtered.length,
  deduplicated_events: filtered.length - samples.length,
  excluded_events: traces.length - filtered.length,
  missing_invocations: missing,
  versions: [...new Set(samples.map((r) => r.version))],
  cpu,
  assembly_channel_counts: Object.fromEntries(
    ['en-card-png-feasibility', 'en-card-png-feasibility-POST'].map((channel) => [
      channel,
      filtered.filter((r) => r.channel === channel && expected.get(r.path).stage === 'assembly')
        .length,
    ]),
  ),
  all_captured_outcomes_ok: samples.every((r) => r.outcome === 'ok' && r.exceptions === 0),
  tail_diagnostics: await json('remote-atlas_lean-tail-diagnostics.json'),
};
await writeFile(
  'docs/evidence/AI_PNG_LEAN_SUMMARY_2026-10-03.json',
  JSON.stringify(report, null, 2) + '\n',
);
for (const [from, to] of [
  ['atlas-lean-worker-report.json', 'WORKER.json'],
  ['remote-atlas_lean-responses.json', 'RESPONSES.json'],
  ['remote-atlas_lean-attempts.jsonl', 'ATTEMPTS.jsonl'],
  ['remote-atlas_lean-invocations.jsonl', 'REMOTE.jsonl'],
  ['remote-atlas_lean-tail-diagnostics.json', 'TAIL.json'],
])
  await copyFile(root + from, 'docs/evidence/AI_PNG_LEAN_2026-10-03_' + to);
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
