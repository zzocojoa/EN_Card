import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import probe from '../experiments/automation-png/probe';

describe('고정 PNG 원격 시험 입구', () => {
  it('Secret 미설정·잘못된 인증·메서드·경로는 서비스 호출을 막는다', async () => {
    const fetch = vi.fn(async () => new Response('png'));
    const env = { RENDERER: { fetch } as unknown as Fetcher, BENCH_TOKEN: 'a'.repeat(32) };
    const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
    Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
      value: timingSafeEqual,
      configurable: true,
    });
    try {
      const request = (path: string, token: string, method = 'POST') =>
        new Request(`https://probe.test${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
        });
      expect(
        (
          await probe.fetch(request('/probe/expression/wasm', env.BENCH_TOKEN), {
            ...env,
            BENCH_TOKEN: '',
          })
        ).status,
      ).toBe(503);
      expect((await probe.fetch(request('/probe/expression/wasm', 'wrong'), env)).status).toBe(401);
      expect(
        (await probe.fetch(request('/probe/expression/wasm', 'b'.repeat(32)), env)).status,
      ).toBe(401);
      expect(
        (await probe.fetch(request('/probe/expression/wasm', env.BENCH_TOKEN, 'GET'), env)).status,
      ).toBe(405);
      expect(
        (await probe.fetch(request('/probe/https://other.test/native', env.BENCH_TOKEN), env))
          .status,
      ).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        (await probe.fetch(request('/probe/long_comparison/native', env.BENCH_TOKEN), env)).status,
      ).toBe(200);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        'https://png.internal/render/long_comparison?encoder=native',
      );
      fetch.mockClear();
      fetch.mockResolvedValueOnce(new Response('failed', { status: 500 }));
      expect(
        (await probe.fetch(request('/probe/expression/bands', env.BENCH_TOKEN), env)).status,
      ).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(1);
      fetch.mockClear();
      fetch.mockResolvedValueOnce(new Response('missing headers'));
      expect(
        (await probe.fetch(request('/probe/expression/bands', env.BENCH_TOKEN), env)).status,
      ).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      if (descriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', descriptor);
      else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
    }
  });
});
