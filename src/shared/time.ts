import type { ScheduleInput } from './model';

const OFFSET_MS: number = 9 * 60 * 60_000;
const DAY_MS: number = 24 * 60 * 60_000;
export function kstDate(timestamp: number): string {
  return new Date(timestamp + OFFSET_MS).toISOString().slice(0, 10);
}
export function kstToUtc(date: string, time: string): number {
  const value: number = Date.parse(`${date}T${time}:00+09:00`);
  if (
    !Number.isFinite(value) ||
    new Date(value + OFFSET_MS).toISOString().slice(0, 16) !== `${date}T${time}`
  )
    throw new RangeError('존재하지 않는 한국 날짜 또는 시각입니다.');
  return value;
}
export function nextRun(
  schedule: Pick<ScheduleInput, 'kind' | 'date' | 'time' | 'weekdays' | 'end_date'>,
  after: number,
): number | null {
  const start: number = kstToUtc(schedule.date, schedule.time);
  const end: number = schedule.end_date
    ? kstToUtc(schedule.end_date, '23:59')
    : Number.POSITIVE_INFINITY;
  if (schedule.kind === 'once') return start > after && start <= end ? start : null;
  const firstDate: string = kstDate(Math.max(start, after));
  const candidate: number = kstToUtc(firstDate, schedule.time);
  for (let offset: number = 0; offset < 8; offset += 1) {
    const value: number = candidate + offset * DAY_MS;
    const weekday: number = new Date(value + OFFSET_MS).getUTCDay();
    if (
      value >= start &&
      value > after &&
      value <= end &&
      (schedule.kind === 'daily' || schedule.weekdays.includes(weekday))
    )
      return value;
  }
  return null;
}
export function formatKst(timestamp: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}
