import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const rows = [];
const mode = process.argv.includes('--pipeline')
  ? 'atlas_pipeline'
  : process.argv.includes('--chunks')
    ? 'atlas_chunks'
    : 'atlas';
for (const fixture of ['expression', 'comparison', 'long', 'long_comparison', 'coverage']) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:8793/probe/${fixture}/${mode}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer local-synthetic-token-not-for-deployment' },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const png = Buffer.from(await response.arrayBuffer());
  const baseline = await readFile(`.automation-png/${fixture}-atlas-full.png`);
  assert.ok(png.equals(baseline), `${fixture}: Node/workerd output differs`);
  assert.ok(png.length <= 1048576);
  await writeFile(`.automation-png/local-${fixture}-${mode}.png`, png);
  rows.push({
    fixture,
    status: response.status,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
    pages: Number(response.headers.get('X-Atlas-Pages')),
    chunks: response.headers.has('X-Atlas-Chunks')
      ? Number(response.headers.get('X-Atlas-Chunks'))
      : null,
    fetched_bytes: response.headers.has('X-Atlas-Bytes')
      ? Number(response.headers.get('X-Atlas-Bytes'))
      : null,
    wall_ms: performance.now() - started,
  });
}
assert.equal(
  (await fetch(`http://127.0.0.1:8793/probe/expression/${mode}`, { method: 'POST' })).status,
  401,
);
assert.equal((await fetch('http://127.0.0.1:8792/800-82-0.bin')).status, 404);
const report = {
  measured_at_utc: new Date().toISOString(),
  scope:
    'Local full atlas Static Assets binding + authenticated probe + private renderer. Not remote CPU or production deployment.',
  qualification: 'not_qualified',
  rows,
};
await writeFile(
  `.automation-png/${mode}-worker-report.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
