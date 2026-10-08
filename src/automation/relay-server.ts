import { z } from 'zod';
import { automationSettings, reviewSchema } from '../shared/automation';
import { cardSchema } from '../shared/model';
import {
  deriveRelayKey,
  RELAY_ORIGIN,
  RELAY_PATH,
  verifyRelaySignature,
  validRelayHeaders,
} from '../shared/automation-relay';
import { AiError, providerClient, boundedJson, aiOutputSchema } from './providers';

// Exported as a server-only bundle into the existing Site; provider keys never leave that Site.
export type RelaySiteConfig = {
  DB?: D1Database;
  card_studio_enabled?: string;
  card_studio_owner_id?: string;
  card_studio_bridge_secret?: string;
  google_ai_enabled?: string;
  groq_ai_enabled?: string;
  google_api?: string;
  groq_api?: string;
};
const inputSchema = z
  .object({
    provider: z.enum(['google', 'groq']),
    stage: z.enum(['select', 'draft', 'review', 'revise']),
    settings: automationSettings,
    content: cardSchema.nullable(),
    review: reviewSchema.nullable(),
    recent: z.array(z.string().max(200)).max(50),
    expression: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((input) => ['select', 'draft'].includes(input.stage) || input.content !== null)
  .refine(
    (input) =>
      input.stage !== 'select' ||
      (input.content === null && input.review === null && input.expression === undefined),
  )
  .refine((input) => input.stage !== 'revise' || input.review !== null);
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z
    .object({ action: z.literal('call'), free: z.literal('google_groq_free'), input: inputSchema })
    .strict(),
]);
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
export async function handleCardAutomationRelay(
  request: Request,
  config: RelaySiteConfig,
  transport: typeof fetch = fetch,
  clock: () => number = Date.now,
): Promise<Response> {
  if (new URL(request.url).origin !== RELAY_ORIGIN || new URL(request.url).pathname !== RELAY_PATH)
    return response({ error: 'config' }, 404);
  if (request.method !== 'POST') return response({ error: 'config' }, 405);
  if (
    request.headers.has('Origin') ||
    request.headers.has('Cookie') ||
    request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json'
  )
    return response({ error: 'auth' }, 403);
  if (!validRelayHeaders(request, clock())) return response({ error: 'auth' }, 403);
  if (
    config.card_studio_enabled !== 'true' ||
    !config.card_studio_owner_id ||
    !config.card_studio_bridge_secret ||
    config.card_studio_bridge_secret.length < 32
  )
    return response({ error: 'config' }, 503);
  try {
    // Bound the body before authentication. Parsing it must not cause external effects.
    let text: string;
    try {
      text = (await boundedJson(
        request,
        65536,
        true,
        AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
      )) as string;
    } catch (error) {
      return response(
        { error: 'invalid' },
        error instanceof AiError && error.bodyTooLarge ? 413 : 400,
      );
    }
    const key = await deriveRelayKey(config.card_studio_bridge_secret, config.card_studio_owner_id);
    if (!(await verifyRelaySignature(request, text, key, clock())))
      return response({ error: 'auth' }, 403);
    const body = requestSchema.parse(JSON.parse(text));
    const ready = Boolean(
      config.DB &&
      config.google_api?.trim() &&
      config.groq_api?.trim() &&
      config.google_ai_enabled === 'true' &&
      config.groq_ai_enabled !== 'false',
    );
    if (body.action === 'status') {
      if (!ready) return response({ ready: false });
      try {
        await config.DB!.prepare('SELECT nonce FROM card_automation_nonces LIMIT 1').first();
        return response({ ready: true });
      } catch {
        return response({ ready: false });
      }
    }
    if (!ready) return response({ error: 'config' }, 503);
    // A replay may reach another Site isolate. D1 uniqueness, not memory, authorizes one call.
    try {
      const reservation = await config.DB!.batch([
        config.DB!.prepare('DELETE FROM card_automation_nonces WHERE expires_at<?').bind(clock()),
        config
          .DB!.prepare(
            'INSERT INTO card_automation_nonces(nonce,expires_at) VALUES(?,?) ON CONFLICT(nonce) DO NOTHING',
          )
          .bind(
            request.headers.get('X-Card-Nonce'),
            Number(request.headers.get('X-Card-Time')) + 300000,
          ),
      ]);
      if (reservation[1]?.meta.changes !== 1) return response({ error: 'unavailable' }, 409);
    } catch {
      return response({ error: 'unavailable' }, 503);
    }
    const output = await providerClient(
      {
        GOOGLE_API_KEY: config.google_api?.trim(),
        GROQ_API_KEY: config.groq_api?.trim(),
      },
      transport,
    )(body.input);
    try {
      return response({
        result: aiOutputSchema(body.input.stage).parse(output),
      });
    } catch {
      throw new AiError('invalid');
    }
  } catch (error) {
    if (error instanceof AiError)
      return response({ error: error.code, http_status: error.httpStatus }, 502);
    return response({ error: 'invalid' }, 400);
  }
}
