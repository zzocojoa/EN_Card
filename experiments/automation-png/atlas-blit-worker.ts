import { createPipelineWorker } from './atlas-pipeline';
import { leanRuntime } from './atlas-lean-runtime';
import { paintExtracted, paintPacked, paintSpans } from './atlas-blit';

// Build-time local benchmark choice, never a request parameter or production default.
declare const BLIT_MODE: 'extracted' | 'native' | 'packed' | 'spans';
const painter =
  BLIT_MODE === 'extracted' || BLIT_MODE === 'native'
    ? paintExtracted
    : BLIT_MODE === 'packed'
      ? paintPacked
      : paintSpans;
const workers = Object.fromEntries(
  (['800', '720'] as const).map((size) => {
    const runtime = leanRuntime(size);
    return [
      size,
      createPipelineWorker(
        { ...runtime, options: { ...runtime.options, painter, nativeCrc: BLIT_MODE === 'native' } },
        { prefix: `/lean/${size}`, assetPrefix: `/${size}` },
      ),
    ];
  }),
);
export default {
  fetch(request: Request, env: { ATLAS_ASSETS: Fetcher }) {
    const size = /^\/lean\/(800|720)\//.exec(new URL(request.url).pathname)?.[1];
    return size ? workers[size]!.fetch(request, env) : new Response('Not found', { status: 404 });
  },
};
