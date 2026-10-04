import { createPipelineWorker } from './atlas-pipeline';
import { blockRuntime } from './atlas-block-runtime';

const workers = {
  '4': {
    '800': createPipelineWorker(blockRuntime('800', 4), {
      prefix: '/blocks/800',
      assetPrefix: '/800',
    }),
    '720': createPipelineWorker(blockRuntime('720', 4), {
      prefix: '/blocks/720',
      assetPrefix: '/720',
    }),
  },
  '8': {
    '800': createPipelineWorker(blockRuntime('800', 8), {
      prefix: '/blocks/800',
      assetPrefix: '/800',
    }),
    '720': createPipelineWorker(blockRuntime('720', 8), {
      prefix: '/blocks/720',
      assetPrefix: '/720',
    }),
  },
};
export default {
  fetch(request: Request, env: { ATLAS_ASSETS: Fetcher; BLOCK_SIZE: string }) {
    if (env.BLOCK_SIZE !== '4' && env.BLOCK_SIZE !== '8')
      return new Response('Invalid configuration', { status: 503 });
    const size = /^\/blocks\/(800|720)\//.exec(new URL(request.url).pathname)?.[1] as
      '800' | '720' | undefined;
    return size
      ? workers[env.BLOCK_SIZE][size].fetch(request, env)
      : new Response('Not found', { status: 404 });
  },
};
