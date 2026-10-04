import metricsData from '../../.automation-png/atlas-metrics.data';
import commonBytes from '../../.automation-png/atlas-common.bin';
import { atlasAdvance, decodeCommonAtlas, planCardAtlas, type AtlasMetrics } from './atlas-pages';
import { atlasChunks, mergeAtlases, selectAtlas, unpackAtlasChunk } from './atlas-chunks';
import { atlasPngPrepared } from './atlas';
import { fixtures, atlasCoverageCard } from './fixtures';
import { probeAuthorization } from './probe';

const advance = atlasAdvance(JSON.parse(metricsData) as AtlasMetrics);
const common = decodeCommonAtlas(new Uint8Array(commonBytes));
const cards: typeof fixtures = { ...fixtures, coverage: atlasCoverageCard };
type Env = { RENDERER: Fetcher; BENCH_TOKEN: string };
// Fixed-fixture trial only. A new trial requires its own explicit budget;
// never expose arbitrary card content/URLs through this probe.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const denied = probeAuthorization(request, env);
    if (denied) return denied;
    const match =
      /^\/probe\/(expression|comparison|long|long_comparison|coverage)\/atlas_chunks$/.exec(
        new URL(request.url).pathname,
      );
    if (!match) return new Response('Not found', { status: 404 });
    const card = cards[match[1]!]!;
    const plan = planCardAtlas(card, advance, 1, common);
    const chunks = atlasChunks(plan.pages);
    const parts = [selectAtlas(common, plan.commonKeys)];
    for (const [index, chunk] of chunks.entries()) {
      const response = await env.RENDERER.fetch(`https://png.internal/glyphs/${match[1]}/${index}`);
      if (!response.ok) {
        await response.body?.cancel();
        return new Response('Glyph preparation failed', { status: 502 });
      }
      const size = Number(response.headers.get('Content-Length'));
      if (size > 1048576) {
        await response.body?.cancel();
        return new Response('Glyph response too large', { status: 502 });
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const keys = new Set(chunk.flatMap(([, keys]) => [...keys]));
      try {
        parts.push(unpackAtlasChunk(bytes, index, chunks.length, keys));
      } catch {
        return new Response('Invalid glyph response', { status: 502 });
      }
    }
    const atlas = mergeAtlases(parts, advance);
    return new Response(atlasPngPrepared(plan.prepared, atlas), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Atlas-Chunks': String(chunks.length),
        'X-Atlas-Pages': String(plan.pages.size),
      },
    });
  },
};
