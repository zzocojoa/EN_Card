import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  accessToken,
  beginOAuth,
  createSession,
  disconnect,
  finishOAuth,
  requireSession,
} from '../src/worker/auth';
import { decrypt, encrypt } from '../src/worker/crypto';
import { runEngine } from '../src/worker/engine';
import { handle } from '../src/worker/index';
import type { Credentials, Transport } from '../src/worker/types';
import { dueSchedule, harness, NOW, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function storeCredentials(): Promise<void> {
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?, ?,1,'connected')",
  )
    .bind(
      await encrypt('old-access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('old-refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW - 1,
      NOW + 86400_000,
    )
    .run();
}
async function start(): Promise<{ state: string; browser: string }> {
  const response = await beginOAuth(
    new Request(`${h.env.APP_ORIGIN}/auth/start`, {
      method: 'POST',
      headers: { Origin: h.env.APP_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_token: h.env.SETUP_TOKEN }),
    }),
    h.env,
    NOW,
  );
  const body = (await response.json()) as { url: string };
  return {
    state: new URL(body.url).searchParams.get('state')!,
    browser: response.headers.get('Set-Cookie')!.split(';')[0]!,
  };
}
function callback(state: string, browser: string): Request {
  return new Request(`${h.env.APP_ORIGIN}/auth/callback?code=one-use-code&state=${state}`, {
    headers: { Cookie: browser },
  });
}
const oauthTransport: Transport = async (url) =>
  url.includes('/oauth/token')
    ? Response.json({
        access_token: 'access',
        expires_in: 3600,
        refresh_token: 'refresh',
        refresh_token_expires_in: 86400,
      })
    : Response.json({ id: 42 });
describe('OAuth·접근 제어', () => {
  it('SETUP_TOKEN 없이 최초 등록을 시작하지 못한다', async () => {
    await expect(
      beginOAuth(
        new Request(`${h.env.APP_ORIGIN}/auth/start`, {
          method: 'POST',
          headers: { Origin: h.env.APP_ORIGIN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ setup_token: 'wrong' }),
        }),
        h.env,
        NOW,
      ),
    ).rejects.toThrow('SETUP_TOKEN');
  });
  it('state를 브라우저와 연결하고 원자적으로 한 번만 소비한다', async () => {
    const auth = await start();
    await expect(
      finishOAuth(callback(auth.state, 'en_oauth=wrong'), h.env, NOW, oauthTransport),
    ).rejects.toThrow('다른 브라우저');
    const response = await finishOAuth(
      callback(auth.state, auth.browser),
      h.env,
      NOW,
      oauthTransport,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
    await expect(
      finishOAuth(callback(auth.state, auth.browser), h.env, NOW, oauthTransport),
    ).rejects.toThrow('재사용');
    const row = await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>();
    expect(row?.owner_id).toBe('42');
    expect(row?.access_token).not.toBe('access');
    expect(await decrypt(row!.refresh_token!, h.env.TOKEN_ENCRYPTION_KEY)).toBe('refresh');
  });
  it('등록된 소유자 이외의 카카오 ID를 거부한다', async () => {
    await storeCredentials();
    const auth = await start();
    const transport: Transport = async (url, init) =>
      url.includes('/user/me') ? Response.json({ id: 99 }) : oauthTransport(url, init);
    await expect(
      finishOAuth(callback(auth.state, auth.browser), h.env, NOW, transport),
    ).rejects.toThrow('운영자');
    expect(await h.env.DB.prepare('SELECT owner_id FROM credentials').first('owner_id')).toBe('42');
  });
  it('만료 state를 거부한다', async () => {
    const auth = await start();
    await expect(
      finishOAuth(callback(auth.state, auth.browser), h.env, NOW + 601_000, oauthTransport),
    ).rejects.toThrow('만료');
  });
  it('세션 없는 API·CSRF·Origin 위조를 거부한다', async () => {
    expect((await handle(new Request(`${h.env.APP_ORIGIN}/api/state`), h.env)).status).toBe(401);
    const session = await createSession(h.env, NOW);
    const base = { Cookie: `en_session=${session.token}`, Origin: h.env.APP_ORIGIN };
    await expect(
      requireSession(
        new Request(`${h.env.APP_ORIGIN}/api/cards`, { method: 'POST', headers: base }),
        h.env,
        NOW,
      ),
    ).rejects.toThrow('확인 값');
    await expect(
      requireSession(
        new Request(`${h.env.APP_ORIGIN}/api/cards`, {
          method: 'POST',
          headers: { ...base, 'X-CSRF-Token': session.csrf, Origin: 'https://evil.test' },
        }),
        h.env,
        NOW,
      ),
    ).rejects.toThrow('출처');
    await expect(
      requireSession(
        new Request(`${h.env.APP_ORIGIN}/api/cards`, {
          method: 'POST',
          headers: { ...base, 'X-CSRF-Token': session.csrf },
        }),
        h.env,
        NOW,
      ),
    ).resolves.toHaveProperty('csrf', session.csrf);
  });
  it('연결 해제는 토큰을 지우고 예약을 중단한다', async () => {
    await storeCredentials();
    const id = await dueSchedule(h.env, 1, NOW);
    await disconnect(h.env, NOW);
    expect(
      await h.env.DB.prepare('SELECT access_token FROM credentials').first('access_token'),
    ).toBeNull();
    expect(
      await h.env.DB.prepare('SELECT enabled FROM schedules WHERE id=?').bind(id).first('enabled'),
    ).toBe(0);
  });
});
describe('토큰 갱신', () => {
  it('새 refresh_token이 없으면 기존 값을 유지한다', async () => {
    await storeCredentials();
    expect(
      await accessToken(h.env, NOW, async () =>
        Response.json({ access_token: 'new-access', expires_in: 3600 }),
      ),
    ).toEqual({ token: 'new-access', version: 2 });
    const row = await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>();
    expect(await decrypt(row!.refresh_token!, h.env.TOKEN_ENCRYPTION_KEY)).toBe('old-refresh');
    expect(row?.version).toBe(2);
  });
  it('토큰 회전을 저장한다', async () => {
    await storeCredentials();
    await accessToken(h.env, NOW, async () =>
      Response.json({
        access_token: 'new',
        expires_in: 3600,
        refresh_token: 'rotated',
        refresh_token_expires_in: 6000,
      }),
    );
    const row = await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>();
    expect(await decrypt(row!.refresh_token!, h.env.TOKEN_ENCRYPTION_KEY)).toBe('rotated');
    expect(row?.refresh_expires_at).toBe(NOW + 6000_000);
  });
  it('동시 갱신은 외부 호출을 직렬화한다', async () => {
    await storeCredentials();
    let calls: number = 0;
    const transport: Transport = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return Response.json({ access_token: 'new', expires_in: 3600 });
    };
    const result = await Promise.allSettled([
      accessToken(h.env, NOW, transport),
      accessToken(h.env, NOW, transport),
    ]);
    expect(calls).toBe(1);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
  });
  it('권한 철회·갱신 실패 뒤 외부 호출을 반복하지 않는다', async () => {
    await storeCredentials();
    const id: string = await dueSchedule(h.env, 1, NOW);
    let calls: number = 0;
    const transport: Transport = async () => {
      calls += 1;
      return Response.json({ error: 'invalid_grant', error_code: 'KOE322' }, { status: 400 });
    };
    await expect(accessToken(h.env, NOW, transport)).rejects.toThrow('HTTP 400');
    await expect(accessToken(h.env, NOW + 60_000, transport)).rejects.toThrow('연결');
    expect(calls).toBe(1);
    expect(await h.env.DB.prepare('SELECT status FROM credentials').first('status')).toBe(
      'needs_reconnect',
    );
    expect(
      await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
    ).toEqual({ enabled: 0, reason: 'needs_reconnect' });
  });
  it.each(['rejected', 'response_missing'] as const)(
    '이전 갱신의 %s 오류 뒤에도 새 연결로 다음 Cron에서 발송한다',
    async (failure) => {
      await storeCredentials();
      const id: string = await dueSchedule(h.env, 1, NOW);
      const auth = await start();
      const result = await runEngine(h.env, {
        mode: 'live',
        clock: () => NOW,
        token: () =>
          accessToken(h.env, NOW, async () => {
            await finishOAuth(callback(auth.state, auth.browser), h.env, NOW, oauthTransport);
            if (failure === 'response_missing') throw new TypeError('모의 응답 유실');
            return Response.json({ error: 'invalid_grant', error_code: 'KOE322' }, { status: 400 });
          }),
        sender: async () => {
          throw new Error('이전 연결로 발송하면 안 됩니다.');
        },
      });
      expect(result.processed).toBe(0);
      expect(await h.env.DB.prepare('SELECT status,version FROM credentials').first()).toEqual({
        status: 'connected',
        version: 2,
      });
      expect(
        await h.env.DB.prepare('SELECT reason FROM schedules WHERE id=?').bind(id).first('reason'),
      ).toBe('content_shortage');
      expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe(
        'retry_wait',
      );
      const next = await runEngine(h.env, {
        mode: 'live',
        clock: () => NOW + 60_000,
        token: () =>
          accessToken(h.env, NOW + 60_000, async () => {
            throw new Error('새 토큰은 아직 만료되지 않았습니다.');
          }),
        sender: async (_payload, token) => {
          expect(token).toBe('access');
          return { outcome: 'sent', detail: '새 연결의 모의 API 접수' };
        },
      });
      expect(next.processed).toBe(1);
      expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('sent');
      expect(
        await h.env.DB.prepare('SELECT count(*) AS count FROM delivery_attempts').first('count'),
      ).toBe(1);
    },
  );
  it('이전 갱신 실패가 같은 버전의 새 갱신 잠금을 해제하지 않는다', async () => {
    await storeCredentials();
    const id: string = await dueSchedule(h.env, 1, NOW);
    await expect(
      accessToken(h.env, NOW, async () => {
        await h.env.DB.prepare('UPDATE credentials SET lock_owner=?,lock_until=? WHERE singleton=1')
          .bind('new-refresh-owner', NOW + 90_000)
          .run();
        return Response.json({ error: 'invalid_grant', error_code: 'KOE322' }, { status: 400 });
      }),
    ).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
    expect(
      await h.env.DB.prepare(
        'SELECT status,version,lock_owner,lock_until FROM credentials',
      ).first(),
    ).toEqual({
      status: 'connected',
      version: 1,
      lock_owner: 'new-refresh-owner',
      lock_until: NOW + 90_000,
    });
    expect(
      await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
    ).toEqual({ enabled: 1, reason: null });
  });
  it('이전 토큰의 만료 판정이 새 OAuth 연결을 재연결 필요 상태로 처리하지 않는다', async () => {
    await storeCredentials();
    const id: string = await dueSchedule(h.env, 1, NOW);
    await h.env.DB.prepare('UPDATE credentials SET refresh_expires_at=?')
      .bind(NOW - 1)
      .run();
    const auth = await start();
    const db: D1Database = new Proxy(h.env.DB, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            await finishOAuth(callback(auth.state, auth.browser), h.env, NOW, oauthTransport);
            return target.batch(statements);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(accessToken({ ...h.env, DB: db }, NOW, oauthTransport)).rejects.toMatchObject({
      code: 'TOKEN_CHANGED',
    });
    expect(await h.env.DB.prepare('SELECT status,version FROM credentials').first()).toEqual({
      status: 'connected',
      version: 2,
    });
    expect(
      await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
    ).toEqual({ enabled: 1, reason: null });
  });
  it('갱신 도중 연결 해제를 덮어쓰지 않는다', async () => {
    await storeCredentials();
    await expect(
      accessToken(h.env, NOW, async () => {
        await disconnect(h.env, NOW);
        return Response.json({ access_token: 'new', expires_in: 3600 });
      }),
    ).rejects.toThrow('변경');
    expect(await h.env.DB.prepare('SELECT status FROM credentials').first('status')).toBe(
      'disconnected',
    );
  });
});

it('로그아웃은 세션만 제거하고 예약과 카카오 연결을 유지한다', async () => {
  await storeCredentials();
  const id = await dueSchedule(h.env, 1, NOW);
  const session = await createSession(h.env, Date.now());
  const response = await handle(
    new Request(`${h.env.APP_ORIGIN}/api/logout`, {
      method: 'POST',
      headers: {
        Origin: h.env.APP_ORIGIN,
        Cookie: `en_session=${session.token}`,
        'X-CSRF-Token': session.csrf,
      },
    }),
    h.env,
  );
  expect(response.status).toBe(200);
  expect(
    await h.env.DB.prepare('SELECT enabled FROM schedules WHERE id=?').bind(id).first('enabled'),
  ).toBe(1);
  expect(await h.env.DB.prepare('SELECT status FROM credentials').first('status')).toBe(
    'connected',
  );
  await expect(
    requireSession(
      new Request(h.env.APP_ORIGIN, { headers: { Cookie: `en_session=${session.token}` } }),
      h.env,
      Date.now(),
    ),
  ).rejects.toThrow('만료');
});
