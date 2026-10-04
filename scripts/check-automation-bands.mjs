import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

// Publicly documented synthetic local-only credential. Never used remotely.
const origin = 'http://127.0.0.1:8793';
const headers = { Authorization: 'Bearer local-synthetic-token-not-for-deployment' };
const decoded = (png) => inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
const results = [];
for (const fixture of ['expression', 'comparison', 'long', 'long_comparison']) {
  for (const encoder of ['fast', 'bands']) {
    const response = await fetch(`${origin}/probe/${fixture}/${encoder}`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const png = Buffer.from(await response.arrayBuffer());
    assert(png.length <= 1048576);
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1080);
    assert(decoded(png).equals(decoded(await readFile(`.automation-png/${fixture}-fast.png`))));
    await writeFile(`.automation-png/${fixture}-${encoder}-workerd.png`, png);
    results.push({
      fixture,
      encoder,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  }
}
assert.equal((await fetch(`${origin}/probe/expression/bands`, { method: 'POST' })).status, 401);
const report = {
  measured_at_utc: new Date().toISOString(),
  scope: 'Local workerd service binding, not remote CPU',
  results,
};
await writeFile('.automation-png/bands-worker-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
