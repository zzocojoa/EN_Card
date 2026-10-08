import { DatabaseSync } from 'node:sqlite';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deriveRelayKey,
  RELAY_ORIGIN,
  RELAY_PATH,
  signedRelayHeaders,
} from '../src/shared/automation-relay';
import { handleCardAutomationRelay, type RelaySiteConfig } from '../src/automation/relay-server';
import { relayClient, relayReady, withRelayStatus } from '../src/automation/relay-client';
import { readiness } from '../src/automation/types';
import { automationApi, automationCron } from '../src/worker/automation';
import type { AutomationEnv } from '../src/automation/types';
import type { AiRequest } from '../src/automation/providers';
import type { Env } from '../src/worker/types';

const config: RelaySiteConfig = {
  card_studio_enabled: 'true',
  card_studio_owner_id: 'owner',
  card_studio_bridge_secret: 'bridge-secret-with-at-least-thirty-two-characters',
  google_ai_enabled: 'true',
  google_api: 'site-google-secret',
  groq_api: 'site-groq-secret',
};
let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    'CREATE TABLE card_automation_nonces(nonce TEXT PRIMARY KEY,expires_at INTEGER NOT NULL); CREATE INDEX nonce_expiry ON card_automation_nonces(expires_at);',
  );
  config.DB = {
    prepare(sql: string) {
      return {
        async first() {
          return sqlite.prepare(sql).get() ?? null;
        },
        bind(...args: (string | number | null)[]) {
          return { sql, args };
        },
      };
    },
    async batch(statements: { sql: string; args: (string | number | null)[] }[]) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map((s) => ({
          meta: { changes: Number(sqlite.prepare(s.sql).run(...s.args).changes) },
        }));
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
});
afterEach(() => sqlite.close());
const card = {
  template: 'expression',
  expression: 'Take your time',
  meaning_ko: '천천히 해',
  example_en: 'Take your time.',
  example_ko: '천천히 해.',
  note_ko: '',
  base_expression: '',
  base_meaning_ko: '',
};
const review = {
  natural: true,
  meaning: true,
  grammar: true,
  translation: true,
  level: true,
  comparison: true,
  issues: [],
};
const input: AiRequest = {
  provider: 'google',
  stage: 'draft',
  settings: {
    topic: '일상',
    base_expression: '',
    level: '초급',
    template: 'expression',
    start_date: '2026-10-03',
    end_date: null,
    time: '23:00',
    cards_per_day: 1,
  },
  content: null,
  review: null,
  recent: [],
};
const now = Date.now();
const key = () => deriveRelayKey(config.card_studio_bridge_secret!, config.card_studio_owner_id!);
async function request(body: unknown, time = now) {
  const text = JSON.stringify(body);
  return new Request(RELAY_ORIGIN + RELAY_PATH, {
    method: 'POST',
    headers: await signedRelayHeaders(await key(), text, time),
    body: text,
  });
}
const call = () => ({ action: 'call', free: 'google_groq_free', input });

it('does not report ready before the nonce migration exists', async () => {
  sqlite.exec('DROP TABLE card_automation_nonces');
  const provider = vi.fn<typeof fetch>();
  const result = await handleCardAutomationRelay(
    await request({ action: 'status' }),
    config,
    provider,
    () => now,
  );
  expect(await result.json()).toEqual({ ready: false });
  expect(provider).not.toHaveBeenCalled();
});

it('atomically consumes a signed nonce before AI even across concurrent handler instances', async () => {
  const signed = await request(call());
  const provider = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(card) }] } }],
    }),
  );
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      handleCardAutomationRelay(
        signed.clone() as unknown as Request,
        { ...config },
        provider,
        () => now,
      ),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare('SELECT count(*) AS n FROM card_automation_nonces').get()?.n).toBe(1);
});

it('rechecks signature time after reading the body and cancels interrupted bodies', async () => {
  const signed = await request(call());
  const text = await signed.text();
  let clock = now,
    cancelled = false;
  const provider = vi.fn<typeof fetch>();
  const delayed = new Request(RELAY_ORIGIN + RELAY_PATH, {
    method: 'POST',
    headers: signed.headers,
    body: new ReadableStream(
      {
        pull(controller) {
          clock += 61001;
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    ),
    duplex: 'half',
  } as RequestInit);
  expect((await handleCardAutomationRelay(delayed, config, provider, () => clock)).status).toBe(
    403,
  );
  const abort = new AbortController();
  const stalled = new Request(RELAY_ORIGIN + RELAY_PATH, {
    method: 'POST',
    headers: signed.headers,
    body: new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    signal: abort.signal,
    duplex: 'half',
  } as RequestInit);
  const pending = handleCardAutomationRelay(stalled, config, provider, () => now);
  abort.abort();
  expect((await pending).ok).toBe(false);
  expect(cancelled).toBe(true);
  expect(provider).not.toHaveBeenCalled();
});

it('fails closed on nonce-store failure and malformed relay status', async () => {
  const provider = vi.fn<typeof fetch>();
  const broken = {
    ...config,
    DB: {
      ...config.DB,
      batch: async () => {
        throw new Error('private database detail');
      },
    } as unknown as D1Database,
  };
  expect(
    (await handleCardAutomationRelay(await request(call()), broken, provider, () => now)).status,
  ).toBe(503);
  expect(provider).not.toHaveBeenCalled();
  await expect(
    relayReady(await env(), async () => Response.json({ ready: 'yes' })),
  ).rejects.toMatchObject({ code: 'invalid' });
});
async function env() {
  return {
    AI_RELAY_KEY: await key(),
    AUTOMATION_MODE: 'live',
    AI_FREE_CONFIRMED: 'google_groq_free',
    SEND_MODE: 'live',
    COST_MODE: 'free_only',
  } as AutomationEnv;
}

it('records only the HTTP status and a fixed error code for a non-JSON relay failure', async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(
      relayReady(
        await env(),
        async () =>
          new Response('private upstream detail', {
            status: 403,
            headers: { 'Set-Cookie': 'private-cookie' },
          }),
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(log).toHaveBeenCalledExactlyOnceWith({
      event: 'automation_relay_status_failed',
      httpStatus: 403,
      code: 'invalid',
    });
  } finally {
    log.mockRestore();
  }
});

it('checks Site readiness while automation is off without enabling it or making AI calls', async () => {
  const runtime: AutomationEnv = {
    ...(await env()),
    AUTOMATION_MODE: 'off',
    AI_FREE_CONFIRMED: 'unconfirmed',
    SEND_MODE: 'dry_run',
  };
  const original = {
    settings: null,
    version: 0,
    enabled: false,
    reason: null,
    next_due_at: null,
    available: false,
    missing: readiness(runtime),
  };
  const provider = vi.fn<typeof fetch>();
  const transport = vi.fn<typeof fetch>(async (url, init) =>
    handleCardAutomationRelay(new Request(url, init), config, provider),
  );
  expect(await withRelayStatus(runtime, original, transport)).toEqual(original);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ action: 'status' });
  expect(provider).not.toHaveBeenCalled();
  expect(sqlite.prepare('SELECT count(*) AS n FROM card_automation_nonces').get()?.n).toBe(0);
  await expect(relayClient(runtime, transport)(input)).rejects.toMatchObject({ code: 'config' });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('keeps settings readable and distinguishes missing Site setup from transport failure', async () => {
  const runtime = { ...(await env()), AUTOMATION_MODE: 'off', AI_FREE_CONFIRMED: 'unconfirmed' };
  const view = {
    settings: input.settings,
    version: 7,
    enabled: false,
    reason: 'paused',
    next_due_at: null,
    available: false,
    missing: readiness(runtime),
  };
  for (const [transport, error] of [
    [async () => Response.json({ ready: false }), 'SITE_AI_KEYS'],
    [
      async () => {
        throw new Error('private connection detail');
      },
      'SITE_AI_CONNECTION',
    ],
  ] as const) {
    const result = await withRelayStatus(runtime, view, transport);
    expect(result).toEqual({ ...view, missing: [...view.missing, error] });
  }
  const noKey = { ...runtime, AI_RELAY_KEY: '' };
  const transport = vi.fn<typeof fetch>();
  const disconnected = { ...view, missing: readiness(noKey) };
  expect(await withRelayStatus(noKey, disconnected, transport)).toEqual(disconnected);
  expect(transport).not.toHaveBeenCalled();
});

it('checks existing Site secrets without contacting either AI provider', async () => {
  const transport = vi.fn<typeof fetch>();
  const result = await handleCardAutomationRelay(
    await request({ action: 'status' }),
    config,
    transport,
    () => now,
  );
  expect(await result.json()).toEqual({ ready: true });
  expect(transport).not.toHaveBeenCalled();
  expect(await key()).not.toContain(config.card_studio_bridge_secret);
  expect(await deriveRelayKey(config.card_studio_bridge_secret!, 'different-owner')).not.toBe(
    await key(),
  );
});

it.each(['google', 'groq'] as const)(
  'relays bounded expression-only suggestions through %s with no full-card schema',
  async (provider) => {
    const result = { expressions: ['Keep going', 'Take it easy'] };
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        provider === 'google'
          ? {
              candidates: [
                { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } },
              ],
            }
          : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] },
      ),
    );
    const response = await handleCardAutomationRelay(
      await request({ ...call(), input: { ...input, provider, stage: 'select' } }),
      config,
      transport,
      () => now,
    );
    expect(await response.json()).toEqual({ result });
    const body = JSON.parse(String(transport.mock.calls[0]![1]?.body));
    const schema =
      provider === 'google'
        ? body.generationConfig.responseJsonSchema
        : body.response_format.json_schema.schema;
    expect(schema.properties.expressions.maxItems).toBe(10);
    expect(schema.properties.example_en).toBeUndefined();
    expect(String(transport.mock.calls[0]![1]?.body)).toContain('expressions only');
  },
);

it('binds draft/correction prompts to the reserved expression and rejects invalid selection output', async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(card) }] } }],
    }),
  );
  for (const stage of ['draft', 'revise'] as const) {
    const response = await handleCardAutomationRelay(
      await request({
        ...call(),
        input: {
          ...input,
          stage,
          expression: 'Take your time',
          content: stage === 'revise' ? card : null,
          review: stage === 'revise' ? review : null,
        },
      }),
      config,
      transport,
      () => now,
    );
    expect(response.status).toBe(200);
    expect(String(transport.mock.calls.at(-1)![1]?.body)).toContain(
      'Use the supplied expression exactly',
    );
  }
  const invalid = await handleCardAutomationRelay(
    await request({ ...call(), input: { ...input, stage: 'select' } }),
    config,
    transport,
    () => now,
  );
  expect(invalid.status).toBe(502);
  expect(await invalid.json()).toMatchObject({ error: 'invalid' });
  const calls = transport.mock.calls.length;
  const malformed = await handleCardAutomationRelay(
    await request({
      ...call(),
      input: { ...input, stage: 'select', expression: 'Unexpected target' },
    }),
    config,
    transport,
    () => now,
  );
  expect(malformed.status).toBe(400);
  expect(transport).toHaveBeenCalledTimes(calls);
});

it.each(['google', 'groq'] as const)(
  'uses only the Site-owned %s key, a pinned model, and strict output',
  async (provider) => {
    const stage = provider === 'google' ? 'draft' : 'review';
    const result = stage === 'draft' ? card : review;
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        provider === 'google'
          ? {
              candidates: [
                { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } },
              ],
            }
          : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] },
      ),
    );
    const response = await handleCardAutomationRelay(
      await request({
        ...call(),
        input: { ...input, provider, stage, content: stage === 'review' ? card : null },
      }),
      config,
      transport,
      () => now,
    );
    expect(await response.json()).toEqual({ result });
    const [url, options] = transport.mock.calls[0]!;
    expect(String(url)).toBe(
      provider === 'google'
        ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent'
        : 'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(options?.redirect).toBe('manual');
    const headers = new Headers(options?.headers);
    expect(headers.get(provider === 'google' ? 'x-goog-api-key' : 'Authorization')).toBe(
      provider === 'google' ? config.google_api : `Bearer ${config.groq_api}`,
    );
    expect(String(options?.body)).not.toContain('site-google-secret');
    expect(String(options?.body)).not.toContain('site-groq-secret');
  },
);

it('rejects unsigned, expired, future, tampered, wrong-owner, browser and off-site requests before AI', async () => {
  const transport = vi.fn<typeof fetch>();
  const valid = await request(call());
  const variants = [
    new Request(valid, { headers: { 'Content-Type': 'application/json' } }),
    await request(call(), now - 60001),
    await request(call(), now + 60001),
    new Request(await request(call()), { body: JSON.stringify({ ...call(), free: 'paid' }) }),
    new Request(await request(call()), {
      headers: { ...Object.fromEntries(valid.headers), Origin: RELAY_ORIGIN },
    }),
    new Request(await request(call()), {
      headers: { ...Object.fromEntries(valid.headers), Cookie: 'session=browser' },
    }),
    new Request('https://untrusted.test' + RELAY_PATH, {
      method: 'POST',
      headers: valid.headers,
      body: JSON.stringify(call()),
    }),
  ];
  for (const req of variants)
    expect((await handleCardAutomationRelay(req, config, transport, () => now)).ok).toBe(false);
  expect(
    (
      await handleCardAutomationRelay(
        await request(call()),
        { ...config, card_studio_owner_id: 'other' },
        transport,
        () => now,
      )
    ).status,
  ).toBe(403);
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  { google_api: '' },
  { groq_api: '' },
  { google_ai_enabled: 'false' },
  { groq_ai_enabled: 'false' },
  { card_studio_enabled: 'false' },
])('stops when required existing Site configuration is absent: %j', async (change) => {
  const transport = vi.fn<typeof fetch>();
  expect(
    (
      await handleCardAutomationRelay(
        await request(call()),
        { ...config, ...change },
        transport,
        () => now,
      )
    ).ok,
  ).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it('rejects injected model/URL/tools, unconfirmed cost, and oversized input without provider calls', async () => {
  const transport = vi.fn<typeof fetch>();
  for (const body of [
    { ...call(), model: 'other' },
    { ...call(), free: 'unconfirmed' },
    { ...call(), input: { ...input, url: 'https://bad.test' } },
    { ...call(), input: { ...input, tools: ['execute'] } },
    { ...call(), input: { ...input, recent: Array(51).fill('word') } },
    { ...call(), extra: 'x'.repeat(65537) },
  ])
    expect(
      (await handleCardAutomationRelay(await request(body), config, transport, () => now)).ok,
    ).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it('DO-to-Site adapter round-trips safe results and preserves sanitized failure categories', async () => {
  const provider = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(card) }] } }],
    }),
  );
  const transport: typeof fetch = async (url, init) =>
    handleCardAutomationRelay(new Request(url, init), config, provider);
  const runtime = await env();
  expect(await relayReady(runtime, transport)).toBe(true);
  expect(provider).not.toHaveBeenCalled();
  expect(await relayClient(runtime, transport)(input)).toEqual(card);
  provider.mockImplementation(async () => new Response('private token details', { status: 429 }));
  await expect(relayClient(runtime, transport)(input)).rejects.toMatchObject({
    code: 'quota',
    httpStatus: 429,
    message: 'quota',
  });
  for (const change of [
    { SEND_MODE: 'dry_run' },
    { AI_FREE_CONFIRMED: 'unconfirmed' },
    { AUTOMATION_MODE: 'off' },
  ]) {
    provider.mockClear();
    await expect(
      relayClient({ ...runtime, ...change } as AutomationEnv, transport)(input),
    ).rejects.toMatchObject({ code: 'config' });
    expect(provider).not.toHaveBeenCalled();
  }
});

it('main Worker supplies only its own scoped key through the private DO binding', async () => {
  const fetcher = vi.fn(async () => Response.json([]));
  const main = {
    APP_ORIGIN: 'https://cards.example.test',
    SEND_MODE: 'live',
    STUDIO_ORIGIN: RELAY_ORIGIN,
    STUDIO_OWNER_ID: config.card_studio_owner_id,
    STUDIO_BRIDGE_SECRET: config.card_studio_bridge_secret,
    AUTOMATION: { idFromName: () => ({}), get: () => ({ fetch: fetcher }) },
  } as unknown as Env;
  await automationApi(
    new Request(main.APP_ORIGIN + '/api/automation/runs', {
      headers: { 'X-Card-Relay-Key': 'forged' },
    }),
    main,
  );
  await automationCron(main);
  for (const [req] of fetcher.mock.calls as unknown as [Request][]) {
    expect(req.headers.get('X-Card-Relay-Key')).toBe(await key());
    expect([...req.headers.values()].join()).not.toContain(config.card_studio_bridge_secret);
  }
  fetcher.mockClear();
  await automationApi(new Request(main.APP_ORIGIN + '/api/automation/runs'), {
    ...main,
    STUDIO_ORIGIN: 'https://bad.test',
  });
  expect((fetcher.mock.calls[0] as unknown as [Request])[0].headers.has('X-Card-Relay-Key')).toBe(
    false,
  );
});
