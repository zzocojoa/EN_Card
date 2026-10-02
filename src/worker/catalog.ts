import type { Asset, Card, CardInput, DeliverySummary } from '../shared/model';
import { pageFromRows, preparePage, readPage, type Page } from './pagination';
import type { Env } from './types';
import { appError } from './types';
import { cardFilterSchema, deliveryFilterSchema, type HomeSummary } from '../shared/catalog';

export type CatalogPage<T> = Page<T> & { total: number };
export type CardRow = Omit<Card, 'content'> & { content: string };
export const CARD_SELECTION = 'SELECT *,created_at AS sort_key FROM cards WHERE ';
export const ASSET_SELECTION =
  "SELECT id,card_id,revision,public_id,bytes,state,created_at,json_extract(snapshot,'$.expression') AS expression,created_at AS sort_key FROM assets WHERE state!='deleted'";
export const DELIVERY_SELECTION =
  "SELECT id,occurrence_id,schedule_id,position,state,mode,due_at_utc,attempts,error,updated_at,confirmed_by_user,resolution,coalesce(json_extract(payload,'$.content.title'),'제목 없는 카드') AS card_title,(SELECT name FROM schedules s WHERE s.id=d.schedule_id) AS schedule_name,(SELECT count(*) FROM delivery_attempts a WHERE a.delivery_id=d.id) AS total_attempts,(SELECT state FROM occurrence_results o WHERE o.id=d.occurrence_id) AS occurrence_state,due_at_utc AS sort_key FROM deliveries d WHERE ";
export const ATTENTION = "resolution IS NULL AND state IN ('sending','unknown','failed','blocked')";
export const HOME_COUNTS = `(SELECT count(*) FROM cards c JOIN assets a ON a.id=c.asset_id AND a.revision=c.revision WHERE c.status='ready' AND a.state='ready') AS ready_cards,
  (SELECT count(*) FROM deliveries WHERE ${ATTENTION}) AS attention,
  (SELECT count(*) FROM deliveries WHERE state='sent' AND mode='live' AND confirmed_by_user=0) AS api_accepted`;
export const NEXT_SCHEDULE =
  'SELECT id,name,next_run_at_utc AS due_at_utc,cards_per_occurrence FROM schedules WHERE enabled=1 AND next_run_at_utc IS NOT NULL ORDER BY next_run_at_utc,id LIMIT 1';
export function decodeCard(card: CardRow): Card {
  return { ...card, content: JSON.parse(card.content) as CardInput };
}
export async function cardPage(
  env: Env,
  cursor: string | null,
  filters: unknown = {},
): Promise<CatalogPage<Card>> {
  const { q, status, template } = cardFilterSchema.parse(filters);
  const conditions = ['1=1'];
  const parameters: string[] = [];
  if (q) {
    conditions.push(
      "(instr(lower(json_extract(content,'$.expression')),lower(?))>0 OR instr(lower(json_extract(content,'$.meaning_ko')),lower(?))>0)",
    );
    parameters.push(q, q);
  }
  if (status !== 'all') {
    conditions.push('status=?');
    parameters.push(status);
  }
  if (template !== 'all') {
    conditions.push("json_extract(content,'$.template')=?");
    parameters.push(template);
  }
  const where = conditions.join(' AND ');
  const [rows, count] = await env.DB.batch([
    preparePage(env.DB, CARD_SELECTION + where, 'created_at', cursor, 100, parameters),
    env.DB.prepare(`SELECT count(*) AS total FROM cards WHERE ${where}`).bind(...parameters),
  ]);
  if (!rows || !count?.results[0])
    throw appError(503, 'CATALOG_READ', '카드 목록을 읽지 못했습니다. 다시 시도해 주세요.');
  const page = pageFromRows(rows.results as (CardRow & { sort_key: number })[], 100);
  return {
    ...page,
    total: (count.results[0] as { total: number }).total,
    items: page.items.map(decodeCard),
  };
}
export function assetPage(env: Env, cursor: string | null): Promise<Page<Asset>> {
  return readPage<Asset>(env.DB, ASSET_SELECTION, 'created_at', cursor, 100);
}
export async function deliveryPage(
  env: Env,
  cursor: string | null,
  filters: unknown = {},
): Promise<CatalogPage<DeliverySummary>> {
  const { filter } = deliveryFilterSchema.parse(filters);
  const where = filter === 'attention' ? ATTENTION : '1=1';
  const [rows, count] = await env.DB.batch([
    preparePage(env.DB, DELIVERY_SELECTION + where, 'due_at_utc', cursor, 100),
    env.DB.prepare(`SELECT count(*) AS total FROM deliveries WHERE ${where}`),
  ]);
  if (!rows || !count?.results[0])
    throw appError(503, 'CATALOG_READ', '발송 기록을 읽지 못했습니다. 다시 시도해 주세요.');
  const page = pageFromRows(rows.results as (DeliverySummary & { sort_key: number })[], 100);
  return { ...page, total: (count.results[0] as { total: number }).total };
}

export async function homeSummary(env: Env): Promise<HomeSummary> {
  const [counts, next] = await Promise.all([
    env.DB.prepare(`SELECT ${HOME_COUNTS}`).first<Omit<HomeSummary, 'next_schedule'>>(),
    env.DB.prepare(NEXT_SCHEDULE).first<HomeSummary['next_schedule']>(),
  ]);
  return { ...counts!, next_schedule: next };
}
