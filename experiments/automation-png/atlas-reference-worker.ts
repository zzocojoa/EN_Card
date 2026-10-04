import { createPipelineWorker } from './atlas-pipeline';
import { leanRuntime } from './atlas-lean-runtime';
import { paintExtracted } from './atlas-blit';

// Fixed at build time, never controlled by a request. Both controls use the
// same wrapper and shared renderer; only the assembly data source differs.
declare const REFERENCE_PIXELS: boolean;
declare const PAINT_MODE: 'scalar' | 'native';
const workers = Object.fromEntries(
  (['800', '720'] as const).map((size) => {
    const runtime = leanRuntime(size);
    return [
      size,
      createPipelineWorker(
        {
          ...runtime,
          options: {
            ...runtime.options,
            referencePixels: REFERENCE_PIXELS,
            ...(PAINT_MODE === 'native' ? { painter: paintExtracted, nativeCrc: true } : {}),
          },
        },
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
