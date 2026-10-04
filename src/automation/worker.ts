import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import { z } from 'zod';
import { CardFonts, cardSvg } from './svg';
import { type CardInput } from '../shared/model';
import { readBody } from '../worker/storage';
import { automationTick } from './engine';
import { changeSettings, runHistory, settingsView } from './settings';
import { relayClient, relayReady, withRelayStatus } from './relay-client';
import { readiness, type AutomationEnv } from './types';
import { credentialToken } from './credentials';
import { startTrial } from './trial';
import type { TokenReply, TokenSecrets } from '../shared/token-rpc';

let wasmReady: Promise<unknown> | undefined;
const fontIndex = z
  .array(
    z.object({
      offset: z.number().int().nonnegative(),
      length: z.number().int().positive(),
      ranges: z.array(z.tuple([z.number().int(), z.number().int()])),
    }),
  )
  .min(1)
  .max(200);
export class CardAutomation extends DurableObject<AutomationEnv> {
  // RPC only: no HTTP route or user-controlled method forwarding exposes this.
  async credentialToken(secrets: TokenSecrets): Promise<TokenReply> {
    return credentialToken(this.env, secrets, Date.now());
  }
  private fonts: Promise<CardFonts> | undefined;
  private loadFonts(): Promise<CardFonts> {
    if (!this.fonts)
      this.fonts = (async () => {
        const [indexResponse, packResponse] = await Promise.all([
          this.env.FONT_ASSETS.fetch('https://font.internal/fonts.json'),
          this.env.FONT_ASSETS.fetch('https://font.internal/fonts.bin'),
        ]);
        if (!indexResponse.ok || !packResponse.ok) throw new Error('FONT_ASSET');
        const index = fontIndex.parse(await indexResponse.json());
        const pack = await packResponse.arrayBuffer();
        if (pack.byteLength > 25 * 1024 * 1024) throw new Error('FONT_SIZE');
        return new CardFonts(
          index.map(({ offset, length, ranges }) => ({
            bytes: Buffer.from(pack, offset, length),
            ranges,
          })),
        );
      })().catch((e) => {
        this.fonts = undefined;
        throw e;
      });
    return this.fonts;
  }
  private async render(card: CardInput): Promise<Uint8Array<ArrayBuffer>> {
    wasmReady ??= initWasm(wasm).catch((e) => {
      wasmReady = undefined;
      throw e;
    });
    await wasmReady;
    const svg = cardSvg(card, await this.loadFonts(), 1);
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
    try {
      const rendered = renderer.render();
      try {
        return new Uint8Array(rendered.asPng());
      } finally {
        rendered.free();
      }
    } finally {
      renderer.free();
    }
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const relayKey = request.headers.get('X-Card-Relay-Key');
    const env: AutomationEnv = { ...this.env, ...(relayKey ? { AI_RELAY_KEY: relayKey } : {}) };
    try {
      if (path === '/tick' && request.method === 'POST') {
        await automationTick(env, {
          ai: relayClient(env),
          render: (card) => this.render(card),
          clock: Date.now,
        });
        return new Response(null, { status: 204 });
      }
      if (path === '/api/automation' && request.method === 'GET') {
        const view = await withRelayStatus(env, await settingsView(env));
        console.info({
          event: 'automation_site_status',
          configured: !view.missing.some(
            (key) => key === 'SITE_AI_KEYS' || key === 'SITE_AI_CONNECTION',
          ),
          available: view.available,
        });
        return Response.json(view);
      }
      if (path === '/api/automation/runs' && request.method === 'GET')
        return Response.json(await runHistory(env));
      const action =
        path === '/api/automation' && request.method === 'PUT'
          ? 'save'
          : path === '/api/automation/start' && request.method === 'POST'
            ? 'start'
            : path === '/api/automation/pause' && request.method === 'POST'
              ? 'pause'
              : path === '/api/automation/trial' && request.method === 'POST'
                ? 'trial'
                : null;
      if (!action) return new Response(null, { status: 404 });
      if (!request.headers.get('Content-Type')?.includes('application/json'))
        return new Response(null, { status: 415 });
      const body = z
        .object({ version: z.number().int().nonnegative(), settings: z.unknown().optional() })
        .strict()
        .parse(JSON.parse(new TextDecoder().decode(await readBody(request, 4096))));
      if (action === 'trial' && Object.hasOwn(body, 'settings'))
        return Response.json(
          { error: 'AUTOMATION_INPUT', message: '시험은 저장된 설정을 사용합니다.' },
          { status: 400 },
        );
      if (
        (action === 'start' || action === 'trial') &&
        readiness(env).length === 0 &&
        !(await relayReady(env))
      )
        return Response.json(
          { error: 'AUTOMATION_CONFIG', message: '사이트의 AI 연결 설정을 확인하세요.' },
          { status: 503 },
        );
      if (action === 'trial') await startTrial(env, body.version, Date.now());
      else await changeSettings(env, action, body.version, body.settings, Date.now());
      return Response.json(await settingsView(env));
    } catch (e) {
      const error = e as { status?: number; code?: string; message?: string };
      const invalid = e instanceof z.ZodError || e instanceof SyntaxError;
      return Response.json(
        {
          error: invalid ? 'AUTOMATION_INPUT' : (error.code ?? 'AUTOMATION_UNAVAILABLE'),
          message: invalid
            ? '설정 항목과 날짜를 확인하세요.'
            : error.status
              ? error.message
              : '자동 제작 상태를 확인할 수 없습니다. 잠시 후 다시 시도하세요.',
        },
        { status: invalid ? 400 : (error.status ?? 503) },
      );
    }
  }
}
// No public endpoint, including the font assets, even if routing is accidentally enabled.
export default { fetch: () => new Response(null, { status: 404 }) };
