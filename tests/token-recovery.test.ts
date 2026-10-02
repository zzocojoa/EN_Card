import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { accessToken, retryTokenRefresh } from '../src/worker/auth';
import { decrypt, encrypt } from '../src/worker/crypto';
import { runEngine } from '../src/worker/engine';
import { requestTokens } from '../src/worker/kakao';
import { saveSchedule } from '../src/worker/schedules';
import type { Credentials, Transport } from '../src/worker/types';
import { harness, NOW, readyCard, type Harness } from './helpers';

let h: Harness;
const due: number = NOW + 300_000;
beforeEach(async () => {
  h = await harness();
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?, ?,1,'connected')",
  )
    .bind(
      await encrypt('access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW - 1,
      NOW + 86400_000,
    )
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.mf.dispose();
});
const temporary: Transport = async () =>
  Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
const success: Transport = async () =>
  Response.json({ access_token: 'new-access', expires_in: 3600 });
async function stored(): Promise<Credentials> {
  const row = await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>();
  if (!row) throw new Error('인증 fixture가 없습니다.');
  return row;
}
async function schedule(): Promise<string> {
  const assets = await Promise.all([
    readyCard(h.env, NOW - 300_000),
    readyCard(h.env, NOW - 300_000),
  ]);
  return (
    await saveSchedule(
      {
        name: '토큰 복구',
        kind: 'daily',
        date: '2026-09-28',
        time: '12:05',
        end_date: null,
        weekdays: [],
        cards_per_occurrence: 1,
        asset_ids: assets.map((asset) => asset.assetId),
      },
      null,
      null,
      h.env,
      NOW,
    )
  ).id;
}
it('R2 503 대기 후 다음 Cron에서 토큰 갱신·발송하며 발송 전 예산은 소비하지 않는다', async () => {
  const id: string = await schedule();
  let now: number = due;
  let tokenCalls: number = 0;
  let sends: number = 0;
  const transport: Transport = async (url, init) => {
    tokenCalls += 1;
    return tokenCalls === 1 ? temporary(url, init) : success(url, init);
  };
  const runtime = {
    mode: 'live' as const,
    clock: () => now,
    token: () => accessToken(h.env, now, transport),
    sender: async (_payload: unknown, token: string) => {
      expect(token).toBe('new-access');
      sends += 1;
      return { outcome: 'sent' as const, detail: '모의 API 접수' };
    },
  };
  await runEngine(h.env, runtime);
  expect(sends).toBe(0);
  expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
    0,
  );
  expect(
    await h.env.DB.prepare('SELECT coalesce(sum(sends),0) AS sends FROM usage_counters').first(
      'sends',
    ),
  ).toBe(0);
  expect(
    await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
  ).toEqual({ enabled: 1, reason: null });
  expect(await stored()).toMatchObject({
    status: 'connected',
    version: 1,
    refresh_attempts: 1,
    refresh_retry_at: due + 60_000,
    refresh_failure: 'transient',
    refresh_http_status: 503,
  });
  now += 30_000;
  await runEngine(h.env, runtime);
  expect(tokenCalls).toBe(1);
  now += 30_000;
  await Promise.all([runEngine(h.env, runtime), runEngine(h.env, runtime)]);
  expect([tokenCalls, sends]).toEqual([2, 1]);
  const row = await stored();
  expect(row).toMatchObject({
    status: 'connected',
    refresh_attempts: 0,
    refresh_failure: null,
    refresh_retry_at: null,
  });
  expect(await decrypt(row.refresh_token!, h.env.TOKEN_ENCRYPTION_KEY)).toBe('refresh');
});
it('R2 인증 함수는 Cron 사이의 간격·3회 상한을 저장하고 명시적 재시작 전 초기화하지 않는다', async () => {
  let calls: number = 0;
  const transport: Transport = async (url, init) => {
    calls += 1;
    return temporary(url, init);
  };
  for (const offset of [0, 30_000, 60_000, 100_000, 180_000, 240_000, 86400_000 - 1]) {
    await expect(accessToken(h.env, NOW + offset, transport)).rejects.toBeInstanceOf(Error);
  }
  expect(calls).toBe(3);
  expect(await stored()).toMatchObject({
    status: 'connected',
    refresh_attempts: 3,
    refresh_failure: 'exhausted',
    refresh_retry_at: null,
    version: 1,
  });
  await expect(retryTokenRefresh(h.env, 2)).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
  const requests = await Promise.allSettled([
    retryTokenRefresh(h.env, 1),
    retryTokenRefresh(h.env, 1),
  ]);
  expect(requests.filter((request) => request.status === 'fulfilled')).toHaveLength(1);
  await expect(accessToken(h.env, NOW + 240_000, success)).resolves.toMatchObject({
    token: 'new-access',
    version: 3,
  });
});
it('R2 여러 Cron의 갱신 소진은 인증 무효나 전체 미래 예약 중단으로 기록하지 않는다', async () => {
  const id: string = await schedule();
  let now: number = due;
  let calls: number = 0;
  const runtime = {
    mode: 'live' as const,
    clock: () => now,
    token: () =>
      accessToken(h.env, now, async (url, init) => {
        calls += 1;
        return temporary(url, init);
      }),
    sender: async () => {
      throw new Error('토큰 대기 중 메시지를 호출했습니다.');
    },
  };
  for (const offset of [0, 30_000, 60_000, 120_000, 180_000, 240_000]) {
    now = due + offset;
    await runEngine(h.env, runtime);
  }
  expect(calls).toBe(3);
  expect(await h.env.DB.prepare('SELECT state,error FROM deliveries').first()).toMatchObject({
    state: 'failed',
    error: expect.stringContaining('3회'),
  });
  expect(
    await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
  ).toEqual({ enabled: 1, reason: null });
  expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
    0,
  );
});
it('R2 갱신 대기 중 15분이 지나면 과거 발송과 추가 토큰 호출을 하지 않는다', async () => {
  await schedule();
  let now: number = due;
  let calls: number = 0;
  const runtime = {
    mode: 'live' as const,
    clock: () => now,
    token: () =>
      accessToken(h.env, now, async (url, init) => {
        calls += 1;
        return temporary(url, init);
      }),
    sender: async () => {
      throw new Error('만료 회차를 발송했습니다.');
    },
  };
  await runEngine(h.env, runtime);
  now += 900_001;
  await runEngine(h.env, runtime);
  expect(calls).toBe(1);
  expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('missed');
  expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
    0,
  );
});
it.each(['invalid', 'expired'] as const)('R2 확정된 %s 인증은 재연결을 요구한다', async (kind) => {
  const id: string = await schedule();
  if (kind === 'expired')
    await h.env.DB.prepare('UPDATE credentials SET refresh_expires_at=?')
      .bind(due - 1)
      .run();
  let calls: number = 0;
  await runEngine(h.env, {
    mode: 'live',
    clock: () => due,
    token: () =>
      accessToken(h.env, due, async () => {
        calls += 1;
        return Response.json({ error: 'invalid_grant', error_code: 'KOE322' }, { status: 400 });
      }),
    sender: async () => {
      throw new Error('인증 무효인데 발송했습니다.');
    },
  });
  expect(calls).toBe(kind === 'expired' ? 0 : 1);
  expect(await stored()).toMatchObject({ status: 'needs_reconnect', refresh_failure: 'invalid' });
  expect(
    await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
  ).toEqual({ enabled: 0, reason: 'needs_reconnect' });
});
it.each(['network', 'incomplete', 'html', 'server', 'rotated_incomplete'] as const)(
  'R2 %s 응답 불명은 다시 호출하지 않고 재연결로 회전 위험을 해소한다',
  async (kind) => {
    await schedule();
    let calls: number = 0;
    const transport: Transport = async () => {
      calls += 1;
      if (kind === 'network') throw new TypeError('토큰 응답 유실');
      if (kind === 'html') return new Response('not-json', { status: 503 });
      if (kind === 'server') return Response.json({ error: 'server_error' }, { status: 500 });
      if (kind === 'rotated_incomplete')
        return Response.json({ access_token: 'new', expires_in: 3600, refresh_token: 'rotated' });
      return Response.json({ expires_in: 3600 });
    };
    await expect(accessToken(h.env, due, transport)).rejects.toMatchObject({
      tokenFailure: 'uncertain',
    });
    await expect(accessToken(h.env, due + 60_000, success)).rejects.toMatchObject({
      tokenFailure: 'uncertain',
    });
    await expect(retryTokenRefresh(h.env, 2)).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
    expect(calls).toBe(1);
    expect(await stored()).toMatchObject({
      status: 'needs_reconnect',
      refresh_failure: 'uncertain',
    });
    await runEngine(h.env, {
      mode: 'live',
      clock: () => due + 60_000,
      token: () => accessToken(h.env, due + 60_000, transport),
      sender: async () => {
        throw new Error('토큰 결과 불명 상태에서 발송했습니다.');
      },
    });
    expect(calls).toBe(1);
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      0,
    );
  },
);
it('R2 만료된 갱신 잠금은 중단된 회전으로 취급하여 외부 호출을 반복하지 않는다', async () => {
  await h.env.DB.prepare('UPDATE credentials SET lock_owner=?,lock_until=?,refresh_attempts=1')
    .bind('stopped-worker', NOW - 1)
    .run();
  await expect(
    accessToken(h.env, NOW, async () => {
      throw new Error('중단된 토큰 회전을 반복했습니다.');
    }),
  ).rejects.toMatchObject({ tokenFailure: 'uncertain' });
  expect(await stored()).toMatchObject({ status: 'needs_reconnect', refresh_failure: 'uncertain' });
});

it('R2 일시 오류 뒤 실제 리프레시 만료는 이전 503과 구별하여 기록한다', async () => {
  await expect(accessToken(h.env, NOW, temporary)).rejects.toMatchObject({
    tokenFailure: 'transient',
  });
  await h.env.DB.prepare('UPDATE credentials SET refresh_expires_at=?')
    .bind(NOW + 30_000)
    .run();
  await expect(accessToken(h.env, NOW + 60_000, success)).rejects.toMatchObject({
    tokenFailure: 'invalid',
  });
  expect(await stored()).toMatchObject({
    status: 'needs_reconnect',
    refresh_failure: 'invalid',
    refresh_retry_at: null,
    refresh_http_status: null,
    refresh_provider_error: null,
  });
});
it('R2 동시에 갱신해도 한 호출·한 예산만 예약하며 백오프를 우회하지 않는다', async () => {
  let calls: number = 0;
  const transport: Transport = async (url, init) => {
    calls += 1;
    return temporary(url, init);
  };
  await Promise.allSettled([
    accessToken(h.env, NOW, transport),
    accessToken(h.env, NOW, transport),
  ]);
  expect(calls).toBe(1);
  expect(await stored()).toMatchObject({ refresh_attempts: 1, refresh_retry_at: NOW + 60_000 });
});
it.each([
  [400, 'invalid_request', 'KOE237', 'transient'],
  [401, 'invalid_client', 'KOE010', 'configuration'],
  [400, 'invalid_grant', 'KOE310', 'configuration'],
  [502, 'temporarily_unavailable', null, 'uncertain'],
] as const)(
  'R2 HTTP %s / %s / %s 계약 분류와 제공사 메타데이터를 보존한다',
  async (status, error, code, kind) => {
    const transport: Transport = async () =>
      Response.json({ error, ...(code ? { error_code: code } : {}) }, { status });
    await expect(
      requestTokens(
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'refresh' }),
        h.env,
        transport,
      ),
    ).rejects.toMatchObject({
      status,
      httpStatus: status,
      providerError: error,
      providerCode: code,
      tokenFailure: kind,
    });
  },
);

it.each(['network', 'incomplete'] as const)(
  'R2 엔진의 %s 갱신 불명은 발송 전 멈추고 이후 Cron도 재호출하지 않는다',
  async (kind) => {
    await schedule();
    let calls: number = 0;
    const transport: Transport = async () => {
      calls += 1;
      if (kind === 'network') throw new TypeError('응답 유실');
      return Response.json({ access_token: 'new' });
    };
    for (const now of [due, due + 60_000])
      await runEngine(h.env, {
        mode: 'live',
        clock: () => now,
        token: () => accessToken(h.env, now, transport),
        sender: async () => {
          throw new Error('토큰 불명 상태에서 발송했습니다.');
        },
      });
    expect(calls).toBe(1);
    expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('blocked');
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      0,
    );
  },
);
it('R2 제공사 오류 설명·토큰·요청 Secret을 로그와 오류에 남기지 않는다', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let error: unknown;
  try {
    await accessToken(h.env, NOW, async () =>
      Response.json(
        {
          error: 'temporarily_unavailable',
          error_description: 'secret-response-raw',
          access_token: 'response-token',
        },
        { status: 503 },
      ),
    );
  } catch (caught: unknown) {
    error = caught;
  }
  const output: string =
    JSON.stringify(warning.mock.calls) + (error instanceof Error ? error.message : '');
  expect(output).not.toContain('secret-response-raw');
  expect(output).not.toContain('response-token');
  expect(output).not.toContain(h.env.KAKAO_CLIENT_SECRET);
  expect(output).toContain('temporarily_unavailable');
});
