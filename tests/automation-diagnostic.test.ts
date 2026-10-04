import { timingSafeEqual } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  diagnosticProbe,
  diagnosticRenderer,
} from '../experiments/automation-png/atlas-diagnostic';

it('진단 표식은 인스턴스별로 조립과 준비 순서를 분리한다', async () => {
  const worker = { fetch: async () => new Response('synthetic') };
  const first = diagnosticRenderer(worker),
    second = diagnosticRenderer(worker);
  const env = { ATLAS_ASSETS: {} as Fetcher };
  const get = (path: string) => new Request('https://private.test/lean/800/pipeline/' + path);
  const glyph = await first.fetch(get('glyphs/expression/0'), env);
  const asm1 = await first.fetch(get('assemble/expression'), env);
  const asm2 = await first.fetch(get('assemble/expression'), env);
  const other = await second.fetch(get('assemble/expression'), env);
  expect(glyph.headers.get('X-Lab-Glyph-Ordinal')).toBe('1');
  expect(asm1.headers.get('X-Lab-Assembly-Ordinal')).toBe('1');
  expect(asm2.headers.get('X-Lab-Assembly-Ordinal')).toBe('2');
  expect(asm1.headers.get('X-Lab-Isolate')).toBe(asm2.headers.get('X-Lab-Isolate'));
  expect(other.headers.get('X-Lab-Isolate')).not.toBe(asm1.headers.get('X-Lab-Isolate'));
});

it('진단 입구는 인증·메서드·고정 경로·호출 식별자를 확인하고 하나의 준비 호출만 전달한다', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value: timingSafeEqual,
    configurable: true,
  });
  try {
    const token = 'synthetic-diagnostic-test-token-32',
      call = 'a'.repeat(32);
    const fetch = vi.fn(
      async () => new Response('frame', { headers: { 'X-Lab-Isolate': 'synthetic' } }),
    );
    const original = { fetch: vi.fn(async () => new Response('unused')) };
    const probe = diagnosticProbe(original);
    const env = { BENCH_TOKEN: token, RENDERER: { fetch } as unknown as Fetcher };
    const request = (path: string, auth = token, id = call, method = 'POST') =>
      new Request('https://probe.test' + path, {
        method,
        headers: { Authorization: `Bearer ${auth}`, 'X-Lab-Call': id },
      });
    const path = '/diagnostic/glyphs/800/expression/0';
    for (const [req, status] of [
      [request(path, 'wrong'), 401],
      [request(path, token, call, 'GET'), 405],
      [request(path, token, 'unsafe'), 400],
      [request(path + '?url=https://other.test'), 404],
      [request('/diagnostic/glyphs/1080/expression/0'), 404],
      [request('/diagnostic/glyphs/800/unknown/0'), 404],
      [request('/diagnostic/glyphs/800/expression/999'), 404],
    ] as const)
      expect((await probe.fetch(req, env)).status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
    expect(original.fetch).not.toHaveBeenCalled();
    expect((await probe.fetch(request(path), env)).status).toBe(200);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://png.internal/lean/800/pipeline/glyphs/expression/0',
      { headers: { 'X-Lab-Call': call } },
    );
  } finally {
    if (descriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', descriptor);
    else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
  }
});

it('조립 표식과 호출 식별자는 본문을 바꾸지 않고 전달된다', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value: timingSafeEqual,
    configurable: true,
  });
  try {
    const body = Uint8Array.of(1, 2, 3),
      call = 'b'.repeat(32),
      token = 'synthetic-diagnostic-test-token-32';
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Lab-Call')).toBe(call);
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/octet-stream');
      expect(init?.body).toBe(body);
      return new Response('png', {
        headers: { 'X-Lab-Isolate': 'test-isolate', 'X-Lab-Assembly-Ordinal': '2' },
      });
    });
    const probe = diagnosticProbe({
      fetch: async (_req, env) =>
        env.RENDERER.fetch('https://png.internal/lean/720/pipeline/assemble/long', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        }),
    });
    const response = await probe.fetch(
      new Request('https://probe.test/probe/long/atlas_lean720', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Lab-Call': call },
      }),
      { BENCH_TOKEN: token, RENDERER: { fetch } as unknown as Fetcher },
    );
    expect(await response.text()).toBe('png');
    expect(response.headers.get('X-Lab-Assembly-Ordinal')).toBe('2');
    expect(response.headers.get('X-Lab-Isolate')).toBe('test-isolate');
  } finally {
    if (descriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', descriptor);
    else Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual');
  }
});
