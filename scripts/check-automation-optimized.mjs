import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const auth = { Authorization: 'Bearer local-synthetic-token-not-for-deployment' };
const candidate = process.argv.includes('--lean') ? 'lean' : 'optimized';
const rows = [];
for (const size of [800, 720]) {
  for (const fixture of ['expression', 'comparison', 'long', 'long_comparison', 'coverage']) {
    const response = await fetch(
      `http://127.0.0.1:8793/probe/${fixture}/atlas_${candidate}${size}`,
      {
        method: 'POST',
        headers: auth,
        signal: AbortSignal.timeout(30000),
      },
    );
    assert.equal(response.status, 200, `${size}/${fixture}`);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const png = Buffer.from(await response.arrayBuffer());
    const baseline = await readFile(`.automation-png/optimized-combined${size}_64-${fixture}.png`);
    assert.ok(png.equals(baseline), `Node/workerd output differs: ${size}/${fixture}`);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.ok(png.length <= 1048576);
    const chunks = Number(response.headers.get('X-Atlas-Chunks'));
    assert.ok(chunks + 2 <= 32);
    rows.push({
      size,
      fixture,
      bytes: png.length,
      chunks,
      pages: Number(response.headers.get('X-Atlas-Pages')),
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  }
}
for (const size of [800, 720]) {
  const path = `/probe/expression/atlas_${candidate}${size}`;
  assert.equal((await fetch('http://127.0.0.1:8793' + path, { method: 'POST' })).status, 401);
  assert.equal((await fetch('http://127.0.0.1:8793' + path, { headers: auth })).status, 405);
  assert.equal(
    (
      await fetch('http://127.0.0.1:8793' + path + '?url=https://example.com', {
        method: 'POST',
        headers: auth,
      })
    ).status,
    404,
  );
  assert.equal((await fetch(`http://127.0.0.1:8792/${size}/FONT-LICENSE.txt`)).status, 404);
  assert.equal(
    (await fetch(`http://127.0.0.1:8792/${candidate}/${size}/pipeline/glyphs/expression/999`))
      .status,
    404,
  );
  assert.equal(
    (
      await fetch(`http://127.0.0.1:8792/${candidate}/${size}/pipeline/assemble/expression`, {
        method: 'POST',
        body: 'invalid',
      })
    ).status,
    400,
  );
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local workerd, real Static Assets and Service bindings. Synthetic secret. Not remote CPU or AI/Kakao integration.',
  rows,
};
await writeFile(
  `.automation-png/atlas-${candidate}-worker-report.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
