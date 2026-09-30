import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import production from '../src/worker/index';
import delivery from '../src/worker/delivery-service';
import { encrypt } from '../src/worker/crypto';
import { dueSchedule, harness, NOW, type Harness } from './helpers';
import type { Env } from '../src/worker/types';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await h.mf.dispose();
});
async function live(): Promise<Env> {
  const token = await encrypt('synthetic-private-delivery-token', h.env.TOKEN_ENCRYPTION_KEY);
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'fixture',?,?,?,?,1,'connected')",
  )
    .bind(token, token, NOW + 3600_000, NOW + 86400_000)
    .run();
  return { ...h.env, SEND_MODE: 'live' };
}
function provider(): string[] {
  const images: string[] = [];
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === 'https://kapi.kakao.com/v2/api/talk/memo/default/send') {
      const data = JSON.parse(new URLSearchParams(String(init?.body)).get('template_object')!);
      images.push(data.content.image_url);
      return Response.json({ result_code: 0 });
    }
    return original(input, init);
  });
  return images;
}
function binding(
  env: Env,
  mutate?: (request: Request, response: Response) => Promise<Response>,
): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const response = await delivery.fetch(request, env);
      return mutate ? mutate(request, response) : response;
    },
  } as unknown as Fetcher;
}
it('운영 live는 비공개 발송 바인딩 없이 직접 발송하지 않는다', async () => {
  const env = await live();
  await dueSchedule(env, 1, NOW);
  await expect(production.scheduled({} as ScheduledController, env)).rejects.toThrow('비공개 발송');
  expect(await env.DB.prepare('SELECT count(*) FROM occurrences').first('count(*)')).toBe(0);
});
it('발송 Worker는 허용한 POST 두 경로와 무료 live 설정만 받는다', async () => {
  const env = await live();
  expect(
    (await delivery.fetch(new Request(env.APP_ORIGIN + '/_internal/deliver'), env)).status,
  ).toBe(404);
  expect(
    (await delivery.fetch(new Request(env.APP_ORIGIN + '/other', { method: 'POST' }), env)).status,
  ).toBe(404);
  await expect(
    delivery.fetch(new Request(env.APP_ORIGIN + '/_internal/prepare', { method: 'POST' }), {
      ...env,
      COST_MODE: 'paid',
    }),
  ).rejects.toThrow('무료');
});
it('운영 Cron과 내부 HTTP 발송 Worker의 실제 진입점을 연결해 세 장을 한 번씩 처리한다', async () => {
  const env = await live();
  await dueSchedule(env, 3, NOW);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const images = provider(),
    paths: string[] = [];
  env.DELIVERY_SERVICE = binding(env, async (request, response) => {
    paths.push(new URL(request.url).pathname);
    return response;
  });
  await production.scheduled({} as ScheduledController, env);
  expect(paths).toEqual(['/_internal/prepare', ...Array(3).fill('/_internal/deliver')]);
  expect(images).toHaveLength(3);
  expect(new Set(images).size).toBe(3);
  expect(
    await env.DB.prepare("SELECT count(*) FROM deliveries WHERE state='sent'").first('count(*)'),
  ).toBe(3);
  expect(await env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(3);
});
it('자식의 성공 저장 뒤 HTTP 응답 유실은 직접 재발송하지 않고 다음 카드만 이어 간다', async () => {
  const env = await live();
  await dueSchedule(env, 3, NOW);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const images = provider();
  let lost = false;
  env.DELIVERY_SERVICE = binding(env, async (request, response) => {
    if (new URL(request.url).pathname === '/_internal/deliver' && !lost) {
      lost = true;
      throw new Error('Internal response lost');
    }
    return response;
  });
  await production.scheduled({} as ScheduledController, env);
  expect(images).toHaveLength(1);
  clock.mockReturnValue(NOW + 61_000);
  await production.scheduled({} as ScheduledController, env);
  expect(images).toHaveLength(3);
  expect(new Set(images).size).toBe(3);
  expect(await env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(3);
});
it('자식의 성공 뒤 잘못된 처리 응답도 성공 카드를 재발송하지 않는다', async () => {
  const env = await live();
  await dueSchedule(env, 1, NOW);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const images = provider();
  env.DELIVERY_SERVICE = binding(env, async (request, response) =>
    new URL(request.url).pathname === '/_internal/deliver'
      ? Response.json({ processed: 2, reuseGrant: true, stop: false })
      : response,
  );
  await production.scheduled({} as ScheduledController, env);
  clock.mockReturnValue(NOW + 61_000);
  await production.scheduled({} as ScheduledController, env);
  expect(images).toHaveLength(1);
  expect(await env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('sent');
});
