import { initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import expression from '../../.automation-png/expression.svg';
import comparison from '../../.automation-png/comparison.svg';
import long from '../../.automation-png/long.svg';
import longComparison from '../../.automation-png/long_comparison.svg';
import { rasterize, rasterizeNative } from './raster';
import { rasterizeFast } from './fast-png';
import { BAND_COUNT, renderBand } from './bands';

const fixtures: Record<string, string> = {
  expression,
  comparison,
  long,
  long_comparison: longComparison,
};
// Instantiation is isolate startup work, not part of the first render handler.
await initWasm(wasm);

// Isolated raster-only lower bound, never a production automation endpoint.
// SVGs are local build artifacts. No caller SVG, fonts, URLs, DB, KV or secrets.
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    const match = /^\/(render|band)\/([a-z_]+)(?:\/(\d+))?$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    const name = match[2]!;
    const svg = Object.hasOwn(fixtures, name) ? fixtures[name] : undefined;
    if (!svg) return new Response('Not found', { status: 404 });
    if (match[1] === 'band') {
      const index = match[3] === undefined ? -1 : Number(match[3]);
      if (index < 0 || index >= BAND_COUNT) return new Response('Not found', { status: 404 });
      const band = renderBand(svg, index);
      return new Response(new Uint8Array(band.deflate), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Band-Index': String(band.index),
          'X-Band-Adler': String(band.adler32),
        },
      });
    }
    if (match[3] !== undefined) return new Response('Not found', { status: 404 });
    const encoder = url.searchParams.get('encoder') ?? 'wasm';
    if (!['wasm', 'native', 'fast'].includes(encoder))
      return new Response('Not found', { status: 404 });
    const png =
      encoder === 'fast'
        ? rasterizeFast(svg)
        : encoder === 'native'
          ? await rasterizeNative(svg)
          : rasterize(svg);
    return new Response(png, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  },
};
