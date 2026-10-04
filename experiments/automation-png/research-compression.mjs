// Local research only. No deployments, accounts, network adapters or production edits.
// Recompress existing indexed PNG scanlines; compare lossless strategies in Node/workerd.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync, constants } from 'node:zlib';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const variants = [
  ['default_1', { level: 1 }],
  ['rle', { level: 1, strategy: constants.Z_RLE }],
  ['huffman', { level: 1, strategy: constants.Z_HUFFMAN_ONLY }],
  ['fixed_1', { level: 1, strategy: constants.Z_FIXED }],
  ['default_1_mem9', { level: 1, memLevel: 9 }],
  ['uncompressed', { level: 0 }],
];
const rounds = 12;
const batch = 20;
// Rotate/reverse order each round to reduce fixed ordering bias. Warm-only test.
function study(raw, variants, rounds, batch) {
  const data = Object.fromEntries(variants.map(([name]) => [name, { samples: [] }]));
  for (const [name, options] of variants) {
    const compressed = deflateSync(raw, options);
    const decoded = inflateSync(compressed);
    if (decoded.length !== raw.length || decoded.some((v, i) => v !== raw[i]))
      throw new Error(`${name}: round-trip differs`);
    data[name].compressed_bytes = compressed.length;
    data[name].identical_scanlines = true;
    for (let warm = 0; warm < 5; warm++) deflateSync(raw, options);
  }
  for (let round = 0; round < rounds; round++) {
    const order = [
      ...variants.slice(round % variants.length),
      ...variants.slice(0, round % variants.length),
    ];
    if (round % 2) order.reverse();
    for (const [name, options] of order) {
      const started = performance.now();
      for (let i = 0; i < batch; i++) deflateSync(raw, options);
      const elapsed = performance.now() - started;
      if (elapsed <= 0) throw new Error('Local timer did not advance; invalid measurement');
      data[name].samples.push(elapsed / batch);
    }
  }
  return data;
}
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: '127.0.0.1',
    port: 0,
    cf: false,
    telemetry: { enabled: false },
    modules: true,
    compatibilityDate: '2026-09-01',
    script: `import { deflateSync, inflateSync } from 'node:zlib';
    ${study.toString()}
    export default { async fetch(request) {
      const raw = new Uint8Array(await request.arrayBuffer());
      return Response.json(study(raw, ${JSON.stringify(variants)}, ${rounds}, ${batch}));
    }};`,
  }),
);
function summarize(data, overhead) {
  return Object.fromEntries(
    Object.entries(data).map(([name, row]) => {
      const sorted = [...row.samples].sort((a, b) => a - b);
      return [
        name,
        {
          mean_wall_ms: row.samples.reduce((a, b) => a + b) / row.samples.length,
          median_batch_wall_ms: (sorted[5] + sorted[6]) / 2,
          min_batch_wall_ms: sorted[0],
          max_batch_wall_ms: sorted.at(-1),
          png_bytes: row.compressed_bytes + overhead,
          under_1_mib: row.compressed_bytes + overhead <= 1048576,
          ...row,
        },
      ];
    }),
  );
}
const results = [];
try {
  await mf.ready;
  for (const fixture of ['expression', 'comparison', 'long', 'long_comparison', 'coverage']) {
    const png = await readFile(`.automation-png/remote-${fixture}-atlas_pipeline-0.png`);
    const parts = [];
    for (let offset = 8; offset < png.length;) {
      const size = png.readUInt32BE(offset);
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        parts.push(png.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
    }
    assert.equal(parts.length, 1);
    assert.equal(png[24], 8);
    assert.equal(png[25], 3);
    const raw = inflateSync(Buffer.concat(parts));
    assert.equal(raw.length, 1081 * 1080);
    const overhead = png.length - parts[0].length;
    const node = study(raw, variants, rounds, batch);
    const response = await mf.dispatchFetch('http://localhost/research', {
      method: 'POST',
      body: raw,
    });
    assert.equal(response.status, 200);
    const workerd = await response.json();
    // Different native zlib versions may emit different streams; decoded bytes must match.
    for (const [name] of variants) assert.equal(workerd[name].identical_scanlines, true);
    results.push({
      fixture,
      raw_bytes: raw.length,
      original_png_sha256: createHash('sha256').update(png).digest('hex'),
      node: summarize(node, overhead),
      workerd: summarize(workerd, overhead),
    });
    console.log(
      `${fixture}: baseline ${workerd.default_1.samples.reduce((a, b) => a + b) / rounds} ms, RLE ${workerd.rle.samples.reduce((a, b) => a + b) / rounds} ms (local workerd wall)`,
    );
  }
} finally {
  await mf.dispose();
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Local warm compression-only wall time, not CPU billing or remote qualification; excludes layout, paint, validation, network, startup and request parsing. Batched times are not per-request p95/p99.',
  node: process.version,
  cpu: cpus()[0]?.model,
  rounds,
  batch,
  warmups_per_variant: 5,
  variants,
  results,
};
await writeFile(
  'docs/evidence/AI_PNG_COMPRESSION_RESEARCH_2026-10-02.json',
  JSON.stringify(report, null, 2) + '\n',
);
