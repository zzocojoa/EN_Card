import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import { CardFonts, cardSvg, type FontSource } from './svg';
import { rasterize } from './raster';
import { durableInput, DURABLE_ATTEMPTS_PER_SLOT, DURABLE_BODY_LIMIT } from './durable-contract';
import { durableRoute } from './durable-route';
import { readBody, saveCard, uploadImage } from '../../src/worker/storage';
import type { Env } from '../../src/worker/types';

type LabEnv = { FONT_ASSETS: Fetcher; DB: D1Database; CARD_IMAGES: KVNamespace };
type Asset = { id: string; public_id: string; bytes: number; created_at: number };
type Result = {
  asset: Asset;
  card_id: string;
  width: 1080;
  height: 1080;
  timings_ms: Record<string, number>;
};
type Stage = 'prepare' | 'layout' | 'render_validate' | 'store_card' | 'store_asset' | 'commit';
type Job = {
  hash: string;
  status: 'started' | 'complete' | 'failed';
  result?: Result;
  failed_stage?: Stage;
  card_id?: string;
  asset_id?: string;
};
type FontEntry = { offset: number; length: number; ranges: [number, number][] };
let wasmReady: Promise<unknown> | undefined;

// Explicit lab only: temporary DB/KV, no credentials, AI, schedule or send bindings.
// Instantiation runs inside the DO handler, never in the public caller's startup.
export class CardPngTrial extends DurableObject<LabEnv> {
  private fonts: Promise<CardFonts> | undefined;

  private async loadFonts(): Promise<CardFonts> {
    const [indexResponse, packResponse] = await Promise.all([
      this.env.FONT_ASSETS.fetch('https://font.internal/fonts.json'),
      this.env.FONT_ASSETS.fetch('https://font.internal/fonts.bin'),
    ]);
    if (!indexResponse.ok || !packResponse.ok) throw new Error('FONT_ASSET');
    const index = await indexResponse.json<FontEntry[]>();
    const pack = await packResponse.arrayBuffer();
    const sources: FontSource[] = index.map(({ offset, length, ranges }) => ({
      bytes: Buffer.from(pack, offset, length),
      ranges,
    }));
    return new CardFonts(sources);
  }

  async fetch(request: Request): Promise<Response> {
    const route = durableRoute(new URL(request.url).pathname);
    if (!route) return new Response('Not found', { status: 404 });
    if (route.action === 'image') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const job = await this.ctx.storage.get<Job>(`job:${route.job}`);
      if (job?.status !== 'complete' || !job.result)
        return new Response('Not ready', { status: 404 });
      const png = await this.env.CARD_IMAGES.get(job.result.asset.id, 'stream');
      return png
        ? new Response(png, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
          })
        : new Response('Image unavailable', { status: 503 });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let input: ReturnType<typeof durableInput.parse>;
    try {
      if (request.headers.get('Content-Type') !== 'application/json')
        return new Response('JSON required', { status: 415 });
      input = durableInput.parse(
        JSON.parse(new TextDecoder().decode(await readBody(request, DURABLE_BODY_LIMIT))),
      );
    } catch {
      return new Response('Invalid bounded card input', { status: 400 });
    }
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))),
    ).toString('hex');
    // Keep this bounded trial serial across awaited font/storage operations.
    // A durable started marker makes interruption fail closed instead of uploading twice.
    return this.ctx.blockConcurrencyWhile(async () => {
      const key = `job:${input.job}`;
      const existing = await this.ctx.storage.get<Job>(key);
      if (existing) {
        if (existing.hash !== hash) return new Response('Job content conflict', { status: 409 });
        if (existing.status !== 'complete' || !existing.result)
          return new Response('Job needs inspection', { status: 409 });
        return Response.json({ ...existing.result, reused: true });
      }
      const reserved = await this.ctx.storage.transaction(async (txn) => {
        const attempts = (await txn.get<number>('attempts')) ?? 0;
        if (attempts >= DURABLE_ATTEMPTS_PER_SLOT) return false;
        await txn.put({ attempts: attempts + 1, [key]: { hash, status: 'started' } satisfies Job });
        return true;
      });
      if (!reserved) return new Response('Trial render quota reached', { status: 429 });
      let stage: Stage = 'prepare';
      let cardId: string | undefined;
      let assetId: string | undefined;
      try {
        const start = performance.now();
        wasmReady ??= initWasm(wasm);
        this.fonts ??= this.loadFonts().catch((error: unknown) => {
          this.fonts = undefined;
          throw error;
        });
        const [, fonts] = await Promise.all([wasmReady, this.fonts]);
        const prepared = performance.now();
        stage = 'layout';
        const svg = cardSvg(input.card, fonts, input.number);
        const laidOut = performance.now();
        stage = 'render_validate';
        const png = rasterize(svg);
        const rendered = performance.now();
        const env: Env = {
          DB: this.env.DB,
          CARD_IMAGES: this.env.CARD_IMAGES,
          ASSETS: this.env.FONT_ASSETS,
          APP_ORIGIN: 'https://png-trial.invalid',
          COST_MODE: 'free_only',
          SEND_MODE: 'dry_run',
          SETUP_TOKEN: '',
          SESSION_SECRET: '',
          TOKEN_ENCRYPTION_KEY: '',
        };
        stage = 'store_card';
        const card = await saveCard(input.card, null, null, env, Date.now());
        cardId = card.id;
        stage = 'store_asset';
        const response = await uploadImage(
          new Request('https://png-trial.invalid/upload', {
            method: 'POST',
            headers: { 'X-Card-Revision': String(card.revision) },
            body: png,
          }),
          card.id,
          env,
          Date.now(),
        );
        const asset = await response.json<Asset>();
        assetId = asset.id;
        const result: Result = {
          asset,
          card_id: card.id,
          width: 1080,
          height: 1080,
          timings_ms: {
            prepare: prepared - start,
            layout: laidOut - prepared,
            render_validate: rendered - laidOut,
            store: performance.now() - rendered,
            total: performance.now() - start,
          },
        };
        stage = 'commit';
        await this.ctx.storage.put(key, { hash, status: 'complete', result } satisfies Job);
        return Response.json({ ...result, reused: false });
      } catch {
        await this.ctx.storage.put(key, {
          hash,
          status: 'failed',
          failed_stage: stage,
          ...(cardId ? { card_id: cardId } : {}),
          ...(assetId ? { asset_id: assetId } : {}),
        } satisfies Job);
        return Response.json({ error: 'TRIAL_FAILED', stage }, { status: 503 });
      }
    });
  }
}

export default {
  fetch() {
    return new Response('Private DO renderer', { status: 404 });
  },
};
