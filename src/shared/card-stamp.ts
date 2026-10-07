// Sunday-first, matching getUTCDay(). Text names accompany color everywhere.
export const CARD_WEEKDAYS = [
  { name: '일요일', color: '#B42318', background: '#FEF3F2' },
  { name: '월요일', color: '#6941C6', background: '#F4F3FF' },
  { name: '화요일', color: '#175CD3', background: '#EFF8FF' },
  { name: '수요일', color: '#067647', background: '#ECFDF3' },
  { name: '목요일', color: '#93370D', background: '#FFFAEB' },
  { name: '금요일', color: '#C11574', background: '#FDF2FA' },
  { name: '토요일', color: '#0E7090', background: '#ECFDFF' },
] as const;

export type CardDeliveryStamp = ReturnType<typeof cardDeliveryStamp>;

export function cardDeliveryStamp(scheduledAt: number) {
  // Use the immutable run due time, never the render/retry time or device timezone.
  const date = new Date(scheduledAt + 9 * 60 * 60_000);
  const year = date.getUTCFullYear();
  if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= 0 || !(year >= 1000 && year <= 9999))
    throw new RangeError('카드의 발송 예정 시각을 확인하세요.');
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${year}년 ${pad(date.getUTCMonth() + 1)}월 ${pad(date.getUTCDate())}일`,
    time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    weekday: CARD_WEEKDAYS[date.getUTCDay()]!,
    label: '최초 발송 예정 · 한국 시간',
  };
}
