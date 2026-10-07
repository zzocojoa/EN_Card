import type { CardInput } from './model';
import type { CardDeliveryStamp } from './card-stamp';

// Pure geometry shared by browser Canvas and the automation renderer.
type Block = {
  text: string;
  size: number;
  weight: number;
  color: string;
  gap: number;
  name: string;
};
type Line = { text: string; x: number; y: number; size: number; weight: number; color: string };
export type Layout = { lines: Line[]; dividerY: number | null };
export const CARD_FONT: string = '"Noto Sans KR Variable"';
export function layoutCardHeader(
  measure: (text: string, font: string) => number,
  card: CardInput,
  number: number,
  stamp: CardDeliveryStamp | null = null,
) {
  const lines: Line[] = [
    {
      text: `${String(number).padStart(3, '0')}  /  ${card.template === 'comparison' ? '표현 비교' : '오늘의 표현'}`,
      x: 146,
      y: stamp ? 48 : 72,
      size: 22,
      weight: 600,
      color: '#657080',
    },
  ];
  const rects = [
    {
      x: 88,
      y: stamp ? 59 : 83,
      width: 38,
      height: 5,
      radius: 0,
      color: stamp?.weekday.color ?? '#214de5',
    },
  ];
  if (stamp) {
    const weekdayX = 88 + measure(stamp.date, `600 36px ${CARD_FONT}`) + 20;
    const weekdayWidth = measure(stamp.weekday.name, `700 32px ${CARD_FONT}`) + 32;
    const timeX = 992 - measure(stamp.time, `800 44px ${CARD_FONT}`);
    if (weekdayX + weekdayWidth + 24 > timeX)
      throw new RangeError('카드의 날짜 표시가 너무 깁니다.');
    rects.push({
      x: weekdayX,
      y: 88,
      width: weekdayWidth,
      height: 60,
      radius: 12,
      color: stamp.weekday.background,
    });
    lines.push(
      {
        text: stamp.label,
        x: 992 - measure(stamp.label, `500 22px ${CARD_FONT}`),
        y: 48,
        size: 22,
        weight: 500,
        color: '#657080',
      },
      { text: stamp.date, x: 88, y: 92, size: 36, weight: 600, color: '#334155' },
      {
        text: stamp.weekday.name,
        x: weekdayX + 16,
        y: 94,
        size: 32,
        weight: 700,
        color: stamp.weekday.color,
      },
      { text: stamp.time, x: timeX, y: 86, size: 44, weight: 800, color: '#10151f' },
    );
  }
  return { lines, rects };
}
function wrap(measure: (text: string) => number, text: string, width: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let current: string = '';
    const words: string[] = paragraph.split(/(\s+)/);
    for (const word of words) {
      if (measure(current + word) <= width) {
        current += word;
        continue;
      }
      if (current.trim()) lines.push(current.trimEnd());
      current = '';
      for (const char of Array.from(word)) {
        if (measure(current + char) > width && current) {
          lines.push(current);
          current = '';
        }
        current += char;
      }
    }
    lines.push(current.trimEnd());
    return lines;
  });
}
function blocks(card: CardInput): Block[] {
  const base: Block[] =
    card.template === 'comparison'
      ? [
          {
            text: card.base_expression ?? '',
            size: 44,
            weight: 650,
            color: '#202631',
            gap: 12,
            name: '기본 표현',
          },
          {
            text: card.base_meaning_ko ?? '',
            size: 32,
            weight: 450,
            color: '#657080',
            gap: 55,
            name: '기본 뜻',
          },
        ]
      : [];
  const pronunciation: Block[] = card.pronunciation_ko
    ? [
        {
          text: card.pronunciation_ko,
          size: 30,
          weight: 450,
          color: '#6f7886',
          gap: card.template === 'comparison' ? 40 : 20,
          name: '발음 안내',
        },
      ]
    : [];
  const meaning: Block = {
    text: card.meaning_ko,
    size: 44,
    weight: 700,
    color: '#214de5',
    gap: card.template === 'comparison' && pronunciation.length ? 12 : 50,
    name: '한글 뜻',
  };
  return [
    ...base,
    {
      text: card.expression,
      size: card.template === 'comparison' ? 66 : 82,
      weight: 800,
      color: '#10151f',
      gap: 16,
      name: '영어 표현',
    },
    ...(card.template === 'comparison' ? [meaning, ...pronunciation] : [...pronunciation, meaning]),
    { text: card.example_en, size: 36, weight: 500, color: '#202631', gap: 16, name: '영어 예문' },
    { text: card.example_ko, size: 32, weight: 450, color: '#657080', gap: 26, name: '예문 번역' },
    ...(card.note_ko
      ? [{ text: card.note_ko, size: 28, weight: 400, color: '#657080', gap: 0, name: '추가 설명' }]
      : []),
  ];
}
export function layoutCard(
  measure: (text: string, font: string) => number,
  card: CardInput,
): Layout {
  for (const scale of [1, 0.95, 0.9, 0.85, 0.8]) {
    let y: number = 165;
    let dividerY: number | null = null;
    const lines: Line[] = [];
    for (const [index, block] of blocks(card).entries()) {
      const size: number = Math.max(26, Math.round(block.size * scale));
      const font: string = `${block.weight} ${size}px ${CARD_FONT}`;
      for (const text of wrap((value) => measure(value, font), block.text, 904)) {
        lines.push({ text, x: 88, y, size, weight: block.weight, color: block.color });
        y += size * 1.4;
      }
      if (card.template === 'comparison' && index === 1) dividerY = y + 10;
      y += block.gap * scale;
    }
    if (y <= 984) return { lines, dividerY };
  }
  throw new RangeError(
    '카드에 내용이 모두 들어가지 않습니다. 영어 표현·예문·추가 설명을 줄여주세요. 최소 글자 크기 이하로 축소하지 않습니다.',
  );
}
