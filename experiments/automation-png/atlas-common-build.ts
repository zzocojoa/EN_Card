import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { initWasm } from '@resvg/resvg-wasm';
import { loadFonts } from './fonts';
import { CardFonts } from './svg';
import { buildAtlas } from './atlas-build';
import type { AtlasMetrics } from './atlas-pages';

await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const metrics = JSON.parse(
  await readFile('.automation-png/atlas-metrics.json', 'utf8'),
) as AtlasMetrics;
// Printable Latin/punctuation + fixed header/footer only. Never derive the common
// cache from benchmark cards, which would conceal runtime page fetch costs.
const fixed = new Set(
  Array.from('오늘의 표현 비교 하루 한 표현').map((char) => char.codePointAt(0)!),
);
const characters = metrics.points
  .filter((point) => point < 0x3000 || fixed.has(point))
  .map((point) => String.fromCodePoint(point))
  .join('');
const atlas = buildAtlas(new CardFonts(await loadFonts()), characters);
const metadata = Buffer.from(JSON.stringify(atlas.glyphs));
const data = Buffer.alloc(4 + metadata.length + atlas.pixels.length);
data.writeUInt32BE(metadata.length, 0);
data.set(metadata, 4);
data.set(atlas.pixels, 4 + metadata.length);
const compressed = deflateSync(data);
if (compressed.length > 2 * 1048576 || data.length > 16 * 1048576)
  throw new Error('공통 글자 번들 상한 초과');
await writeFile('.automation-png/atlas-common.bin', compressed);
console.log(
  JSON.stringify({
    scope: 'Build-time common Latin/punctuation and fixed labels',
    glyphs: Object.keys(atlas.glyphs).length,
    compressed_bytes: compressed.length,
    decoded_bytes: data.length,
  }),
);
