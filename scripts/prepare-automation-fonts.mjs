import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { decompress } from 'wawoff2';
const css = await readFile('public/fonts/font.css', 'utf8');
const sources = await Promise.all(
  [...css.matchAll(/url\(\.\/files\/([^)]+)\)[\s\S]*?unicode-range:\s*([^;]+);/g)].map(
    async (match) => ({
      bytes: Buffer.from(await decompress(await readFile(`public/fonts/files/${match[1]}`))),
      ranges: match[2].split(',').map((range) => {
        const [start, end] = range.trim().replace(/^U\+/i, '').split('-');
        return [parseInt(start, 16), parseInt(end ?? start, 16)];
      }),
    }),
  ),
);
if (!sources.length) throw new Error('No font definitions');
let offset = 0;
const index = sources.map(({ bytes, ranges }) => {
  const entry = { offset, length: bytes.length, ranges };
  offset += bytes.length;
  return entry;
});
if (offset > 25 * 1024 * 1024) throw new Error('Font pack exceeds static asset limit');
await mkdir('.automation-fonts', { recursive: true });
await writeFile('.automation-fonts/fonts.bin', Buffer.concat(sources.map((s) => s.bytes)));
await writeFile('.automation-fonts/fonts.json', JSON.stringify(index));
await copyFile('public/fonts/LICENSE.txt', '.automation-fonts/LICENSE.txt');
console.log(JSON.stringify({ fonts: sources.length, bytes: offset }));
