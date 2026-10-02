import { z } from 'zod';
import { appError } from './types';

export type Page<T> = { items: T[]; next: string | null };
const cursorSchema = z.tuple([z.number().finite(), z.string().min(1).max(200)]);

export function pageFromRows<T extends { id: string }>(
  result: (T & { sort_key: number })[],
  size: number,
): Page<T> {
  const rows = result.slice(0, size);
  const last = rows.at(-1);
  return {
    items: rows,
    next: result.length > size && last ? JSON.stringify([last.sort_key, last.id]) : null,
  };
}

export async function readPage<T extends { id: string }>(
  db: D1Database,
  selection: string,
  orderColumn: string,
  cursor: string | null,
  size: number,
  parameters: (number | string)[] = [],
): Promise<Page<T>> {
  let boundary: [number, string] | null = null;
  if (cursor !== null) {
    try {
      boundary = cursorSchema.parse(JSON.parse(cursor) as unknown);
    } catch {
      throw appError(400, 'PAGE_CURSOR', '목록 위치가 잘못되었습니다. 새로고침하세요.');
    }
  }
  const condition: string = boundary
    ? ` AND (${orderColumn}<? OR (${orderColumn}=? AND id<?))`
    : '';
  const values: (number | string)[] = boundary
    ? [boundary[0], boundary[0], boundary[1], size + 1]
    : [size + 1];
  const result = await db
    .prepare(`${selection}${condition} ORDER BY ${orderColumn} DESC,id DESC LIMIT ?`)
    .bind(...parameters, ...values)
    .all<T & { sort_key: number }>();
  return pageFromRows(result.results, size);
}
