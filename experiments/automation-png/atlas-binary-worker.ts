import { createPipelineWorker } from './atlas-pipeline';
import { binaryRuntime } from './atlas-binary-runtime';

const workers = {
  '800': createPipelineWorker(binaryRuntime('800'), { prefix: '/binary/800', assetPrefix: '/800' }),
  '720': createPipelineWorker(binaryRuntime('720'), { prefix: '/binary/720', assetPrefix: '/720' }),
};
export default {
  fetch(request: Request, env: { ATLAS_ASSETS: Fetcher }) {
    const size = /^\/binary\/(800|720)\//.exec(new URL(request.url).pathname)?.[1] as
      '800' | '720' | undefined;
    return size ? workers[size].fetch(request, env) : new Response('Not found', { status: 404 });
  },
};
