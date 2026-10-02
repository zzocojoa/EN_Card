import type { Asset, DeliverySummary } from '../shared/model';
import type { HomeSummary } from '../shared/catalog';
import { kstDate } from '../shared/time';
import {
  ASSET_SELECTION,
  CARD_SELECTION,
  DELIVERY_SELECTION,
  HOME_COUNTS,
  NEXT_SCHEDULE,
  decodeCard,
  type CardRow,
} from './catalog';
import { pageFromRows } from './pagination';
import { SCHEDULE_SELECTION, decodeScheduleCatalog, type ScheduleCatalogRow } from './schedules';
import { appError, type Env } from './types';

type Totals = Record<'cards' | 'assets' | 'schedules' | 'active_schedules' | 'deliveries', number>;

export async function readStudioState(env: Env, now: number) {
  // One D1 round trip reduces CPU spent unpacking binding responses.
  // Page endpoints share these selectors and decoders, including the cursor sentinel.
  const page = (selection: string, order: string) =>
    env.DB.prepare(`${selection} ORDER BY ${order} DESC,id DESC LIMIT 101`);
  const [cards, assets, schedules, deliveries, previews, usage, connection, counts, next] =
    await env.DB.batch([
      page(CARD_SELECTION + '1=1', 'created_at'),
      page(ASSET_SELECTION, 'created_at'),
      page(SCHEDULE_SELECTION, 'enabled'),
      page(DELIVERY_SELECTION + '1=1', 'due_at_utc'),
      env.DB.prepare(
        'SELECT id,schedule_id,due_at_utc,detail,created_at FROM dry_runs ORDER BY created_at DESC LIMIT 50',
      ),
      env.DB.prepare("SELECT * FROM usage_counters WHERE day IN (?,'storage')").bind(kstDate(now)),
      env.DB.prepare(
        'SELECT status,expires_at,refresh_expires_at,version,refresh_attempts,refresh_retry_at,refresh_failure,refresh_http_status,refresh_provider_error,refresh_provider_code FROM credentials WHERE singleton=1',
      ),
      env.DB.prepare(
        `SELECT (SELECT count(*) FROM cards) AS cards,(SELECT count(*) FROM assets WHERE state!='deleted') AS assets,(SELECT count(*) FROM schedules) AS schedules,(SELECT count(*) FROM schedules WHERE enabled=1) AS active_schedules,(SELECT count(*) FROM deliveries) AS deliveries,${HOME_COUNTS}`,
      ),
      env.DB.prepare(NEXT_SCHEDULE),
    ]);
  if (
    !cards ||
    !assets ||
    !schedules ||
    !deliveries ||
    !previews ||
    !usage ||
    !connection ||
    !counts?.results[0] ||
    !next
  )
    throw appError(503, 'STATE_READ', '작업실 정보를 읽지 못했습니다. 다시 시도해 주세요.');
  const cardPage = pageFromRows(cards.results as (CardRow & { sort_key: number })[], 100);
  const assetPage = pageFromRows(assets.results as (Asset & { sort_key: number })[], 100);
  const schedulePage = pageFromRows(
    schedules.results as (ScheduleCatalogRow & { sort_key: number })[],
    100,
  );
  const deliveryPage = pageFromRows(
    deliveries.results as (DeliverySummary & { sort_key: number })[],
    100,
  );
  const { ready_cards, attention, api_accepted, ...totals } = counts.results[0] as Totals &
    Omit<HomeSummary, 'next_schedule'>;
  return {
    summary: {
      ready_cards,
      attention,
      api_accepted,
      next_schedule: (next.results[0] ?? null) as HomeSummary['next_schedule'],
    },
    cards: cardPage.items.map(decodeCard),
    assets: assetPage.items,
    schedules: schedulePage.items.map(decodeScheduleCatalog),
    deliveries: deliveryPage.items,
    cursors: {
      cards: cardPage.next,
      assets: assetPage.next,
      schedules: schedulePage.next,
      deliveries: deliveryPage.next,
    },
    totals,
    previews: previews.results,
    usage: usage.results,
    connection: connection.results[0] ?? null,
  };
}
