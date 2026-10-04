import { durableRoute } from './durable-route';

type ProbeEnv = { PNG_TRIAL: DurableObjectNamespace; BENCH_TOKEN: string };
export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (!env.BENCH_TOKEN || env.BENCH_TOKEN.length < 32)
      return new Response('Disabled', { status: 503 });
    const supplied = new TextEncoder().encode(request.headers.get('Authorization') ?? '');
    const expected = new TextEncoder().encode(`Bearer ${env.BENCH_TOKEN}`);
    const subtle = crypto.subtle as SubtleCrypto & {
      timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
    };
    if (supplied.length !== expected.length || !subtle.timingSafeEqual(supplied, expected))
      return new Response('Unauthorized', { status: 401 });
    const route = durableRoute(new URL(request.url).pathname);
    if (!route) return new Response('Not found', { status: 404 });
    if (request.method !== (route.action === 'render' ? 'POST' : 'GET'))
      return new Response('Method not allowed', { status: 405 });
    const headers = new Headers();
    headers.set('Content-Type', request.headers.get('Content-Type') ?? '');
    const call = request.headers.get('X-Lab-Call');
    if (call && /^[a-z0-9_-]{1,64}$/.test(call)) headers.set('X-Lab-Call', call);
    // Do not pass the secret or copy/validate PNG bytes in the normal Worker.
    return env.PNG_TRIAL.get(env.PNG_TRIAL.idFromName(`trial-${route.slot}`)).fetch(
      new Request(`https://png.internal${new URL(request.url).pathname}`, {
        method: request.method,
        headers,
        body: request.body,
      }),
    );
  },
};
