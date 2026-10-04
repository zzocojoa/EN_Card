import { z } from 'zod';
import { RELAY_ORIGIN, RELAY_PATH, signedRelayHeaders } from '../shared/automation-relay';
import { AiError, boundedJson, type AiCall } from './providers';
import type { AutomationEnv } from './types';
import type { AutomationView } from '../shared/automation';

const failure = z.object({
  error: z.enum(['auth', 'quota', 'unavailable', 'invalid', 'config']),
  http_status: z.number().int().min(100).max(599).nullable().optional(),
});
async function requestRelay(
  env: AutomationEnv,
  body: unknown,
  transport: typeof fetch,
  timeoutMs = 28000,
) {
  if (!env.AI_RELAY_KEY) throw new AiError('config');
  const text = JSON.stringify(body);
  try {
    const response = await transport(`${RELAY_ORIGIN}${RELAY_PATH}`, {
      method: 'POST',
      headers: await signedRelayHeaders(env.AI_RELAY_KEY, text),
      body: text,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AiError('unavailable', response.status);
    }
    const value = await boundedJson(response);
    if (!response.ok) {
      const parsed = failure.safeParse(value);
      throw parsed.success
        ? new AiError(parsed.data.error, parsed.data.http_status ?? null)
        : new AiError('unavailable');
    }
    return value;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('unavailable');
  }
}
export async function relayReady(env: AutomationEnv, transport: typeof fetch = fetch) {
  let httpStatus: number | null = null;
  try {
    const value = await requestRelay(
      env,
      { action: 'status' },
      async (url, init) => {
        const response = await transport(url, init);
        httpStatus = response.status;
        return response;
      },
      5000,
    );
    const parsed = z.object({ ready: z.boolean() }).strict().safeParse(value);
    if (!parsed.success) throw new AiError('invalid');
    return parsed.data.ready;
  } catch (error) {
    // Never log headers, response bodies, exception messages, or provider credentials.
    console.warn({
      event: 'automation_relay_status_failed',
      httpStatus,
      code: error instanceof AiError ? error.code : 'unavailable',
    });
    throw error;
  }
}
// A status probe has no AI or database write effects and is useful before activation.
export async function withRelayStatus(
  env: AutomationEnv,
  view: AutomationView,
  transport: typeof fetch = fetch,
): Promise<AutomationView> {
  const missing = [...view.missing];
  if (!missing.includes('SITE_AI_CONNECTION')) {
    try {
      if (!(await relayReady(env, transport))) missing.push('SITE_AI_KEYS');
    } catch {
      missing.push('SITE_AI_CONNECTION');
    }
  }
  return { ...view, missing, available: missing.length === 0 };
}
export function relayClient(env: AutomationEnv, transport: typeof fetch = fetch): AiCall {
  return async (input) => {
    if (
      env.AUTOMATION_MODE !== 'live' ||
      env.AI_FREE_CONFIRMED !== 'google_groq_free' ||
      env.SEND_MODE !== 'live' ||
      env.COST_MODE !== 'free_only'
    )
      throw new AiError('config');
    const value = await requestRelay(
      env,
      { action: 'call', free: env.AI_FREE_CONFIRMED, input },
      transport,
    );
    return z.object({ result: z.unknown() }).strict().parse(value).result;
  };
}
