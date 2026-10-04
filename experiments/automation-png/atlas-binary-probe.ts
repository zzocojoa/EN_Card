import { createPipelineProbe } from './atlas-pipeline';
import { binaryRuntime } from './atlas-binary-runtime';

const probes = {
  '800': createPipelineProbe(binaryRuntime('800'), {
    encoder: 'atlas_binary800',
    rendererPrefix: '/binary/800',
  }),
  '720': createPipelineProbe(binaryRuntime('720'), {
    encoder: 'atlas_binary720',
    rendererPrefix: '/binary/720',
  }),
};
export default {
  fetch(request: Request, env: { RENDERER: Fetcher; BENCH_TOKEN: string }) {
    const size = /\/atlas_binary(800|720)$/.exec(new URL(request.url).pathname)?.[1] as
      '800' | '720' | undefined;
    return size ? probes[size].fetch(request, env) : new Response('Not found', { status: 404 });
  },
};
