import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeAtlasPage } from './atlas-pages';
import { blockPageDecoder } from './atlas-blocks';
import { encodeBlockPage } from './atlas-block-build';

const results = [];
for (const size of [800, 720]) {
  const source = `.automation-png/atlas-optimized/${size}/64`;
  const names = (await readdir(source)).filter((name) => name.endsWith('.bin')).sort();
  const inputHash = createHash('sha256');
  const modes = ([4, 8] as const).map((blockSize) => ({
    blockSize,
    directory: `.automation-png/atlas-blocks/b${blockSize}/assets/${size}`,
    bytes: 0,
    maxBytes: 0,
    glyphs: 0,
    hash: createHash('sha256'),
  }));
  for (const mode of modes) await mkdir(mode.directory, { recursive: true });
  for (const [index, name] of names.entries()) {
    assert.match(name, /^\d+-\d+-\d+\.bin$/);
    const data = new Uint8Array(await readFile(`${source}/${name}`));
    inputHash.update(name + '\n').update(data);
    const view = new DataView(data.buffer),
      base = view.getUint32(4),
      logicalSize = view.getUint16(8),
      weight = view.getUint16(10);
    const keys = Array.from({ length: 64 }, (_, i) => i)
      .filter((i) => view.getUint32(16 + i * 32 + 24) === 1)
      .map((i) => `${weight}:${logicalSize}:${base + i}`);
    const atlas = decodeAtlasPage(data, keys, 64);
    for (const mode of modes) {
      const bytes = encodeBlockPage(atlas, base, logicalSize, weight, mode.blockSize);
      const decoded = blockPageDecoder(mode.blockSize)(bytes, keys, 64);
      assert.deepEqual(decoded.glyphs, atlas.glyphs);
      assert.ok(Buffer.from(decoded.pixels).equals(atlas.pixels));
      await writeFile(`${mode.directory}/${name}`, bytes);
      mode.bytes += bytes.length;
      mode.maxBytes = Math.max(mode.maxBytes, bytes.length);
      mode.glyphs += keys.length;
      mode.hash.update(name + '\n').update(bytes);
    }
    if ((index + 1) % 1000 === 0)
      console.log(`${size}: ${index + 1}/${names.length} pages converted and fully decoded`);
  }
  for (const mode of modes) {
    await copyFile('public/fonts/LICENSE.txt', `${mode.directory}/FONT-LICENSE.txt`);
    const actual = (await readdir(mode.directory)).sort();
    assert.deepEqual(
      actual,
      [...names, 'FONT-LICENSE.txt'].sort(),
      'Unexpected stale files in block output',
    );
    results.push({
      size,
      blockSize: mode.blockSize,
      files: actual.length,
      glyphs: mode.glyphs,
      bytes: mode.bytes,
      max_bytes: mode.maxBytes,
      source_tree_sha256: inputHash.copy().digest('hex'),
      output_tree_sha256: mode.hash.digest('hex'),
    });
  }
}
for (const blockSize of [4, 8])
  assert.ok(
    results.filter((row) => row.blockSize === blockSize).reduce((sum, row) => sum + row.files, 0) <=
      20000,
  );
await writeFile(
  'docs/evidence/AI_PNG_BLOCK_BUILD_2026-10-03.json',
  JSON.stringify(
    {
      measured_at_utc: new Date().toISOString(),
      qualification: 'not_qualified',
      scope:
        'Offline full-page conversion, no glyph subset. Every source glyph decoded and compared in each candidate. Each block size uses a separate asset directory. No remote operations.',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(results));
