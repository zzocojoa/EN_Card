import { validPng } from './png-fixture';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { CardInput, ScheduleInput } from '../src/shared/model';
import { kstDate } from '../src/shared/time';
import { saveSchedule } from '../src/worker/schedules';
import { reviewCard, saveCard, uploadImage } from '../src/worker/storage';
import type { Env } from '../src/worker/types';

export const NOW: number = Date.parse('2026-09-28T03:00:00Z');
export const SAMPLE: CardInput = {
  template: 'expression',
  expression: 'Take your time',
  meaning_ko: '천천히 해',
  example_en: 'Take your time. We can leave later.',
  example_ko: '천천히 해. 나중에 출발해도 돼.',
};
export type Harness = { mf: Miniflare; env: Env };
export async function harness(): Promise<Harness> {
  return harnessThrough('9999');
}
export async function harnessThrough(lastMigration: string): Promise<Harness> {
  const mf: Miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: '2026-09-01',
      d1Databases: { DB: crypto.randomUUID() },
      kvNamespaces: ['CARD_IMAGES'],
    }),
  );
  const db = await mf.getD1Database('DB');
  const env: Env = {
    DB: db as unknown as D1Database,
    CARD_IMAGES: (await mf.getKVNamespace('CARD_IMAGES')) as unknown as KVNamespace,
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    APP_ORIGIN: 'https://cards.example.test',
    COST_MODE: 'free_only',
    SEND_MODE: 'dry_run',
    SETUP_TOKEN: 'test-setup-token-0000000000000000000000',
    SESSION_SECRET: 'test-session-secret-0000000000000000000',
    TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    KAKAO_REST_API_KEY: 'test-key',
    KAKAO_CLIENT_SECRET: 'test-secret',
  };
  const directory: URL = new URL('../migrations/', import.meta.url);
  const migrations: string[] = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && name <= lastMigration)
    .sort();
  for (const name of migrations) {
    const sql: string = await readFile(new URL(name, directory), 'utf8');
    await env.DB.exec(sql.replaceAll('\n', ' '));
  }
  if (lastMigration < '0014_card_automation.sql') {
    // Upgrade fixtures replay the historical engine before the newer schema exists.
    // Remove only newer SQL additions until their migrations run; current-schema tests use real SQL.
    let legacyCancellation = lastMigration < '0011_delivery_cancellation_reason.sql';
    let legacyAutomation = true;
    env.DB = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            if (legacyCancellation)
              sql = sql.replace(/,cancellation_reason=[\s\S]+?(?=,error=)/g, '');
            if (legacyAutomation)
              sql = sql.replace(
                / AND \(NOT EXISTS\(SELECT 1 FROM deliveries waiting JOIN automation_runs[\s\S]+?(?= ORDER BY due_at_utc,position LIMIT 1)/,
                '',
              );
            return target.prepare(sql);
          };
        if (key === 'exec')
          return async (sql: string) => {
            const result = await target.exec(sql);
            if (sql.includes('ADD COLUMN cancellation_reason')) legacyCancellation = false;
            if (sql.includes('CREATE TABLE automation_runs')) legacyAutomation = false;
            return result;
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  return { mf, env };
}
export function png(): Uint8Array<ArrayBuffer> {
  return validPng();
}
export async function readyCard(
  env: Env,
  now: number,
): Promise<{ cardId: string; assetId: string; publicId: string }> {
  const card = await saveCard(SAMPLE, null, null, env, now);
  const result: Response = await uploadImage(
    new Request(`${env.APP_ORIGIN}/api/cards/${card.id}/image`, {
      method: 'POST',
      headers: { 'X-Card-Revision': '1' },
      body: png(),
    }),
    card.id,
    env,
    now,
  );
  const asset = (await result.json()) as { id: string; public_id: string };
  await reviewCard(card.id, asset.id, 1, env);
  return { cardId: card.id, assetId: asset.id, publicId: asset.public_id };
}
export async function dueSchedule(env: Env, count: number, now: number): Promise<string> {
  const assets = await Promise.all(
    Array.from({ length: count }, () => readyCard(env, now - 300_000)),
  );
  const data: ScheduleInput = {
    name: '아침 카드',
    kind: 'once',
    date: kstDate(now),
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: count,
    asset_ids: assets.map((asset) => asset.assetId),
  };
  const saved = await saveSchedule(data, null, null, env, now);
  await env.DB.prepare('UPDATE schedules SET next_run_at_utc=? WHERE id=?')
    .bind(now, saved.id)
    .run();
  return saved.id;
}
