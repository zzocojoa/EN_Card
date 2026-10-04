import { createPipelineProbe } from './atlas-pipeline';
import { blockRuntime } from './atlas-block-runtime';

const probes = {
  '4': {
    '800': createPipelineProbe(blockRuntime('800', 4), {
      encoder: 'atlas_blocks800',
      rendererPrefix: '/blocks/800',
    }),
    '720': createPipelineProbe(blockRuntime('720', 4), {
      encoder: 'atlas_blocks720',
      rendererPrefix: '/blocks/720',
    }),
  },
  '8': {
    '800': createPipelineProbe(blockRuntime('800', 8), {
      encoder: 'atlas_blocks800',
      rendererPrefix: '/blocks/800',
    }),
    '720': createPipelineProbe(blockRuntime('720', 8), {
      encoder: 'atlas_blocks720',
      rendererPrefix: '/blocks/720',
    }),
  },
};
export default {
  fetch(request: Request, env: { RENDERER: Fetcher; BENCH_TOKEN: string; BLOCK_SIZE: string }) {
    if (env.BLOCK_SIZE !== '4' && env.BLOCK_SIZE !== '8')
      return new Response('Invalid configuration', { status: 503 });
    const size = /\/atlas_blocks(800|720)$/.exec(new URL(request.url).pathname)?.[1] as
      '800' | '720' | undefined;
    return size
      ? probes[env.BLOCK_SIZE][size].fetch(request, env)
      : new Response('Not found', { status: 404 });
  },
};
