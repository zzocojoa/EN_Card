import type { Asset, Card, CardInput, DeliverySummary } from '../shared/model';
import { readPage, type Page } from './pagination';
import type { Env } from './types';
import { cardFilterSchema, deliveryFilterSchema, type HomeSummary } from '../shared/catalog';

export type CatalogPage<T> = Page<T> & { total: number };
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
  const page = await readPage<Omit<Card, 'content'> & { content: string }>(
    env.DB,
    `SELECT *,created_at AS sort_key FROM cards WHERE ${where}`,
    'created_at',
    cursor,
    100,
    parameters,
  );
  const count = await env.DB.prepare(`SELECT count(*) AS total FROM cards WHERE ${where}`)
    .bind(...parameters)
    .first<{ total: number }>();
  return {
    ...page,
    total: count!.total,
    items: page.items.map((card) => ({ ...card, content: JSON.parse(card.content) as CardInput })),
  };
}
export function assetPage(env: Env, cursor: string | null): Promise<Page<Asset>> {
  return readPage<Asset>(
    env.DB,
    "SELECT id,card_id,revision,public_id,bytes,state,created_at,json_extract(snapshot,'$.expression') AS expression,created_at AS sort_key FROM assets WHERE state!='deleted'",
    'created_at',
    cursor,
    100,
  );
}
const ATTENTION = "resolution IS NULL AND state IN ('sending','unknown','failed','blocked')";
export async function deliveryPage(
  env: Env,
  cursor: string | null,
  filters: unknown = {},
): Promise<CatalogPage<DeliverySummary>> {
  const { filter } = deliveryFilterSchema.parse(filters);
  const where = filter === 'attention' ? ATTENTION : '1=1';
  const page = await readPage<DeliverySummary>(
    env.DB,
    `SELECT id,occurrence_id,schedule_id,position,state,mode,due_at_utc,attempts,error,updated_at,confirmed_by_user,resolution,coalesce(json_extract(payload,'$.content.title'),'제목 없는 카드') AS card_title,(SELECT name FROM schedules s WHERE s.id=d.schedule_id) AS schedule_name,(SELECT count(*) FROM delivery_attempts a WHERE a.delivery_id=d.id) AS total_attempts,(SELECT state FROM occurrence_results o WHERE o.id=d.occurrence_id) AS occurrence_state,due_at_utc AS sort_key FROM deliveries d WHERE ${where}`,
    'due_at_utc',
    cursor,
    100,
  );
  const count = await env.DB.prepare(
    `SELECT count(*) AS total FROM deliveries WHERE ${where}`,
  ).first<{ total: number }>();
  return { ...page, total: count!.total };
}

export async function homeSummary(env: Env): Promise<HomeSummary> {
  const [counts, next] = await Promise.all([
    env.DB.prepare(
      `SELECT
      (SELECT count(*) FROM cards c JOIN assets a ON a.id=c.asset_id AND a.revision=c.revision WHERE c.status='ready' AND a.state='ready') AS ready_cards,
      (SELECT count(*) FROM deliveries WHERE ${ATTENTION}) AS attention,
      (SELECT count(*) FROM deliveries WHERE state='sent' AND mode='live' AND confirmed_by_user=0) AS api_accepted`,
    ).first<Omit<HomeSummary, 'next_schedule'>>(),
    env.DB.prepare(
      'SELECT id,name,next_run_at_utc AS due_at_utc,cards_per_occurrence FROM schedules WHERE enabled=1 AND next_run_at_utc IS NOT NULL ORDER BY next_run_at_utc,id LIMIT 1',
    ).first<HomeSummary['next_schedule']>(),
  ]);
  return { ...counts!, next_schedule: next };
}
