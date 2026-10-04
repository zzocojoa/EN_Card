import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Deliberately fixed to the local, isolated feasibility Worker.
const origin = 'http://127.0.0.1:8792';
const results = [];
for (const fixture of ['expression', 'comparison', 'long', 'long_comparison']) {
  for (const encoder of ['wasm', 'native']) {
    const response = await fetch(`${origin}/render/${fixture}?encoder=${encoder}`, {
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const png = Buffer.from(await response.arrayBuffer());
    assert(png.length <= 1048576);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1080);
    if (encoder === 'wasm') {
      assert(
        png.equals(await readFile(`.automation-png/${fixture}.png`)),
        'Node and workerd Wasm outputs differ',
      );
    } else {
      assert.equal(
        inflateSync(png.subarray(41, 41 + png.readUInt32BE(33))).length,
        (4320 + 1) * 1080,
      );
    }
    results.push({
      fixture,
      encoder,
      status: response.status,
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  }
}
for (const path of ['/render/missing', '/render/__proto__', '/render/constructor', '/'])
  assert.equal((await fetch(`${origin}${path}`)).status, 404);
assert.equal(
  (await fetch(`${origin}/render/expression`, { method: 'POST', body: '<svg/>' })).status,
  405,
);
const report = {
  measured_at_utc: new Date().toISOString(),
  environment: 'local workerd',
  remote: false,
  cpu_measured: false,
  png_cases: results,
  negative_cases: 5,
};
await writeFile('.automation-png/worker-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
