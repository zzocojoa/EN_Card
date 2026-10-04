import { BAND_COUNT, joinBands, type PngBand } from './band-png';

type ProbeEnv = { RENDERER: Fetcher; BENCH_TOKEN: string };
const paths =
  /^\/probe\/(expression|comparison|long|long_comparison|coverage)\/(wasm|native|fast|bands|atlas)$/;

export function probeAuthorization(
  request: Request,
  env: Pick<ProbeEnv, 'BENCH_TOKEN'>,
): Response | null {
  if (!env.BENCH_TOKEN || env.BENCH_TOKEN.length < 32)
    return new Response('Probe disabled', { status: 503 });
  const supplied = new TextEncoder().encode(request.headers.get('Authorization') ?? '');
  const expected = new TextEncoder().encode(`Bearer ${env.BENCH_TOKEN}`);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  };
  if (supplied.length !== expected.length || !subtle.timingSafeEqual(supplied, expected))
    return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  return null;
}

// Optional remote measurement ingress. Deploy only after permission and a Free
// account check. Only synthetic, compiled fixtures reach the private renderer.
export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const denied = probeAuthorization(request, env);
    if (denied) return denied;
    const match = paths.exec(new URL(request.url).pathname);
    if (!match) return new Response('Not found', { status: 404 });
    if (match[2] === 'bands') {
      const bands: PngBand[] = [];
      for (let index = 0; index < BAND_COUNT; index++) {
        const response = await env.RENDERER.fetch(`https://png.internal/band/${match[1]}/${index}`);
        if (!response.ok) {
          await response.body?.cancel();
          return new Response('Band render failed', { status: 502 });
        }
        const checksum = response.headers.get('X-Band-Adler');
        if (
          response.headers.get('X-Band-Index') !== String(index) ||
          checksum === null ||
          !/^\d{1,10}$/.test(checksum) ||
          Number(checksum) > 0xffffffff
        ) {
          await response.body?.cancel();
          return new Response('Invalid band metadata', { status: 502 });
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        bands.push({
          index,
          adler32: Number(checksum),
          deflate: bytes,
        });
      }
      return new Response(joinBands(bands), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      });
    }
    return env.RENDERER.fetch(`https://png.internal/render/${match[1]}?encoder=${match[2]}`);
  },
};
