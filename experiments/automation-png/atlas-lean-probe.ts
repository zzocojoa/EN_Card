import { createPipelineProbe } from './atlas-pipeline';
import { leanRuntime } from './atlas-lean-runtime';

const probes = {
  '800': createPipelineProbe(leanRuntime('800'), {
    encoder: 'atlas_lean800',
    rendererPrefix: '/lean/800',
  }),
  '720': createPipelineProbe(leanRuntime('720'), {
    encoder: 'atlas_lean720',
    rendererPrefix: '/lean/720',
  }),
};
export default {
  fetch(request: Request, env: { RENDERER: Fetcher; BENCH_TOKEN: string }) {
    const size = /\/atlas_lean(800|720)$/.exec(new URL(request.url).pathname)?.[1] as
      '800' | '720' | undefined;
    return size ? probes[size].fetch(request, env) : new Response('Not found', { status: 404 });
  },
};
