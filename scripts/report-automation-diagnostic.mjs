import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';

const root = '.automation-png/';
const json = async (name) => JSON.parse(await readFile(root + name, 'utf8'));
const lines = async (name) =>
  (await readFile(root + name, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const manifest = await json('atlas-diagnostic-expected.json');
const responses = await json('remote-atlas_diagnostic-responses.json');
const ledger = await lines('remote-atlas_diagnostic-attempts.jsonl');
const traces = await lines('remote-atlas_diagnostic-invocations.jsonl');
assert.equal(responses.length, 84);
assert.equal(ledger[0].planned_png, 12);
assert.equal(ledger[0].planned_glyph, 72);
assert.equal(new Set(responses.map((r) => r.call)).size, 84);
for (const state of ['started', 'completed'])
  assert.equal(ledger.filter((r) => r.state === state).length, 84);
assert.equal(ledger.filter((r) => r.state === 'unknown').length, 0);
const key = (r) => JSON.stringify([r.call, r.script, r.path]);
const expected = new Map();
const add = (r, script, path, stage) => {
  const item = {
    call: r.call,
    script,
    path,
    stage,
    size: r.size,
    phase: r.kind === 'png' ? 'pipeline' : 'single_glyph',
  };
  assert.ok(!expected.has(key(item)));
  expected.set(key(item), item);
};
for (const r of responses) {
  assert.match(r.call, /^[a-f0-9]{32}$/);
  assert.match(r.isolate, /^[a-f0-9-]{36}$/);
  assert.ok(Number.isSafeInteger(r.ordinal) && r.ordinal > 0);
  const source = manifest.filter(
    (s) =>
      s.kind === r.kind &&
      s.size === r.size &&
      s.fixture === r.fixture &&
      (r.kind === 'png' || s.index === r.index),
  );
  assert.equal(source.length, 1);
  assert.equal(r.status, 200);
  assert.equal(r.sha256, source[0].sha256);
  assert.equal(r.bytes, source[0].bytes);
  for (const state of ['started', 'completed']) {
    const entry = ledger.filter((s) => s.state === state && s.call === r.call);
    assert.equal(entry.length, 1);
    for (const field of ['path', 'kind', 'fixture', 'size', 'iteration', 'index'])
      assert.equal(entry[0][field], r[field]);
    if (state === 'completed')
      for (const field of ['status', 'bytes', 'sha256', 'isolate', 'ordinal'])
        assert.equal(entry[0][field], r[field]);
  }
  if (r.kind === 'png') {
    assert.equal(r.path, `/probe/${r.fixture}/atlas_lean${r.size}`);
    for (const s of manifest.filter(
      (s) => s.kind === 'glyph' && s.size === r.size && s.fixture === r.fixture,
    ))
      add(
        r,
        'en-card-png-feasibility',
        `/lean/${r.size}/pipeline/glyphs/${r.fixture}/${s.index}`,
        'glyphs',
      );
    add(r, 'en-card-png-feasibility', `/lean/${r.size}/pipeline/assemble/${r.fixture}`, 'assembly');
    add(r, 'en-card-png-probe', r.path, 'collector');
  } else {
    assert.equal(r.path, `/diagnostic/glyphs/${r.size}/${r.fixture}/${r.index}`);
    add(
      r,
      'en-card-png-feasibility',
      `/lean/${r.size}/pipeline/glyphs/${r.fixture}/${r.index}`,
      'glyphs',
    );
    add(r, 'en-card-png-probe', r.path, 'diagnostic_entry');
  }
}
assert.equal(responses.filter((r) => r.kind === 'png').length, 12);
assert.equal(expected.size, 272);
const calls = new Set(responses.map((r) => r.call));
const unique = new Map();
let duplicates = 0;
for (const t of traces.filter((t) => calls.has(t.call))) {
  const id = key(t);
  assert.ok(expected.has(id), `Unexpected invocation: ${id}`);
  assert.ok(Number.isFinite(t.cpu_ms) && t.cpu_ms >= 0 && typeof t.version === 'string');
  if (unique.has(id)) {
    for (const field of ['at', 'version', 'cpu_ms', 'wall_ms', 'outcome', 'exceptions'])
      assert.equal(t[field], unique.get(id)[field], `Conflicting duplicate ${field}`);
    duplicates++;
  } else unique.set(id, { ...t, ...expected.get(id) });
}
const samples = [...unique.values()];
for (const script of ['en-card-png-feasibility', 'en-card-png-probe'])
  assert.ok(
    new Set(samples.filter((r) => r.script === script).map((r) => r.version)).size <= 1,
    'Mixed deployed versions',
  );
const stats = (rows) => ({
  captured: rows.length,
  min_ms: rows.length ? Math.min(...rows.map((r) => r.cpu_ms)) : null,
  max_ms: rows.length ? Math.max(...rows.map((r) => r.cpu_ms)) : null,
  over_10ms: rows.filter((r) => r.cpu_ms > 10).length,
});
const cpu = [];
for (const phase of ['pipeline', 'single_glyph'])
  for (const size of [800, 720])
    for (const stage of phase === 'pipeline'
      ? ['glyphs', 'assembly', 'collector']
      : ['glyphs', 'diagnostic_entry']) {
      const matches = (r) => r.phase === phase && r.size === size && r.stage === stage;
      cpu.push({
        phase,
        size,
        stage,
        expected: [...expected.values()].filter(matches).length,
        ...stats(samples.filter(matches)),
      });
    }
const assembly = responses
  .filter((r) => r.kind === 'png')
  .map((r) => ({
    ...r,
    cpu_ms:
      unique.get(
        key({
          ...r,
          script: 'en-card-png-feasibility',
          path: `/lean/${r.size}/pipeline/assemble/${r.fixture}`,
        }),
      )?.cpu_ms ?? null,
  }));
const assembly_groups = [true, false].map((first) => ({
  first_assembly_in_isolate: first,
  ...stats(assembly.filter((r) => (r.ordinal === 1) === first && r.cpu_ms !== null)),
}));
const missing = [...expected].filter(([id]) => !unique.has(id)).map(([, value]) => value);
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: samples.some((r) => r.cpu_ms > 10 || r.outcome !== 'ok' || r.exceptions)
    ? 'not_qualified'
    : missing.length
      ? 'incomplete'
      : 'observed_samples_within_limit_only',
  scope:
    'Instrumented remote diagnostics, including UUID/counters/headers/auth overhead. One unfiltered tail per Worker. Correlated by random call ID, script and exact path. Assembly ordinal 1 is first assembly in that isolate, not necessarily its first request; earlier glyph calls can warm code. Missing CPU is never a pass. Single-glyph probes and full pipeline are reported separately.',
  remote_png: 12,
  cumulative_remote_png: 88,
  single_glyph_probes: 72,
  expected_invocations: expected.size,
  captured_invocations: samples.length,
  duplicated_events: duplicates,
  excluded_events: traces.filter((r) => !calls.has(r.call)).length,
  missing_invocations: missing,
  versions: [...new Set(samples.map((r) => r.version))],
  all_captured_outcomes_ok: samples.every((r) => r.outcome === 'ok' && r.exceptions === 0),
  provider_truncated_events: samples.filter((r) => r.provider_truncated).length,
  cpu,
  assembly_groups,
  assembly,
  tail_diagnostics: await json('remote-atlas_diagnostic-tail-diagnostics.json'),
};
await writeFile(
  'docs/evidence/AI_PNG_DIAGNOSTIC_SUMMARY_2026-10-03.json',
  JSON.stringify(report, null, 2) + '\n',
);
for (const [from, to] of [
  ['atlas-diagnostic-worker-report.json', 'WORKER.json'],
  ['atlas-diagnostic-expected.json', 'EXPECTED.json'],
  ['remote-atlas_diagnostic-responses.json', 'RESPONSES.json'],
  ['remote-atlas_diagnostic-attempts.jsonl', 'ATTEMPTS.jsonl'],
  ['remote-atlas_diagnostic-invocations.jsonl', 'REMOTE.jsonl'],
  ['remote-atlas_diagnostic-tail-diagnostics.json', 'TAIL.json'],
])
  await copyFile(root + from, 'docs/evidence/AI_PNG_DIAGNOSTIC_2026-10-03_' + to);
console.log(
  JSON.stringify(
    {
      ...report,
      missing_invocations: missing.length,
      assembly: undefined,
      tail_diagnostics: undefined,
    },
    null,
    2,
  ),
);
