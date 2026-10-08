import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  accessToken,
  beginOAuth,
  createSession,
  disconnect,
  finishOAuth,
  markReconnect,
  requireSession,
} from '../src/worker/auth';
import { decrypt, digest, encrypt } from '../src/worker/crypto';
import { consumeStudioOAuth, issueStudioOAuth } from '../src/worker/studio-bridge';
import { handle } from '../src/worker/index';
import type { Credentials, Transport } from '../src/worker/types';
import { harness, harnessThrough, NOW, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.mf.dispose();
});

async function connected(): Promise<void> {
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?, ?,1,'connected')",
  )
    .bind(
      await encrypt('original-access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('original-refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW - 1,
      NOW + 86400_000,
    )
    .run();
}

async function callback(env = h.env): Promise<Request> {
  const started = await beginOAuth(
    new Request(`${env.APP_ORIGIN}/auth/start`, {
      method: 'POST',
      headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: env.SETUP_TOKEN }),
    }),
    env,
    NOW,
  );
  const body = (await started.json()) as { url: string };
  const state = new URL(body.url).searchParams.get('state')!;
  return new Request(`${env.APP_ORIGIN}/auth/callback?code=synthetic-code&state=${state}`, {
    headers: { Cookie: started.headers.get('Set-Cookie')!.split(';')[0]! },
  });
}

function transport(label: string): Transport {
  return async (url) =>
    url.includes('/oauth/token')
      ? Response.json({
          access_token: `${label}-access`,
          expires_in: 3600,
          refresh_token: `${label}-refresh`,
          refresh_token_expires_in: 86400,
          scope: 'talk_message',
        })
      : Response.json({ id: 42 });
}

it.each(['first', 'connected'] as const)(
  'the studio route issues OAuth for unchanged %s identity',
  async (state) => {
    if (state === 'connected') await connected();
    const env = {
      ...h.env,
      STUDIO_ORIGIN: 'https://studio.example.test',
      STUDIO_OWNER_ID: 'synthetic-owner',
      STUDIO_BRIDGE_SECRET: 'synthetic-bridge-secret-000000000000000000',
    };
    const ticket = (await (await issueStudioOAuth(env, NOW)).json()) as { url: string };
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 1);
    const response = await handle(new Request(ticket.url), env);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('Location')!).origin).toBe('https://kauth.kakao.com');
    expect(
      await env.DB.prepare("SELECT credential_version FROM auth_state WHERE kind='oauth'").first(
        'credential_version',
      ),
    ).toBe(state === 'first' ? null : 1);
  },
);

it('0022 preserves stored rows and sessions while legacy OAuth cannot replace existing credentials', async () => {
  const old = await harnessThrough('0021_automation_quality_replacement.sql');
  try {
    await old.env.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?, ?,7,'connected')",
    )
      .bind(NOW + 3600000, NOW + 86400000)
      .run();
    const session = await createSession(old.env, NOW);
    const state = 'synthetic-legacy-state';
    const browser = 'synthetic-legacy-browser';
    await old.env.DB.prepare(
      "INSERT INTO auth_state(id,kind,browser_hash,expires_at) VALUES(?,'oauth',?,?)",
    )
      .bind(
        await digest(state, old.env.SESSION_SECRET),
        await digest(browser, old.env.SESSION_SECRET),
        NOW + 600000,
      )
      .run();
    const rows = (await old.env.DB.prepare('SELECT * FROM auth_state ORDER BY id').all()).results;
    const credential = await old.env.DB.prepare('SELECT * FROM credentials').first();
    const sql = await readFile(
      new URL('../migrations/0022_oauth_credential_generation.sql', import.meta.url),
      'utf8',
    );
    await old.env.DB.exec(sql.replaceAll('\n', ' '));
    expect(
      (await old.env.DB.prepare('SELECT * FROM auth_state ORDER BY id').all()).results,
    ).toEqual(rows.map((row) => ({ ...row, credential_version: null })));
    expect(await old.env.DB.prepare('SELECT * FROM credentials').first()).toEqual(credential);
    expect(
      await requireSession(
        new Request(`${old.env.APP_ORIGIN}/api/state`, {
          headers: { Cookie: `en_session=${session.token}` },
        }),
        old.env,
        NOW + 1,
      ),
    ).toMatchObject({ csrf: session.csrf });
    const provider = vi.fn(transport('legacy'));
    await expect(
      finishOAuth(
        new Request(`${old.env.APP_ORIGIN}/auth/callback?state=${state}&code=synthetic`, {
          headers: { Cookie: `en_oauth=${browser}` },
        }),
        old.env,
        NOW + 1,
        provider,
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE' });
    expect(provider).not.toHaveBeenCalled();
    expect(
      (await finishOAuth(await callback(old.env), old.env, NOW + 2, transport('fresh'))).status,
    ).toBe(303);
  } finally {
    await old.mf.dispose();
  }
});

it.each(['disconnect', 'reconnect_required'] as const)(
  '%s invalidates OAuth flows and studio tickets issued before revocation',
  async (change) => {
    await connected();
    const request = await callback();
    await createSession(h.env, NOW);
    const env = {
      ...h.env,
      STUDIO_ORIGIN: 'https://studio.example.test',
      STUDIO_OWNER_ID: 'synthetic-owner',
      STUDIO_BRIDGE_SECRET: 'synthetic-bridge-secret-000000000000000000',
    };
    const ticket = (await (await issueStudioOAuth(env, NOW)).json()) as { url: string };
    if (change === 'disconnect') await disconnect(env, NOW + 1);
    else await markReconnect(env, 1, NOW + 1);
    const snapshot = await env.DB.prepare('SELECT * FROM credentials').first();
    const provider = vi.fn(transport('stale'));
    await expect(finishOAuth(request, env, NOW + 2, provider)).rejects.toMatchObject({
      code: 'OAUTH_STATE',
    });
    expect(provider).not.toHaveBeenCalled();
    await expect(consumeStudioOAuth(new Request(ticket.url), env, NOW + 2)).rejects.toMatchObject({
      code: 'STUDIO_TICKET',
    });
    expect(await env.DB.prepare('SELECT * FROM credentials').first()).toEqual(snapshot);
    // Revoking the send connection is not an app logout.
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM auth_state WHERE kind='session'").first('n'),
    ).toBe(1);
    expect((await finishOAuth(await callback(), env, NOW + 3, transport('fresh'))).status).toBe(
      303,
    );
  },
);

it('a stale reconnect failure does not invalidate a newer pending OAuth flow', async () => {
  await connected();
  const request = await callback();
  expect(await markReconnect(h.env, 0, NOW + 1)).toBe(false);
  expect((await finishOAuth(request, h.env, NOW + 2, transport('accepted'))).status).toBe(303);
});

it('a repeated old revocation preserves OAuth started in the needs_reconnect generation', async () => {
  await connected();
  expect(await markReconnect(h.env, 1, NOW)).toBe(true);
  const request = await callback();
  expect(await markReconnect(h.env, 1, NOW + 1)).toBe(false);
  expect((await finishOAuth(request, h.env, NOW + 2, transport('fresh'))).status).toBe(303);
});

it('disconnect between studio ticket consumption and OAuth creation cannot issue a new state', async () => {
  await connected();
  const originalEnv = {
    ...h.env,
    STUDIO_ORIGIN: 'https://studio.example.test',
    STUDIO_OWNER_ID: 'synthetic-owner',
    STUDIO_BRIDGE_SECRET: 'synthetic-bridge-secret-000000000000000000',
  };
  const ticket = (await (await issueStudioOAuth(originalEnv, NOW)).json()) as { url: string };
  let intercepted = false;
  const env = {
    ...originalEnv,
    DB: new Proxy(originalEnv.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!sql.startsWith('DELETE FROM auth_state') || !sql.includes("csrf='studio-ticket'"))
              return statement;
            return new Proxy(statement, {
              get(target, key) {
                if (key === 'bind')
                  return (...args: Parameters<D1PreparedStatement['bind']>) => {
                    const bound = target.bind(...args);
                    return new Proxy(bound, {
                      get(target, key) {
                        if (key === 'first')
                          return async () => {
                            const row = await target.first();
                            intercepted = true;
                            await disconnect(originalEnv, NOW + 1);
                            return row;
                          };
                        const value: unknown = Reflect.get(target, key);
                        return typeof value === 'function' ? value.bind(target) : value;
                      },
                    });
                  };
                const value: unknown = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
  vi.spyOn(Date, 'now').mockReturnValue(NOW + 2);
  const response = await handle(new Request(ticket.url), env);
  expect(intercepted).toBe(true);
  expect(response.status).toBe(409);
  expect(response.headers.get('Location')).toBeNull();
  expect(await response.json()).toMatchObject({ error: 'OAUTH_CHANGED' });
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM auth_state WHERE kind='oauth'").first('n'),
  ).toBe(0);
});

it.each(['first', 'connected', 'disconnected'] as const)(
  'OAuth completes against unchanged %s state',
  async (state) => {
    if (state !== 'first') await connected();
    if (state === 'disconnected') await disconnect(h.env, NOW);
    const response = await finishOAuth(await callback(), h.env, NOW, transport('accepted'));
    expect(response.status).toBe(303);
    const row = (await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>())!;
    expect(row.status).toBe('connected');
    expect(row.version).toBe(state === 'first' ? 1 : state === 'connected' ? 2 : 3);
    expect(await decrypt(row.access_token!, h.env.TOKEN_ENCRYPTION_KEY)).toBe('accepted-access');
  },
);

it('disconnect immediately before the credential write is checked atomically', async () => {
  await connected();
  const request = await callback();
  let intercepted = false;
  const env = {
    ...h.env,
    DB: new Proxy(h.env.DB, {
      get(target, key) {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!sql.startsWith('INSERT INTO credentials')) return statement;
            return new Proxy(statement, {
              get(target, key) {
                if (key === 'bind')
                  return (...args: Parameters<D1PreparedStatement['bind']>) => {
                    const bound = target.bind(...args);
                    return new Proxy(bound, {
                      get(target, key) {
                        if (key === 'first')
                          return async () => {
                            intercepted = true;
                            await disconnect(h.env, NOW + 1);
                            return target.first();
                          };
                        const value: unknown = Reflect.get(target, key);
                        return typeof value === 'function' ? value.bind(target) : value;
                      },
                    });
                  };
                const value: unknown = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
  await expect(finishOAuth(request, env, NOW, transport('stale'))).rejects.toMatchObject({
    status: 409,
    code: 'OAUTH_CHANGED',
  });
  expect(intercepted).toBe(true);
  expect(
    await h.env.DB.prepare(
      'SELECT status,version,access_token,refresh_token FROM credentials',
    ).first(),
  ).toEqual({ status: 'disconnected', version: 2, access_token: null, refresh_token: null });
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM auth_state WHERE kind='session'").first('n'),
  ).toBe(0);
});

it.each([
  'disconnect',
  'new_oauth',
  'token_refresh',
  'reconnect_required',
  'first_registration',
] as const)(
  'late OAuth completion cannot overwrite %s completed during provider I/O',
  async (change) => {
    if (change !== 'first_registration') await connected();
    const request = await callback();
    let snapshot: Credentials | null = null;
    let sessions = 0;
    const staleTransport: Transport = async (url, init) => {
      if (url.includes('/user/me')) {
        if (change === 'disconnect') await disconnect(h.env, NOW + 1);
        else if (change === 'new_oauth' || change === 'first_registration')
          await finishOAuth(await callback(), h.env, NOW + 1, transport('newest'));
        else if (change === 'reconnect_required') await markReconnect(h.env, 1, NOW + 1);
        else await accessToken(h.env, NOW + 1, transport('refreshed'));
        snapshot = await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>();
        sessions = (await h.env.DB.prepare(
          "SELECT count(*) AS n FROM auth_state WHERE kind='session'",
        ).first<number>('n'))!;
      }
      return transport('stale')(url, init);
    };
    const result = await Promise.allSettled([finishOAuth(request, h.env, NOW, staleTransport)]);
    expect(snapshot).not.toBeNull();
    expect(await h.env.DB.prepare('SELECT * FROM credentials').first()).toEqual(snapshot);
    expect(result[0]).toMatchObject({
      status: 'rejected',
      reason: { status: 409, code: 'OAUTH_CHANGED' },
    });
    expect(
      await h.env.DB.prepare("SELECT count(*) AS n FROM auth_state WHERE kind='session'").first(
        'n',
      ),
    ).toBe(sessions);
    // A rejected callback still consumes its one-use state; a fresh flow is required.
    await expect(finishOAuth(request, h.env, NOW, transport('replay'))).rejects.toMatchObject({
      code: 'OAUTH_STATE',
    });
  },
);
