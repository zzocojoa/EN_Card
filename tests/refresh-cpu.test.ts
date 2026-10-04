import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialToken } from '../src/automation/credentials';
import type { TokenSecrets } from '../src/shared/token-rpc';
import production from '../src/worker/index';
import delivery from '../src/worker/delivery-service';
import { decrypt, encrypt, tokenCipher } from '../src/worker/crypto';
import { recoveryPreview } from '../src/worker/pause-recovery';
import { stopSchedule } from '../src/worker/schedules';
import type { Env } from '../src/worker/types';
import { dueSchedule, harness, NOW, type Harness } from './helpers';

describe.each(['local', 'durable'])('token runtime %s', (runtime) => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await h.mf.dispose();
  });
  async function live(expired = true): Promise<Env> {
    await h.env.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'fixture',?,?,?,?,1,'connected')",
    )
      .bind(
        await encrypt('synthetic-access', h.env.TOKEN_ENCRYPTION_KEY),
        await encrypt('synthetic-refresh', h.env.TOKEN_ENCRYPTION_KEY),
        expired ? NOW - 1 : NOW + 3600_000,
        NOW + 86400_000,
      )
      .run();
    const env: Env = { ...h.env, SEND_MODE: 'live' };
    if (runtime === 'durable')
      env.AUTOMATION = {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async () => new Response(null, { status: 204 }),
          credentialToken: (secrets: TokenSecrets) =>
            credentialToken(
              {
                ...env,
                FONT_ASSETS: env.ASSETS,
                AUTOMATION_MODE: 'off',
              },
              secrets,
              Date.now(),
            ),
        }),
      } as unknown as NonNullable<Env['AUTOMATION']>;
    env.DELIVERY_SERVICE = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        delivery.fetch(input instanceof Request ? input : new Request(input, init), env),
    } as unknown as Fetcher;
    return env;
  }
  function provider(
    refresh?: () => Promise<Response>,
    send?: () => Promise<Response>,
  ): { refresh: number; send: number } {
    const calls = { refresh: 0, send: 0 };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input) === 'https://kauth.kakao.com/oauth/token') {
        calls.refresh += 1;
        return refresh
          ? refresh()
          : Response.json({ access_token: 'synthetic-new', expires_in: 3600 });
      }
      if (String(input) === 'https://kapi.kakao.com/v2/api/talk/memo/default/send') {
        calls.send += 1;
        return send ? send() : Response.json({ result_code: 0 });
      }
      throw new Error('Unexpected mock provider URL');
    });
    return calls;
  }
  const tick = (env: Env): Promise<void> => production.scheduled({} as ScheduledController, env);
  async function attempts(env: Env): Promise<number> {
    return (await env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first<number>(
      'n',
    ))!;
  }
  async function budget(env: Env): Promise<number> {
    return (await env.DB.prepare(
      'SELECT coalesce(sum(sends),0) AS n FROM usage_counters',
    ).first<number>('n'))!;
  }

  it('정상 갱신 회차는 발송을 넘기고 다음 Cron들이 5장을 3/2장씩 한 번만 보낸다', async () => {
    const env = await live();
    const id = await dueSchedule(env, 5, NOW);
    await env.DB.prepare("UPDATE schedules SET time='12:00' WHERE id=?").bind(id).run();
    const calls = provider(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 2000);
      return Response.json({ access_token: 'synthetic-new', expires_in: 3600 });
    });
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 0 });
    expect(await attempts(env)).toBe(0);
    expect(await budget(env)).toBe(0);
    expect(
      await env.DB.prepare(
        'SELECT count(*) AS n FROM deliveries WHERE claim_owner IS NOT NULL',
      ).first('n'),
    ).toBe(0);
    expect(
      await env.DB.prepare('SELECT state,retry_at FROM deliveries WHERE position=0').first(),
    ).toMatchObject({ state: 'retry_wait', retry_at: NOW + 60_000 });
    expect(
      await env.DB.prepare('SELECT cursor,enabled,reason FROM schedules WHERE id=?')
        .bind(id)
        .first(),
    ).toMatchObject({ cursor: 5, enabled: 0, reason: 'completed' });
    vi.mocked(Date.now).mockReturnValue(NOW + 30_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 0 });
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 3 });
    vi.mocked(Date.now).mockReturnValue(NOW + 120_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 5 });
    expect(await attempts(env)).toBe(5);
    expect(await budget(env)).toBe(5);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM deliveries WHERE state='sent'").first('n'),
    ).toBe(5);
  });

  it('이미 유효한 토큰은 추가 대기 없이 같은 Cron에서 발송한다', async () => {
    const env = await live(false);
    await dueSchedule(env, 1, NOW);
    const calls = provider();
    await tick(env);
    expect(calls).toEqual({ refresh: 0, send: 1 });
    expect(await attempts(env)).toBe(1);
  });

  it.each(['before', 'after'] as const)(
    '비공개 정리 응답 유실(%s)은 추가 발송 없이 claim 만료 후 Cron에서 안전하게 이어진다',
    async (when) => {
      const env = await live();
      await dueSchedule(env, 1, NOW);
      const binding = env.DELIVERY_SERVICE!;
      env.DELIVERY_SERVICE = {
        fetch: async (request: Request) => {
          if (new URL(request.url).pathname === '/_internal/defer') {
            if (when === 'after') await binding.fetch(request);
            throw new Error('synthetic-private-detail');
          }
          return binding.fetch(request);
        },
      } as unknown as Fetcher;
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const calls = provider();
      await tick(env);
      expect(calls).toEqual({ refresh: 1, send: 0 });
      expect(await attempts(env)).toBe(0);
      expect(await budget(env)).toBe(0);
      expect(warning).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'delivery_defer_interrupted', error_type: 'Error' }),
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic-private-detail');
      vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
      await tick(env);
      if (when === 'before') {
        // The existing lease is still owned at the exact expiry boundary.
        expect(calls).toEqual({ refresh: 1, send: 0 });
        vi.mocked(Date.now).mockReturnValue(NOW + 60_001);
        await tick(env);
      }
      expect(calls).toEqual({ refresh: 1, send: 1 });
      expect(await attempts(env)).toBe(1);
      expect(
        await env.DB.prepare('SELECT state,claim_owner,claim_until FROM deliveries').first(),
      ).toEqual({ state: 'sent', claim_owner: null, claim_until: null });
    },
  );

  it('비공개 정리는 소유권·중복 요청을 보호하고 토큰을 전달하지 않는다', async () => {
    const env = await live();
    await dueSchedule(env, 1, NOW);
    const binding = env.DELIVERY_SERVICE!;
    let deferred = 0;
    let keys: string[] = [];
    let claimOwner = '';
    let before: unknown;
    const statuses: number[] = [];
    env.DELIVERY_SERVICE = {
      fetch: async (request: Request) => {
        if (new URL(request.url).pathname !== '/_internal/defer') return binding.fetch(request);
        deferred += 1;
        const claim = (await request.clone().json()) as { id: string; owner: string };
        keys = Object.keys(claim).sort();
        claimOwner = claim.owner;
        const wrong = new Request(request.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: claim.id, owner: 'synthetic-other-owner' }),
        });
        statuses.push((await binding.fetch(wrong)).status);
        before = await env.DB.prepare('SELECT state,claim_owner FROM deliveries WHERE id=?')
          .bind(claim.id)
          .first();
        statuses.push(
          (
            await binding.fetch(request.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(claim),
            })
          ).status,
        );
        const repeated = await binding.fetch(request);
        statuses.push(repeated.status);
        return repeated;
      },
    } as unknown as Fetcher;
    const calls = provider();
    await tick(env);
    expect(deferred).toBe(1);
    expect(keys).toEqual(['id', 'owner']);
    expect(before).toEqual({ state: 'claimed', claim_owner: claimOwner });
    expect(statuses).toEqual([204, 204, 204]);
    expect(calls).toEqual({ refresh: 1, send: 0 });
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 1 });
    expect(await budget(env)).toBe(1);
  });

  it('메시지 401 뒤 갱신도 다음 실행으로 분리하고 추가 발송은 한 번만 허용한다', async () => {
    const env = await live(false);
    await dueSchedule(env, 1, NOW);
    let replies = 0;
    const calls = provider(undefined, async () =>
      ++replies === 1
        ? Response.json({ code: -401 }, { status: 401 })
        : Response.json({ result_code: 0 }),
    );
    await tick(env);
    expect(calls).toEqual({ refresh: 0, send: 1 });
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 1 });
    expect(await budget(env)).toBe(1);
    vi.mocked(Date.now).mockReturnValue(NOW + 120_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 2 });
    expect(await env.DB.prepare('SELECT state,auth_retries FROM deliveries').first()).toEqual({
      state: 'sent',
      auth_retries: 1,
    });
    expect(await attempts(env)).toBe(2);
  });

  it.each(['paused', 'cancelled'] as const)(
    '갱신 응답 대기 중 %s를 존중하고 자동 발송·재개하지 않는다',
    async (reason) => {
      const env = await live();
      const id = await dueSchedule(env, 1, NOW);
      const calls = provider(async () => {
        await stopSchedule(id, 1, reason, env, NOW);
        return Response.json({ access_token: 'synthetic-new', expires_in: 3600 });
      });
      await tick(env);
      expect(calls).toEqual({ refresh: 1, send: 0 });
      expect(
        await env.DB.prepare('SELECT state,claim_owner,claim_until FROM deliveries').first(),
      ).toEqual({ state: 'cancelled', claim_owner: null, claim_until: null });
      expect(
        await env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
      ).toMatchObject({ enabled: 0, reason });
      expect((await recoveryPreview(id, 1, env)).items).toHaveLength(reason === 'paused' ? 1 : 0);
      expect(await attempts(env)).toBe(0);
      expect(await budget(env)).toBe(0);
    },
  );

  it('갱신 중 15분 유예가 지나면 missed로 정리하고 메시지 예산을 쓰지 않는다', async () => {
    const env = await live();
    await dueSchedule(env, 1, NOW);
    const calls = provider(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 16 * 60_000);
      return Response.json({ access_token: 'synthetic-new', expires_in: 3600 });
    });
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 0 });
    expect(
      await env.DB.prepare('SELECT state,claim_owner,claim_until FROM deliveries').first(),
    ).toEqual({ state: 'missed', claim_owner: null, claim_until: null });
    expect(await budget(env)).toBe(0);
  });

  it.each([true, false])(
    '저장 키 형식 오류는 기존 R7 차단·claim 정리를 유지한다 (만료=%s)',
    async (expired) => {
      const env = await live(expired);
      env.TOKEN_ENCRYPTION_KEY = 'synthetic-invalid-format';
      await dueSchedule(env, 1, NOW);
      const calls = provider();
      await tick(env);
      expect(calls).toEqual({ refresh: 0, send: 0 });
      expect(
        await env.DB.prepare('SELECT state,claim_owner,claim_until,error FROM deliveries').first(),
      ).toMatchObject({
        state: 'blocked',
        claim_owner: null,
        claim_until: null,
        error: expect.stringContaining('저장 인증정보'),
      });
      expect(
        await env.DB.prepare('SELECT status,refresh_failure,version FROM credentials').first(),
      ).toEqual({ status: 'needs_reconnect', refresh_failure: 'configuration', version: 2 });
      expect(await attempts(env)).toBe(0);
      expect(await budget(env)).toBe(0);
    },
  );

  it('갱신 응답 유실은 uncertain을 유지하고 다음 Cron에서 재호출하지 않는다', async () => {
    const env = await live();
    await dueSchedule(env, 1, NOW);
    const calls = provider(async () => {
      throw new Error('synthetic-lost-response');
    });
    await tick(env);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 0 });
    expect(await env.DB.prepare('SELECT status,refresh_failure FROM credentials').first()).toEqual({
      status: 'needs_reconnect',
      refresh_failure: 'uncertain',
    });
    expect(await env.DB.prepare('SELECT state,claim_owner FROM deliveries').first()).toEqual({
      state: 'blocked',
      claim_owner: null,
    });
    expect(await budget(env)).toBe(0);
  });

  it('늦은 갱신 응답은 동시에 완료된 새 OAuth 인증을 덮어쓰지 않는다', async () => {
    const env = await live();
    await dueSchedule(env, 1, NOW);
    const calls = provider(async () => {
      await env.DB.prepare(
        'UPDATE credentials SET access_token=?,version=8,expires_at=?,lock_owner=NULL,lock_until=NULL,refresh_attempts=0 WHERE singleton=1',
      )
        .bind(await encrypt('synthetic-oauth-new', env.TOKEN_ENCRYPTION_KEY), NOW + 7200_000)
        .run();
      return Response.json({ access_token: 'synthetic-stale', expires_in: 3600 });
    });
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 0 });
    const row = await env.DB.prepare(
      'SELECT access_token,version,lock_owner FROM credentials',
    ).first<{ access_token: string; version: number; lock_owner: string | null }>();
    expect(row?.version).toBe(8);
    expect(row?.lock_owner).toBeNull();
    expect(await decrypt(row!.access_token, env.TOKEN_ENCRYPTION_KEY)).toBe('synthetic-oauth-new');
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 1 });
  });

  it('동시 Cron은 갱신 1회로 직렬화하고 다음 Cron에만 발송 예산을 쓴다', async () => {
    const env = await live();
    await dueSchedule(env, 3, NOW);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = provider(async () => {
      entered();
      await gate;
      return Response.json({ access_token: 'synthetic-new', expires_in: 3600 });
    });
    const first = tick(env);
    await started;
    try {
      await tick(env);
    } finally {
      release();
      await first;
    }
    expect(calls).toEqual({ refresh: 1, send: 0 });
    expect(await attempts(env)).toBe(0);
    expect(await budget(env)).toBe(0);
    vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
    await tick(env);
    expect(calls).toEqual({ refresh: 1, send: 3 });
  });

  it('한 갱신의 복호화·두 암호화는 AES 키 1회 준비로 토큰 회전을 보존한다', async () => {
    const env = await live();
    await dueSchedule(env, 1, NOW);
    const importKey = vi.spyOn(crypto.subtle, 'importKey');
    provider(async () =>
      Response.json({
        access_token: 'synthetic-new',
        expires_in: 3600,
        refresh_token: 'synthetic-rotated',
        refresh_token_expires_in: 7200,
      }),
    );
    await tick(env);
    expect(importKey.mock.calls.filter((call) => call[2] === 'AES-GCM')).toHaveLength(1);
    const row = await env.DB.prepare('SELECT access_token,refresh_token FROM credentials').first<{
      access_token: string;
      refresh_token: string;
    }>();
    expect(await decrypt(row!.access_token, env.TOKEN_ENCRYPTION_KEY)).toBe('synthetic-new');
    expect(await decrypt(row!.refresh_token, env.TOKEN_ENCRYPTION_KEY)).toBe('synthetic-rotated');
  });

  it('다른 키의 인증 작업은 이전 AES 컨텍스트를 재사용하지 않는다', async () => {
    const original = tokenCipher(h.env.TOKEN_ENCRYPTION_KEY);
    const changed = tokenCipher('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=');
    const ciphertext = await original.encrypt('synthetic-private-token');
    await expect(original.decrypt(ciphertext)).resolves.toBe('synthetic-private-token');
    await expect(changed.decrypt(ciphertext)).rejects.toBeInstanceOf(Error);
    const rotated = await changed.encrypt('synthetic-rotated-token');
    await expect(changed.decrypt(rotated)).resolves.toBe('synthetic-rotated-token');
    await expect(original.decrypt(rotated)).rejects.toBeInstanceOf(Error);
  });
  if (runtime === 'durable')
    it.each(['before', 'after'])(
      '인증 RPC 응답 유실(%s)은 로컬 재갱신·즉시 발송 없이 D1 상태에서 복구한다',
      async (when) => {
        const env = await live();
        await dueSchedule(env, 1, NOW);
        const binding = env.AUTOMATION!;
        const originalGet = binding.get.bind(binding);
        let interrupted = false;
        binding.get = ((id: DurableObjectId) => {
          const stub = originalGet(id);
          return {
            ...stub,
            credentialToken: async (secrets: TokenSecrets) => {
              if (interrupted) return stub.credentialToken(secrets);
              interrupted = true;
              if (when === 'after') await stub.credentialToken(secrets);
              throw new Error('synthetic-secret-must-not-leak');
            },
          };
        }) as typeof binding.get;
        const calls = provider();
        await tick(env);
        expect(calls).toEqual({ refresh: when === 'after' ? 1 : 0, send: 0 });
        expect(await budget(env)).toBe(0);
        expect(
          await env.DB.prepare('SELECT state,claim_owner,error FROM deliveries').first(),
        ).toMatchObject({
          state: 'retry_wait',
          claim_owner: null,
          error: expect.not.stringContaining('synthetic-secret'),
        });
        vi.mocked(Date.now).mockReturnValue(NOW + 60_000);
        await tick(env);
        if (when === 'before') {
          expect(calls).toEqual({ refresh: 1, send: 0 });
          vi.mocked(Date.now).mockReturnValue(NOW + 120_000);
          await tick(env);
        }
        expect(calls).toEqual({ refresh: 1, send: 1 });
        expect(await budget(env)).toBe(1);
      },
    );
});
