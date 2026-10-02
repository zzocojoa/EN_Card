import { afterEach, beforeEach, expect, it } from 'vitest';
import { consumeStudioOAuth, issueStudioOAuth } from '../src/worker/studio-bridge';
import { finishOAuth, prepareOAuth } from '../src/worker/auth';
import { handle } from '../src/worker/index';
import { encrypt } from '../src/worker/crypto';
import { harness, NOW, SAMPLE, type Harness } from './helpers';
import type { Transport } from '../src/worker/types';
let h: Harness;
beforeEach(async () => {
  h = await harness();
  Object.assign(h.env, {
    STUDIO_BRIDGE_SECRET: 'test-studio-server-secret-000000000000000',
    STUDIO_OWNER_ID: 'site-owner',
    STUDIO_ORIGIN: 'https://study.example.test',
  });
});
afterEach(async () => {
  await h.mf.dispose();
});
function request(path: string, init: RequestInit = {}) {
  const headers = new Headers({
    Authorization: `Bearer ${h.env.STUDIO_BRIDGE_SECRET}`,
    'X-Studio-User': 'site-owner',
    Origin: h.env.APP_ORIGIN,
    'Content-Type': 'application/json',
  });
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  return new Request(h.env.APP_ORIGIN + path, { ...init, headers });
}
it('trusted Sites owner can create and read cards without a browser session or SETUP_TOKEN', async () => {
  const created = await handle(
    request('/api/cards', { method: 'POST', body: JSON.stringify(SAMPLE) }),
    h.env,
  );
  expect(created.status).toBe(201);
  const state = await handle(request('/api/state'), h.env);
  expect(state.status).toBe(200);
  const body = (await state.json()) as { cards: unknown[] };
  expect(body.cards).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain(h.env.STUDIO_BRIDGE_SECRET);
  expect(state.headers.get('Set-Cookie')).toBeNull();
  expect((await handle(new Request(h.env.APP_ORIGIN + '/api/state'), h.env)).status).toBe(401);
});
it('forged identity, secret, origin and disabled configuration cannot write', async () => {
  for (const headers of [
    { 'X-Studio-User': 'another-user' },
    { Authorization: 'Bearer forged' },
    { Origin: 'https://evil.test' },
  ]) {
    expect(
      (
        await handle(
          request('/api/cards', { method: 'POST', body: JSON.stringify(SAMPLE), headers }),
          h.env,
        )
      ).status,
    ).toBe(403);
  }
  delete h.env.STUDIO_BRIDGE_SECRET;
  expect((await handle(request('/api/state'), h.env)).status).toBe(403);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM cards').first('n')).toBe(0);
});
it('Kakao reconnect tickets expire, are consumed once, and do not create sessions', async () => {
  const first = await issueStudioOAuth(h.env, NOW);
  const { url } = (await first.json()) as { url: string };
  expect(first.headers.get('Set-Cookie')).toBeNull();
  await consumeStudioOAuth(new Request(url), h.env, NOW + 1);
  await expect(consumeStudioOAuth(new Request(url), h.env, NOW + 2)).rejects.toMatchObject({
    code: 'STUDIO_TICKET',
  });
  const second = (await (await issueStudioOAuth(h.env, NOW)).json()) as { url: string };
  await expect(
    consumeStudioOAuth(new Request(second.url), h.env, NOW + 60_001),
  ).rejects.toMatchObject({ code: 'STUDIO_TICKET' });
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM auth_state WHERE kind='session'").first('n'),
  ).toBe(0);
});
it('integrated OAuth retains the Kakao owner check and returns only to the configured Site', async () => {
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?, ?,1,'connected')",
  )
    .bind(
      await encrypt('old-access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('old-refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW + 1000,
      NOW + 100000,
    )
    .run();
  async function callback(owner: number) {
    const start = await prepareOAuth(h.env, NOW, true);
    expect(start.status).toBe(303);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state');
    const transport: Transport = async (url) =>
      url.includes('/oauth/token')
        ? Response.json({
            access_token: 'access',
            expires_in: 3600,
            refresh_token: 'refresh',
            refresh_token_expires_in: 86400,
            scope: 'talk_message',
          })
        : Response.json({ id: owner });
    return finishOAuth(
      new Request(`${h.env.APP_ORIGIN}/auth/callback?state=${state}&code=test`, {
        headers: { Cookie: start.headers.get('Set-Cookie')!.split(';')[0]! },
      }),
      h.env,
      NOW + 1,
      transport,
    );
  }
  await expect(callback(99)).rejects.toMatchObject({ code: 'NOT_OWNER' });
  expect(await h.env.DB.prepare('SELECT owner_id FROM credentials').first('owner_id')).toBe('42');
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM auth_state WHERE kind='session'").first('n'),
  ).toBe(0);
  const success = await callback(42);
  expect(success.headers.get('Location')).toBe('https://study.example.test/cards');
  expect(success.headers.get('Set-Cookie')).toContain('en_session=');
});
it('existing public images and ordinary browser authentication stay independent', async () => {
  expect((await handle(new Request(h.env.APP_ORIGIN + '/api/boot'), h.env)).status).toBe(200);
  expect(
    (await handle(new Request(h.env.APP_ORIGIN + '/images/' + 'a'.repeat(64) + '.png'), h.env))
      .status,
  ).toBe(404);
  expect(
    (await handle(new Request(h.env.APP_ORIGIN + '/auth/studio?ticket=invalid'), h.env)).status,
  ).toBe(403);
});
