import { readFile } from 'node:fs/promises';
import { decompress } from 'wawoff2';
import type { FontSource } from './svg';

export async function loadFonts(): Promise<FontSource[]> {
  const css = await readFile('public/fonts/font.css', 'utf8');
  const sources = await Promise.all(
    [...css.matchAll(/url\(\.\/files\/([^)]+)\)[\s\S]*?unicode-range:\s*([^;]+);/g)].map(
      async (match): Promise<FontSource> => ({
        bytes: Buffer.from(await decompress(await readFile(`public/fonts/files/${match[1]}`))),
        ranges: match[2]!.split(',').map((range): [number, number] => {
          const [start, end] = range.trim().replace(/^U\+/i, '').split('-');
          return [parseInt(start!, 16), parseInt(end ?? start!, 16)];
        }),
      }),
    ),
  );
  if (!sources.length) throw new Error('기존 폰트 정의가 없습니다.');
  return sources;
}
