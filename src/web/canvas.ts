import { LIMITS, cardSchema, type CardInput } from '../shared/model';
import { cardDeliveryStamp } from '../shared/card-stamp';
import { CARD_FONT, layoutCard, layoutCardHeader } from '../shared/card-layout';

export async function renderCard(
  card: CardInput,
  number: number,
  scheduledAt?: number,
): Promise<HTMLCanvasElement> {
  const input: CardInput = cardSchema.parse(card);
  const stamp = scheduledAt === undefined ? null : cardDeliveryStamp(scheduledAt);
  const text: string = `${Object.values(input).join(' ')} ${stamp ? `${stamp.date} ${stamp.weekday.name} ${stamp.time} ${stamp.label}` : ''}`;
  await Promise.all([
    document.fonts.load(`450 32px ${CARD_FONT}`, text),
    document.fonts.load(`800 82px ${CARD_FONT}`, text),
  ]);
  await document.fonts.ready;
  if (!document.fonts.check(`450 32px ${CARD_FONT}`, text))
    throw new Error('한글 폰트를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.');
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (!context) throw new Error('브라우저에서 Canvas 2D를 사용할 수 없습니다.');
  const measure = (text: string, font: string) => {
    context.font = font;
    return context.measureText(text).width;
  };
  const layout = layoutCard(measure, input);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1080, 1080);
  context.textBaseline = 'top';
  const header = layoutCardHeader(measure, input, number, stamp);
  for (const rect of header.rects) {
    context.fillStyle = rect.color;
    context.beginPath();
    context.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
    context.fill();
  }
  if (layout.dividerY !== null) {
    context.fillStyle = '#e3e7ef';
    context.fillRect(88, layout.dividerY, 904, 2);
  }
  for (const line of [...header.lines, ...layout.lines]) {
    context.font = `${line.weight} ${line.size}px ${CARD_FONT}`;
    context.fillStyle = line.color;
    context.fillText(line.text, line.x, line.y);
  }
  context.fillStyle = '#7b8492';
  context.font = `400 20px ${CARD_FONT}`;
  context.fillText('하루 한 표현', 88, 1015);
  return canvas;
}
export async function validateBackup(blob: Blob): Promise<void> {
  if (blob.type !== 'image/png' || blob.size > LIMITS.imageBytes)
    throw new Error('1MiB 이하 PNG 파일을 선택하세요.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('PNG를 읽을 수 없습니다. 손상되지 않은 이미지 파일을 선택하세요.');
  }
  const valid: boolean = bitmap.width === 1080 && bitmap.height === 1080;
  bitmap.close();
  if (!valid) throw new Error('1080×1080 PNG 파일을 선택하세요.');
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
