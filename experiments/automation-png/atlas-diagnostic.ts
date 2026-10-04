import { probeAuthorization } from './probe';

// Lab-only instrumentation. No fixture cache or prewarming: counts describe real
// invocations on this isolate, not a guarantee that later requests reuse it.
const names = ['X-Lab-Isolate', 'X-Lab-Assembly-Ordinal', 'X-Lab-Glyph-Ordinal'] as const;
type RendererEnv = { ATLAS_ASSETS: Fetcher };
type ProbeEnv = { RENDERER: Fetcher; BENCH_TOKEN: string };
type Handler<E> = { fetch(request: Request, env: E): Response | Promise<Response> };
export function diagnosticRenderer(worker: Handler<RendererEnv>) {
  let isolate: string | undefined;
  let assemblies = 0,
    glyphs = 0;
  return {
    async fetch(request: Request, env: RendererEnv) {
      isolate ??= crypto.randomUUID();
      const path = new URL(request.url).pathname;
      const assembly = path.includes('/pipeline/assemble/');
      const ordinal = assembly ? ++assemblies : ++glyphs;
      const response = await worker.fetch(request, env);
      response.headers.set('X-Lab-Isolate', isolate);
      response.headers.set(
        assembly ? 'X-Lab-Assembly-Ordinal' : 'X-Lab-Glyph-Ordinal',
        String(ordinal),
      );
      return response;
    },
  };
}
export function diagnosticProbe(probe: Handler<ProbeEnv>) {
  return {
    async fetch(request: Request, env: ProbeEnv) {
      const denied = probeAuthorization(request, env);
      if (denied) return denied;
      const call = request.headers.get('X-Lab-Call');
      if (!call || !/^[a-f0-9]{32}$/.test(call))
        return new Response('Invalid diagnostic call', { status: 400 });
      const url = new URL(request.url);
      // The diagnostic route invokes exactly one bounded glyph chunk. It cannot
      // accept text, a URL, an asset path or a client assembly payload.
      const glyph =
        /^\/diagnostic\/glyphs\/(800|720)\/(expression|comparison|long|long_comparison|coverage)\/(\d{1,2})$/.exec(
          url.pathname,
        );
      if (glyph && !url.search) {
        const response = await env.RENDERER.fetch(
          `https://png.internal/lean/${glyph[1]}/pipeline/glyphs/${glyph[2]}/${glyph[3]}`,
          { headers: { 'X-Lab-Call': call } },
        );
        return response;
      }
      if (
        !/^\/probe\/(expression|comparison|long|long_comparison|coverage)\/atlas_lean(800|720)$/.test(
          url.pathname,
        ) ||
        url.search
      )
        return new Response('Not found', { status: 404 });
      const metadata = new Headers();
      const renderer = {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          headers.set('X-Lab-Call', call);
          const response = await env.RENDERER.fetch(input, { ...init, headers });
          if (response.headers.has('X-Lab-Assembly-Ordinal'))
            for (const name of names) {
              const value = response.headers.get(name);
              if (value) metadata.set(name, value);
            }
          return response;
        },
      } as Fetcher;
      const response = await probe.fetch(request, { ...env, RENDERER: renderer });
      for (const [name, value] of metadata) response.headers.set(name, value);
      return response;
    },
  };
}
