import type { Asset, Card, CardInput, DeliverySummary } from '../shared/model';
import { readPage, type Page } from './pagination';
import type { Env } from './types';

export async function cardPage(env: Env, cursor: string | null): Promise<Page<Card>> {
  const page = await readPage<Omit<Card, 'content'> & { content: string }>(
    env.DB,
    'SELECT *,created_at AS sort_key FROM cards WHERE 1=1',
    'created_at',
    cursor,
    100,
  );
  return {
    ...page,
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
export function deliveryPage(env: Env, cursor: string | null): Promise<Page<DeliverySummary>> {
  return readPage<DeliverySummary>(
    env.DB,
    'SELECT id,occurrence_id,schedule_id,position,state,mode,due_at_utc,attempts,error,updated_at,confirmed_by_user,resolution,(SELECT count(*) FROM delivery_attempts a WHERE a.delivery_id=d.id) AS total_attempts,(SELECT state FROM occurrence_results o WHERE o.id=d.occurrence_id) AS occurrence_state,due_at_utc AS sort_key FROM deliveries d WHERE 1=1',
    'due_at_utc',
    cursor,
    100,
  );
}
