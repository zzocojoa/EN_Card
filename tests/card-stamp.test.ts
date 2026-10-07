import { beforeAll, expect, it } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { CARD_WEEKDAYS, cardDeliveryStamp } from '../src/shared/card-stamp';
import { CardFonts, cardSvg } from '../src/automation/svg';
import { layoutCardHeader } from '../src/shared/card-layout';
import { loadFonts } from '../experiments/automation-png/fonts';
import { validatePng } from '../src/worker/png';
import type { CardInput } from '../src/shared/model';

it.each([
  ['2026-10-06T14:59:00Z', '2026년 10월 06일', '23:59', '화요일'],
  ['2026-10-06T15:00:00Z', '2026년 10월 07일', '00:00', '수요일'],
  ['2026-12-31T15:05:00Z', '2027년 01월 01일', '00:05', '금요일'],
  ['2028-02-28T22:30:00Z', '2028년 02월 29일', '07:30', '화요일'],
])('KST date boundaries: %s', (utc, date, time, weekday) => {
  expect(cardDeliveryStamp(Date.parse(utc))).toMatchObject({
    date,
    time,
    weekday: { name: weekday },
  });
});

it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER])(
  'rejects invalid due time %s',
  (time) => {
    expect(() => cardDeliveryStamp(time)).toThrow(RangeError);
  },
);

it('seven distinct weekday colors retain readable contrast and explicit names', () => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  expect(new Set(CARD_WEEKDAYS.map((d) => d.color)).size).toBe(7);
  for (const day of CARD_WEEKDAYS) {
    expect(
      (luminance(day.background) + 0.05) / (luminance(day.color) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    expect(day.name).toMatch(/^[일월화수목금토]요일$/);
  }
});

let fonts: CardFonts;
beforeAll(async () => {
  fonts = new CardFonts(await loadFonts());
  await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
});
const sample: CardInput = {
  template: 'expression',
  expression: 'Take your time',
  meaning_ko: '서두르지 말고 천천히 해',
  example_en: 'Take your time. We can leave later.',
  example_ko: '천천히 해. 나중에 출발해도 돼.',
  note_ko: '상대에게 서두르지 않아도 된다고 말할 때 사용',
};
function raster(svg: string) {
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  const rendered = renderer.render();
  try {
    return { pixels: Buffer.from(rendered.pixels), png: Buffer.from(rendered.asPng()) };
  } finally {
    rendered.free();
    renderer.free();
  }
}

it.each(['expression', 'comparison'] as const)(
  '%s: all weekdays produce unclipped 1080 PNGs without moving body text',
  async (template) => {
    const card: CardInput = {
      ...sample,
      template,
      ...(template === 'comparison'
        ? { base_expression: 'Do not hurry', base_meaning_ko: '서두르지 마' }
        : {}),
    };
    const baseline = raster(cardSvg(card, fonts, 3));
    if (process.env.CARD_DATE_PREVIEW_DIR) {
      await mkdir(process.env.CARD_DATE_PREVIEW_DIR, { recursive: true });
      await writeFile(`${process.env.CARD_DATE_PREVIEW_DIR}/${template}-manual.png`, baseline.png);
    }
    const measure = (text: string, css: string) => fonts.measure(text, css);
    for (let index = 0; index < 7; index++) {
      const due = Date.parse(`2026-10-${String(4 + index).padStart(2, '0')}T07:30:00+09:00`);
      const stamp = cardDeliveryStamp(due);
      expect(stamp.weekday).toBe(CARD_WEEKDAYS[index]);
      const header = layoutCardHeader(measure, card, 3, stamp);
      expect(header.lines.map((l) => l.text)).toEqual([
        `003  /  ${template === 'comparison' ? '표현 비교' : '오늘의 표현'}`,
        '최초 발송 예정 · 한국 시간',
        stamp.date,
        stamp.weekday.name,
        '07:30',
      ]);
      for (const line of header.lines) {
        expect(line.x).toBeGreaterThanOrEqual(88);
        expect(
          line.x + measure(line.text, `${line.weight} ${line.size}px "Noto Sans KR Variable"`),
        ).toBeLessThanOrEqual(992.001);
        const paths = fonts.outline(line.text, line.x, line.y, line.size, line.weight, line.color);
        const bottoms = [...paths.matchAll(/data-bottom="([^"]+)"/g)].map((m) => Number(m[1]));
        expect(Math.max(...bottoms)).toBeLessThan(155);
      }
      const svg = cardSvg(card, fonts, 3, due);
      const image = raster(svg);
      expect(() => validatePng(image.png)).not.toThrow();
      expect(image.png.readUInt32BE(16)).toBe(1080);
      expect(image.png.readUInt32BE(20)).toBe(1080);
      expect(image.png.length).toBeLessThan(1048576);
      expect(
        image.pixels.subarray(165 * 1080 * 4).equals(baseline.pixels.subarray(165 * 1080 * 4)),
      ).toBe(true);
      const badge = header.rects[1]!;
      const pixel = (Math.floor(badge.y + 30) * 1080 + Math.floor(badge.x + 8)) * 4;
      const rgb = [1, 3, 5].map((n) => parseInt(stamp.weekday.background.slice(n, n + 2), 16));
      expect([...image.pixels.subarray(pixel, pixel + 4)]).toEqual([...rgb, 255]);
      if (process.env.CARD_DATE_PREVIEW_DIR) {
        await mkdir(process.env.CARD_DATE_PREVIEW_DIR, { recursive: true });
        await writeFile(`${process.env.CARD_DATE_PREVIEW_DIR}/${template}-${index}.png`, image.png);
      }
    }
  },
);
