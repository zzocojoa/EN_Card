// Estimate finer font-page layouts from existing compressed glyph records.
// No new font assets or production encoder are generated. Fetch counts and bytes
// assume a cold cache and each distinct page fetched once.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
    export { atlasAdvance, decodeCommonAtlas, planCardAtlas } from './experiments/automation-png/atlas-pages';
    export { fixtures, atlasCoverageCard } from './experiments/automation-png/fixtures';
  `,
  },
  outfile: '.automation-png/research-page-imports.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const { atlasAdvance, decodeCommonAtlas, planCardAtlas, fixtures, atlasCoverageCard } =
  await import('../../.automation-png/research-page-imports.mjs');
const advance = atlasAdvance(
  JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')),
);
const common = decodeCommonAtlas(await readFile('.automation-png/atlas-common.bin'));
const pages = new Map();
for (const name of await readdir('.automation-png/atlas-v2-assets')) {
  if (!name.endsWith('.bin')) continue;
  pages.set(name, await readFile('.automation-png/atlas-v2-assets/' + name));
}
const results = [];
for (const size of [1024, 256, 128, 64, 32]) {
  const sizes = new Map();
  for (const [name, page] of pages) {
    for (let base = 0; base < 1024; base += size) {
      let bytes = 16 + size * 32;
      let present = 0;
      for (let i = base; i < base + size; i++) {
        const record = 16 + i * 32;
        if (page.readUInt32BE(record + 24) !== 1) continue;
        bytes += page.readUInt32BE(record + 20);
        present++;
      }
      if (present) sizes.set(name + ':' + base / size, bytes);
    }
    if (size === 1024) assert.equal(sizes.get(name + ':0'), page.length);
  }
  const cards = [];
  for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
    const plan = planCardAtlas(card, advance, 1, common);
    const needed = new Set();
    for (const [name, keys] of plan.pages) {
      for (const key of keys) {
        const point = Number(key.split(':')[2]);
        needed.add(name + ':' + Math.floor((point % 1024) / size));
      }
    }
    let bytes = 0;
    for (const key of needed) {
      assert.ok(sizes.has(key));
      bytes += sizes.get(key);
    }
    cards.push({ fixture, page_fetches: needed.size, bytes });
  }
  results.push({
    page_size: size,
    estimated_asset_files_including_license: sizes.size + 1,
    estimated_total_bytes: [...sizes.values()].reduce((a, b) => a + b, 0),
    cards,
  });
}
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Deterministic layout estimate, not an implemented format or CPU benchmark. Reuses current independently compressed glyphs with 16-byte page headers and 32-byte direct records. Omits empty pages, retains all supported glyphs/styles. Counts unique cold-cache reads; no Range support or cache hits assumed. Existing 1024-slot page-size estimates are checked against actual files.',
  results,
};
await writeFile(
  'docs/evidence/AI_PNG_PAGE_LAYOUT_RESEARCH_2026-10-02.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
