import type { Asset, Card, DeliverySummary, Schedule, SendMode } from '../shared/model';

export type Collection = 'cards' | 'assets' | 'schedules' | 'deliveries';
export type AttemptHistory = {
  attempts: {
    id: string;
    started_at: number;
    outcome: string;
    detail: string | null;
    mode: SendMode;
  }[];
  decisions: { action: 'confirm_sent' | 'retry'; created_at: number; warning_accepted: number }[];
};
export type AppState = {
  csrf: string;
  cards: Card[];
  assets: Asset[];
  schedules: Schedule[];
  deliveries: DeliverySummary[];
  cursors: Record<Collection, string | null>;
  totals: Record<Collection, number> & { active_schedules: number };
  previews: {
    id: string;
    schedule_id: string;
    due_at_utc: number;
    detail: string;
    created_at: number;
  }[];
  usage: { day: string; uploads: number; sends: number; bytes: number }[];
  connection: { status: string; expires_at: number; refresh_expires_at: number } | null;
  mode: SendMode;
  now: number;
};
export type Boot = { local: boolean; mode: SendMode; kakao_configured: boolean };
export async function api(
  path: string,
  method: string,
  body: unknown,
  csrf: string,
): Promise<unknown> {
  const response: Response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as { message?: string; details?: { index: number; message: string }[] };
    throw Object.assign(
      new Error(
        `${error.message ?? `HTTP ${response.status}`}${error.details ? ' ' + error.details.map((item) => `${item.index + 1}번째: ${item.message}`).join(' / ') : ''}`,
      ),
      { status: response.status },
    );
  }
  return result;
}
export async function upload(
  cardId: string,
  revision: number,
  blob: Blob,
  csrf: string,
): Promise<{ id: string; public_id: string }> {
  const response: Response = await fetch(`/api/cards/${cardId}/image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-Card-Revision': String(revision),
      'X-CSRF-Token': csrf,
    },
    body: blob,
  });
  const result = (await response.json()) as { id: string; public_id: string; message?: string };
  if (!response.ok)
    throw Object.assign(new Error(result.message ?? '이미지 업로드에 실패했습니다.'), {
      status: response.status,
    });
  return result;
}
