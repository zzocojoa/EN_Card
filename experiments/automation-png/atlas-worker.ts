import metricsData from '../../.automation-png/atlas-metrics.data';
import {
  atlasAdvance,
  loadCardAtlas,
  decodeCommonAtlas,
  planCardAtlas,
  type AtlasMetrics,
} from './atlas-pages';
import { atlasChunks, loadAtlasChunk, packAtlasChunk } from './atlas-chunks';
import commonBytes from '../../.automation-png/atlas-common.bin';
import { atlasPng } from './atlas';
import { fixtures, atlasCoverageCard } from './fixtures';

const advance = atlasAdvance(JSON.parse(metricsData) as AtlasMetrics);
const common = decodeCommonAtlas(new Uint8Array(commonBytes));
const cards: typeof fixtures = { ...fixtures, coverage: atlasCoverageCard };
type AtlasEnv = { ATLAS_ASSETS: Fetcher };
// Same private trial name, isolated from all application data. Fixed synthetic
// card inputs, but full modern Hangul assets and runtime layout/PNG generation.
export default {
  async fetch(request: Request, env: AtlasEnv): Promise<Response> {
    const url = new URL(request.url);
    const match =
      /^\/(render|glyphs)\/(expression|comparison|long|long_comparison|coverage)(?:\/(\d+))?$/.exec(
        url.pathname,
      );
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (!match) return new Response('Not found', { status: 404 });
    let pages = 0;
    let fetchedBytes = 0;
    const card = cards[match[2]!]!;
    const getPage = async (name: string) => {
      const response = await env.ATLAS_ASSETS.fetch(`https://atlas.internal/${name}`);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('준비한 글자 페이지를 읽을 수 없습니다.');
      }
      const length = Number(response.headers.get('Content-Length'));
      if (length > 4 * 1048576) {
        await response.body?.cancel();
        throw new Error('글자 페이지 크기 오류');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      pages++;
      fetchedBytes += bytes.length;
      return bytes;
    };
    if (match[1] === 'glyphs') {
      const index = Number(match[3]);
      const chunks = atlasChunks(planCardAtlas(card, advance, 1, common).pages);
      if (!Number.isInteger(index) || index < 0 || index >= chunks.length)
        return new Response('Not found', { status: 404 });
      const atlas = await loadAtlasChunk(chunks[index]!, getPage);
      return new Response(packAtlasChunk(atlas, index, chunks.length), {
        headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
      });
    }
    if (match[3] !== undefined || url.searchParams.get('encoder') !== 'atlas')
      return new Response('Not found', { status: 404 });
    const atlas = await loadCardAtlas(card, advance, getPage, 1, common);
    return new Response(atlasPng(card, atlas), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Atlas-Pages': String(pages),
        'X-Atlas-Bytes': String(fetchedBytes),
      },
    });
  },
};
