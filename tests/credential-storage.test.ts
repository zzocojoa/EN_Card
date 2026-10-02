import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { accessToken, retryTokenRefresh } from '../src/worker/auth';
import { encrypt } from '../src/worker/crypto';
import { runEngine } from '../src/worker/engine';
import type { Credentials, Env } from '../src/worker/types';
import { dueSchedule, harness, NOW, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,?,?,1,'connected')",
  )
    .bind(
      await encrypt('stored-access', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('stored-refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW + 3600_000,
      NOW + 86400_000,
    )
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await h.mf.dispose();
});
async function stored(): Promise<Credentials> {
  return (await h.env.DB.prepare('SELECT * FROM credentials').first<Credentials>())!;
}
const faults = ['wrong-key', 'invalid-key', 'broken-cipher'] as const;
for (const path of ['access', 'refresh'] as const)
  it.each(faults)(
    `R7 ${path}의 %s 오류는 호출·예산 없이 중지하고 claim을 정리한다`,
    async (fault) => {
      const id = await dueSchedule(h.env, 1, NOW);
      if (path === 'refresh')
        await h.env.DB.prepare('UPDATE credentials SET expires_at=?')
          .bind(NOW - 1)
          .run();
      const env: Env = { ...h.env };
      if (fault === 'wrong-key')
        env.TOKEN_ENCRYPTION_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
      if (fault === 'invalid-key') env.TOKEN_ENCRYPTION_KEY = 'not-base64!';
      if (fault === 'broken-cipher')
        await h.env.DB.prepare(`UPDATE credentials SET ${path}_token=?`)
          .bind('invalid-cipher.secret-cipher-marker')
          .run();
      const before = await stored();
      const usage = (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all())
        .results;
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const transport = vi.fn(async () => {
        throw new Error('unexpected provider call');
      });
      const sender = vi.fn(async () => ({ outcome: 'sent' as const, detail: 'unexpected send' }));
      await expect(
        runEngine(env, {
          mode: 'live',
          clock: () => NOW,
          token: () => accessToken(env, NOW, transport),
          sender,
        }),
      ).resolves.toMatchObject({ processed: 0 });
      const row = await stored();
      expect(row).toMatchObject({
        status: 'needs_reconnect',
        refresh_failure: 'configuration',
        version: 2,
        refresh_attempts: 0,
        refresh_retry_at: null,
        lock_owner: null,
        lock_until: null,
        refresh_http_status: null,
        refresh_provider_error: null,
        refresh_provider_code: null,
        access_token: before.access_token,
        refresh_token: before.refresh_token,
      });
      const delivery = await h.env.DB.prepare(
        'SELECT state,error,attempts,claim_owner,claim_until FROM deliveries WHERE schedule_id=?',
      )
        .bind(id)
        .first<{ state: string; error: string }>();
      expect(delivery).toMatchObject({
        state: 'blocked',
        attempts: 0,
        claim_owner: null,
        claim_until: null,
      });
      expect(delivery?.error).toContain('저장 인증정보');
      expect(
        await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
      ).toMatchObject({ enabled: 0, reason: 'needs_reconnect' });
      await expect(accessToken(env, NOW + 60_000, transport)).rejects.toMatchObject({
        code: 'TOKEN_STORAGE_CONFIG',
        tokenFailure: 'configuration',
        status: 503,
      });
      await runEngine(env, {
        mode: 'live',
        clock: () => NOW + 60_000,
        token: () => accessToken(env, NOW + 60_000, transport),
        sender,
      });
      expect(transport).not.toHaveBeenCalled();
      expect(sender).not.toHaveBeenCalled();
      expect(
        (await h.env.DB.prepare('SELECT * FROM usage_counters ORDER BY day').all()).results,
      ).toEqual(usage);
      expect(await h.env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first('n')).toBe(
        0,
      );
      const output = JSON.stringify([delivery, warning.mock.calls, errors.mock.calls]);
      expect(output).not.toContain('secret-cipher-marker');
      expect(output).not.toContain(env.TOKEN_ENCRYPTION_KEY);
      expect(output).not.toContain('stored-access');
      expect(output).not.toContain('stored-refresh');
    },
  );

async function storageFailure(): Promise<void> {
  await expect(
    accessToken({ ...h.env, TOKEN_ENCRYPTION_KEY: 'not-base64!' }, NOW, async () => {
      throw new Error('unexpected provider call');
    }),
  ).rejects.toMatchObject({ code: 'TOKEN_STORAGE_CONFIG' });
}
it('R7 원래 키를 복원하면 토큰을 보존해 수동 복구하며 예약은 중지 상태를 유지한다', async () => {
  const id = await dueSchedule(h.env, 1, NOW);
  const before = await stored();
  await storageFailure();
  await retryTokenRefresh(h.env, 2, NOW);
  expect(await stored()).toMatchObject({
    status: 'connected',
    version: 3,
    refresh_failure: null,
    refresh_attempts: 0,
    access_token: before.access_token,
    refresh_token: before.refresh_token,
  });
  const transport = vi.fn(async () => {
    throw new Error('unexpected provider call');
  });
  await expect(accessToken(h.env, NOW, transport)).resolves.toMatchObject({
    token: 'stored-access',
    version: 3,
  });
  expect(transport).not.toHaveBeenCalled();
  expect(
    await h.env.DB.prepare('SELECT enabled,reason FROM schedules WHERE id=?').bind(id).first(),
  ).toMatchObject({ enabled: 0, reason: 'needs_reconnect' });
});
it('R7 잘못된 키로 복구를 확인해도 상태·토큰·버전은 변하지 않는다', async () => {
  await storageFailure();
  const before = await stored();
  await expect(
    retryTokenRefresh({ ...h.env, TOKEN_ENCRYPTION_KEY: 'not-base64!' }, 2, NOW),
  ).rejects.toMatchObject({ code: 'TOKEN_STORAGE_CONFIG', status: 503 });
  expect(await stored()).toEqual(before);
});
it('R7 키를 복원해도 리프레시가 만료됐으면 다시 연결해야 한다', async () => {
  await storageFailure();
  await h.env.DB.prepare('UPDATE credentials SET refresh_expires_at=?').bind(NOW).run();
  await expect(retryTokenRefresh(h.env, 2, NOW)).rejects.toMatchObject({
    code: 'TOKEN_RECONNECT_REQUIRED',
    status: 409,
  });
  expect(await stored()).toMatchObject({
    status: 'needs_reconnect',
    refresh_failure: 'invalid',
    version: 3,
  });
});
it('R7 복호화 실패 기록 중 새 연결이 완료되면 새 인증 상태를 덮어쓰지 않는다', async () => {
  const nextAccess = await encrypt('new-connection-access', h.env.TOKEN_ENCRYPTION_KEY);
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async () => {
    await h.env.DB.prepare('UPDATE credentials SET access_token=?,version=version+1')
      .bind(nextAccess)
      .run();
    throw new Error('secret-cipher-marker');
  });
  await expect(
    accessToken(h.env, NOW, async () => {
      throw new Error('unexpected call');
    }),
  ).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
  expect(await stored()).toMatchObject({
    status: 'connected',
    version: 2,
    refresh_failure: null,
    access_token: nextAccess,
  });
});
it('R7 복호화 실패 기록은 다른 실행의 갱신 잠금을 지우지 않는다', async () => {
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async () => {
    await h.env.DB.prepare('UPDATE credentials SET lock_owner=?,lock_until=?,refresh_attempts=1')
      .bind('other-refresh', NOW + 30_000)
      .run();
    throw new Error('secret-cipher-marker');
  });
  await expect(
    accessToken(h.env, NOW, async () => {
      throw new Error('unexpected call');
    }),
  ).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
  expect(await stored()).toMatchObject({
    status: 'connected',
    version: 1,
    refresh_failure: null,
    lock_owner: 'other-refresh',
    lock_until: NOW + 30_000,
    refresh_attempts: 1,
  });
});
it('R7 수동 복구 검증 중 새 연결이 완료되면 오래된 복구 요청을 거부한다', async () => {
  await storageFailure();
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementationOnce(async (...args) => {
    await h.env.DB.prepare(
      "UPDATE credentials SET status='connected',refresh_failure=NULL,version=version+1",
    ).run();
    return decrypt(...args);
  });
  await expect(retryTokenRefresh(h.env, 2, NOW)).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
  expect(await stored()).toMatchObject({ status: 'connected', version: 3, refresh_failure: null });
});
it('R7 수동 복구는 잠금이 남아 있으면 이를 보존한다', async () => {
  await storageFailure();
  await h.env.DB.prepare('UPDATE credentials SET lock_owner=?,lock_until=?')
    .bind('other-refresh', NOW + 30_000)
    .run();
  const before = await stored();
  await expect(retryTokenRefresh(h.env, 2, NOW)).rejects.toMatchObject({ code: 'TOKEN_CHANGED' });
  expect(await stored()).toEqual(before);
});
it('외부 갱신 성공 후 암호화 저장 실패는 기존 uncertain 정책을 유지한다', async () => {
  await h.env.DB.prepare('UPDATE credentials SET expires_at=?')
    .bind(NOW - 1)
    .run();
  const before = await stored();
  vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValueOnce(new Error('secret-cipher-marker'));
  const transport = vi.fn(async () => Response.json({ access_token: 'new', expires_in: 3600 }));
  await expect(accessToken(h.env, NOW, transport)).rejects.toMatchObject({
    code: 'TOKEN_UNCERTAIN',
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await stored()).toMatchObject({
    status: 'needs_reconnect',
    refresh_failure: 'uncertain',
    version: 2,
    refresh_attempts: 1,
    lock_owner: null,
    access_token: before.access_token,
    refresh_token: before.refresh_token,
  });
});
