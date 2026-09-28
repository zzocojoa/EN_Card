import { LIMITS, type CardInput } from '../shared/model';

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
const FONT: string = '"Noto Sans KR Variable"';
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
      const font: string = `${block.weight} ${size}px ${FONT}`;
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
export async function renderCard(card: CardInput, number: number): Promise<HTMLCanvasElement> {
  const text: string = Object.values(card).join(' ');
  await Promise.all([
    document.fonts.load(`450 32px ${FONT}`, text),
    document.fonts.load(`800 82px ${FONT}`, text),
  ]);
  await document.fonts.ready;
  if (!document.fonts.check(`450 32px ${FONT}`, text))
    throw new Error('한글 폰트를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.');
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (!context) throw new Error('브라우저에서 Canvas 2D를 사용할 수 없습니다.');
  const layout: Layout = layoutCard((text, font) => {
    context.font = font;
    return context.measureText(text).width;
  }, card);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1080, 1080);
  context.textBaseline = 'top';
  context.fillStyle = '#214de5';
  context.fillRect(88, 83, 38, 5);
  context.font = `600 22px ${FONT}`;
  context.fillStyle = '#657080';
  context.fillText(
    `${String(number).padStart(3, '0')}  /  ${card.template === 'comparison' ? '표현 비교' : '오늘의 표현'}`,
    146,
    72,
  );
  if (layout.dividerY !== null) {
    context.fillStyle = '#e3e7ef';
    context.fillRect(88, layout.dividerY, 904, 2);
  }
  for (const line of layout.lines) {
    context.font = `${line.weight} ${line.size}px ${FONT}`;
    context.fillStyle = line.color;
    context.fillText(line.text, line.x, line.y);
  }
  context.fillStyle = '#7b8492';
  context.font = `400 20px ${FONT}`;
  context.fillText('하루 한 표현', 88, 1015);
  return canvas;
}
export async function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob: Blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('PNG 변환에 실패했습니다.'))),
      'image/png',
    ),
  );
  if (blob.size > LIMITS.imageBytes)
    throw new RangeError('PNG가 1MiB를 초과합니다. 내용을 줄여 다시 만들어주세요.');
  return blob;
}
export function downloadBlob(blob: Blob, name: string): void {
  const url: string = URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
