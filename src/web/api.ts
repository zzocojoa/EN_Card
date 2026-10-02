import type { Asset, Card, DeliverySummary, Schedule, SendMode } from '../shared/model';
import type { HomeSummary } from '../shared/catalog';

export type Collection = 'cards' | 'assets' | 'schedules' | 'deliveries';
export type AttemptHistory = {
  attempts: {
    id: string;
    started_at: number;
    outcome: string;
    detail: string | null;
    mode: SendMode;
  }[];
  decisions: {
    action: 'confirm_sent' | 'retry' | 'abandon';
    created_at: number;
    warning_accepted: number;
  }[];
};
export type AppState = {
  summary: HomeSummary;
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
  connection: {
    status: string;
    expires_at: number;
    refresh_expires_at: number;
    version: number;
    refresh_attempts: number;
    refresh_retry_at: number | null;
    refresh_failure: 'invalid' | 'transient' | 'uncertain' | 'configuration' | 'exhausted' | null;
    refresh_http_status: number | null;
    refresh_provider_error: string | null;
    refresh_provider_code: string | null;
  } | null;
  mode: SendMode;
  now: number;
};
export type Boot = { local: boolean; mode: SendMode; kakao_configured: boolean };
export async function api(
  path: string,
  method: string,
  body: unknown,
  csrf: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response: Response = await fetch(path, {
    method,
    ...(signal ? { signal } : {}),
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as {
      error?: string;
      message?: string;
      details?: { index: number; message: string }[];
    };
    throw Object.assign(
      new Error(
        `${error.message ?? `HTTP ${response.status}`}${error.details ? ' ' + error.details.map((item) => `${item.index + 1}번째: ${item.message}`).join(' / ') : ''}`,
      ),
      { status: response.status, code: error.error },
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
