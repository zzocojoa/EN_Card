import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { initWasm } from '@resvg/resvg-wasm';
import { loadFonts } from './fonts';
import { CardFonts } from './svg';
import { buildAtlas, atlasStyles, encodeAtlasPage } from './atlas-build';
import { pageSize, type AtlasMetrics } from './atlas-pages';

await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const fonts = new CardFonts(await loadFonts());
const directory = '.automation-png/atlas-v2-assets';
await mkdir(directory, { recursive: true });
const characters = [
  ...Array.from({ length: 95 }, (_, index) => String.fromCodePoint(32 + index)),
  ...Array.from({ length: 96 }, (_, index) => String.fromCodePoint(160 + index)),
  ...Array.from({ length: 11172 }, (_, index) => String.fromCodePoint(0xac00 + index)),
  ...Array.from({ length: 94 }, (_, index) => String.fromCodePoint(0x3131 + index)),
  ...'‘’“”–—…·「」『』〈〉《》【】※→←↑↓',
];
const supported: string[] = [];
const unsupported: number[] = [];
for (const character of new Set(characters)) {
  try {
    fonts.sprite(character, 20, 400);
    supported.push(character);
  } catch (error) {
    if (error instanceof RangeError && /폰트에 없는|글리프 누락/.test(error.message))
      unsupported.push(character.codePointAt(0)!);
    else throw error;
  }
}
const pages = new Map<number, string>();
for (const character of supported) {
  const page = Math.floor(character.codePointAt(0)! / pageSize);
  pages.set(page, (pages.get(page) ?? '') + character);
}
const metrics: AtlasMetrics = {
  points: supported.map((character) => character.codePointAt(0)!),
  weights: {},
};
const stats = {
  files: 0,
  compressed_bytes: 0,
  raw_bytes: 0,
  max_compressed_bytes: 0,
  max_raw_bytes: 0,
};
const started = performance.now();
for (const style of atlasStyles) {
  const saveMetrics = !metrics.weights[style.weight];
  if (saveMetrics) metrics.weights[style.weight] = {};
  for (const [page, chars] of pages) {
    const atlas = buildAtlas(fonts, chars, [style]);
    const compressed = encodeAtlasPage(atlas, page, style);
    const rawLength = 16 + pageSize * 32 + atlas.pixels.length;
    if (compressed.length > 4 * 1048576) throw new Error('페이지 상한 초과');
    await writeFile(`${directory}/${style.weight}-${style.size}-${page}.bin`, compressed);
    stats.files++;
    stats.compressed_bytes += compressed.length;
    stats.raw_bytes += rawLength;
    stats.max_compressed_bytes = Math.max(stats.max_compressed_bytes, compressed.length);
    stats.max_raw_bytes = Math.max(stats.max_raw_bytes, rawLength);
    if (saveMetrics)
      for (const [key, glyph] of Object.entries(atlas.glyphs)) {
        const ratio = glyph.advance / style.size;
        if (ratio !== 1) metrics.weights[style.weight]![key.split(':')[2]!] = ratio;
      }
  }
  console.log(`Prepared style ${style.weight}:${style.size}; ${stats.files} files`);
}
await writeFile('.automation-png/atlas-metrics.json', JSON.stringify(metrics));
await writeFile('.automation-png/atlas-metrics.data', JSON.stringify(metrics));
await copyFile('public/fonts/LICENSE.txt', `${directory}/FONT-LICENSE.txt`);
const report = {
  measured_at_utc: new Date().toISOString(),
  qualification: 'not_qualified',
  scope:
    'Build-time artifacts. All 11172 modern Hangul syllables, supported compatibility Jamo, printable ASCII, Latin1 and explicit punctuation; not arbitrary Unicode. No runtime or remote qualification.',
  supported_characters: supported.length,
  unsupported_points: unsupported,
  styles: atlasStyles.length,
  ...stats,
  build_ms: performance.now() - started,
};
await writeFile('.automation-png/atlas-full-build.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
