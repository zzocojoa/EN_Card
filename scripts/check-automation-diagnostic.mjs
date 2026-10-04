import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { inputs } from '../.automation-png/assembly-profile-inputs.mjs';

const rows = [],
  expected = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const input of inputs) {
  expected.push({
    kind: 'png',
    size: input.size,
    fixture: input.fixture,
    bytes: input.png.length,
    sha256: hash(input.png),
  });
  const view = new DataView(input.bundle.buffer, input.bundle.byteOffset, input.bundle.length);
  let offset = 8;
  for (let index = 0; index < view.getUint16(4); index++) {
    const length = view.getUint32(offset);
    offset += 4;
    const frame = input.bundle.subarray(offset, offset + length);
    offset += length;
    expected.push({
      kind: 'glyph',
      size: input.size,
      fixture: input.fixture,
      index,
      bytes: frame.length,
      sha256: hash(frame),
    });
  }
}
assert.equal(expected.filter((r) => r.kind === 'glyph').length, 72);
for (const row of expected) {
  const path =
    row.kind === 'png'
      ? `/probe/${row.fixture}/atlas_lean${row.size}`
      : `/diagnostic/glyphs/${row.size}/${row.fixture}/${row.index}`;
  const response = await fetch('http://127.0.0.1:8793' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer local-synthetic-token-not-for-deployment',
      'X-Lab-Call': randomUUID().replaceAll('-', ''),
    },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, path);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), row.sha256);
  assert.equal(bytes.length, row.bytes);
  assert.match(response.headers.get('X-Lab-Isolate'), /^[a-f0-9-]{36}$/);
  const ordinal = Number(
    response.headers.get(row.kind === 'png' ? 'X-Lab-Assembly-Ordinal' : 'X-Lab-Glyph-Ordinal'),
  );
  assert.ok(Number.isSafeInteger(ordinal) && ordinal > 0);
  rows.push({ ...row, isolate: response.headers.get('X-Lab-Isolate'), ordinal });
}
await writeFile(
  '.automation-png/atlas-diagnostic-expected.json',
  JSON.stringify(expected, null, 2) + '\n',
);
await writeFile(
  '.automation-png/atlas-diagnostic-worker-report.json',
  JSON.stringify(
    {
      measured_at_utc: new Date().toISOString(),
      scope:
        'Local workerd real assets/service bindings only. 10 PNG and 72 individual glyph probes, exact hashes. No remote CPU.',
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'PASS local diagnostic bindings: 10 PNG + 72 glyph probes, exact hashes and isolate metadata',
);
