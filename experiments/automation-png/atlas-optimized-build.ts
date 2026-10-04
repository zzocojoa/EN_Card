import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { initWasm } from '@resvg/resvg-wasm';
import { loadFonts } from './fonts';
import { CardFonts } from './svg';
import { atlasStyles, buildAtlas, encodeAtlasPage } from './atlas-build';
import type { AtlasMetrics } from './atlas-pages';

// Preserve the existing full Unicode coverage. No benchmark-derived font subset.
const metrics = JSON.parse(
  await readFile('.automation-png/atlas-metrics.json', 'utf8'),
) as AtlasMetrics;
await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
const fonts = new CardFonts(await loadFonts());
const pages = new Map<number, string>();
for (const point of metrics.points) {
  const page = Math.floor(point / 1024);
  pages.set(page, (pages.get(page) ?? '') + String.fromCodePoint(point));
}
const fixed = new Set(Array.from('오늘의 표현 비교 하루 한 표현').map((c) => c.codePointAt(0)!));
const commonCharacters = metrics.points
  .filter((p) => p < 0x3000 || fixed.has(p))
  .map((p) => String.fromCodePoint(p))
  .join('');
const results = [];
for (const size of [1080, 800, 720] as const) {
  const root = `.automation-png/atlas-optimized/${size}`;
  for (const slots of [1024, 64, 32]) await mkdir(`${root}/${slots}`, { recursive: true });
  const stats = {
    size,
    characters: metrics.points.length,
    styles: atlasStyles.length,
    pages: {
      1024: { files: 0, bytes: 0, max_bytes: 0 },
      64: { files: 0, bytes: 0, max_bytes: 0 },
      32: { files: 0, bytes: 0, max_bytes: 0 },
    },
  };
  for (const style of atlasStyles) {
    for (const [page, characters] of pages) {
      const name = `${style.weight}-${style.size}-${page}.bin`;
      const bytes =
        size === 1080
          ? new Uint8Array(await readFile(`.automation-png/atlas-v2-assets/${name}`))
          : encodeAtlasPage(buildAtlas(fonts, characters, [style], size / 1080), page, style);
      await writeFile(`${root}/1024/${name}`, bytes);
      stats.pages[1024].files++;
      stats.pages[1024].bytes += bytes.length;
      stats.pages[1024].max_bytes = Math.max(stats.pages[1024].max_bytes, bytes.length);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (const slots of [64, 32] as const) {
        for (let start = 0; start < 1024; start += slots) {
          const header = bytes.slice(0, 16);
          const headerView = new DataView(header.buffer);
          headerView.setUint32(4, page * 1024 + start);
          headerView.setUint32(12, slots);
          const records = bytes.slice(16 + start * 32, 16 + (start + slots) * 32);
          const recordsView = new DataView(records.buffer);
          const parts: Uint8Array[] = [header, records];
          let length = 16 + slots * 32;
          let count = 0;
          for (let i = 0; i < slots; i++) {
            if (recordsView.getUint32(i * 32 + 24) !== 1) continue;
            const offset = view.getUint32(16 + (start + i) * 32 + 16);
            const n = recordsView.getUint32(i * 32 + 20);
            recordsView.setUint32(i * 32 + 16, length);
            parts.push(bytes.subarray(offset, offset + n));
            length += n;
            count++;
          }
          if (!count) continue;
          const result = new Uint8Array(length);
          let offset = 0;
          for (const part of parts) {
            result.set(part, offset);
            offset += part.length;
          }
          const newPage = (page * 1024 + start) / slots;
          await writeFile(`${root}/${slots}/${style.weight}-${style.size}-${newPage}.bin`, result);
          stats.pages[slots].files++;
          stats.pages[slots].bytes += result.length;
          stats.pages[slots].max_bytes = Math.max(stats.pages[slots].max_bytes, result.length);
        }
      }
    }
  }
  const common = buildAtlas(fonts, commonCharacters, atlasStyles, size / 1080);
  const metadata = Buffer.from(JSON.stringify(common.glyphs));
  const data = Buffer.alloc(4 + metadata.length + common.pixels.length);
  data.writeUInt32BE(metadata.length, 0);
  data.set(metadata, 4);
  data.set(common.pixels, 4 + metadata.length);
  await writeFile(`${root}/common.bin`, deflateSync(data));
  await writeFile(`${root}/metrics.data`, JSON.stringify(metrics));
  for (const slots of [1024, 64, 32] as const) {
    if (stats.pages[slots].files + 1 > 20000 || stats.pages[slots].max_bytes > 4 * 1048576)
      throw new Error('정적 파일 한도 초과');
    await copyFile('public/fonts/LICENSE.txt', `${root}/${slots}/FONT-LICENSE.txt`);
  }
  results.push(stats);
  console.log(`Built ${size}: ${JSON.stringify(stats.pages)}`);
}
await writeFile(
  '.automation-png/atlas-optimized-build.json',
  JSON.stringify(
    {
      measured_at_utc: new Date().toISOString(),
      qualification: 'not_qualified',
      scope:
        'Offline build only. All supported glyphs/styles at each size; each page layout is a separate deployment candidate, not a combined asset directory.',
      results,
    },
    null,
    2,
  ) + '\n',
);
