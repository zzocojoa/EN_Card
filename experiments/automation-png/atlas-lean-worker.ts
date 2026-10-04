import { createPipelineWorker } from './atlas-pipeline';
import { leanRuntime } from './atlas-lean-runtime';

const workers = {
  '800': createPipelineWorker(leanRuntime('800'), { prefix: '/lean/800', assetPrefix: '/800' }),
  '720': createPipelineWorker(leanRuntime('720'), { prefix: '/lean/720', assetPrefix: '/720' }),
};
export default {
  fetch(request: Request, env: { ATLAS_ASSETS: Fetcher }) {
    const size = /^\/lean\/(800|720)\//.exec(new URL(request.url).pathname)?.[1] as
      '800' | '720' | undefined;
    return size ? workers[size].fetch(request, env) : new Response('Not found', { status: 404 });
  },
};
