import { createPipelineProbe } from './atlas-pipeline';
import { optimizedRuntimes, prefixedBinding } from './atlas-optimized-runtime';
import { probeAuthorization } from './probe';
const probes = {
  '800': createPipelineProbe(optimizedRuntimes['800']),
  '720': createPipelineProbe(optimizedRuntimes['720']),
};
export default {
  fetch(request: Request, env: { RENDERER: Fetcher; BENCH_TOKEN: string }) {
    const denied = probeAuthorization(request, env);
    if (denied) return denied;
    const url = new URL(request.url);
    const match =
      /^\/probe\/(expression|comparison|long|long_comparison|coverage)\/atlas_optimized(800|720)$/.exec(
        url.pathname,
      );
    if (!match || url.search) return new Response('Not found', { status: 404 });
    const size = match[2] as '800' | '720';
    url.pathname = `/probe/${match[1]}/atlas_pipeline`;
    return probes[size].fetch(new Request(url, request), {
      ...env,
      RENDERER: prefixedBinding(env.RENDERER, '/optimized/' + size),
    });
  },
};
