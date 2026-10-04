import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initWasm } from '@resvg/resvg-wasm';
import { loadFonts } from './fonts';
import { CardFonts, cardSvg } from './svg';
import { rasterize } from './raster';
import { fixtures, atlasCoverageCard } from './fixtures';

const root = '.automation-png/durable';
await mkdir(`${root}/assets`, { recursive: true });
await mkdir(`${root}/expected`, { recursive: true });
const sources = await loadFonts();
let offset = 0;
const manifest = sources.map(({ bytes, ranges }) => {
  const entry = { offset, length: bytes.length, ranges };
  offset += bytes.length;
  return entry;
});
const pack = Buffer.concat(sources.map((source) => source.bytes));
if (pack.length > 25 * 1024 * 1024) throw new Error('Font asset exceeds static asset limit');
await writeFile(`${root}/assets/fonts.bin`, pack);
await writeFile(`${root}/assets/fonts.json`, JSON.stringify(manifest));
await copyFile('public/fonts/LICENSE.txt', `${root}/assets/LICENSE.txt`);
await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const fonts = new CardFonts(sources);
const cards = { ...fixtures, coverage: atlasCoverageCard };
const inputs = Object.entries(cards).map(([name, card], number) => ({
  job: name,
  card,
  number: number + 1,
}));
const outputs = [];
for (const input of inputs) {
  const png = rasterize(cardSvg(input.card, fonts, input.number));
  await writeFile(`${root}/expected/${input.job}.png`, png);
  outputs.push({
    name: input.job,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  });
}
await writeFile(`${root}/inputs.json`, JSON.stringify(inputs, null, 2) + '\n');
await writeFile(
  `${root}/build.json`,
  JSON.stringify(
    {
      fonts: sources.length,
      font_bytes: pack.length,
      font_sha256: createHash('sha256').update(pack).digest('hex'),
      outputs,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    fonts: sources.length,
    font_bytes: pack.length,
    reference_pngs: outputs.length,
  }),
);
