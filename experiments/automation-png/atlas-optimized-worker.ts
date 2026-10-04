import { createPipelineWorker } from './atlas-pipeline';
import { optimizedRuntimes, prefixedBinding } from './atlas-optimized-runtime';
const workers = {
  '800': createPipelineWorker(optimizedRuntimes['800']),
  '720': createPipelineWorker(optimizedRuntimes['720']),
};
export default {
  fetch(request: Request, env: { ATLAS_ASSETS: Fetcher }) {
    const url = new URL(request.url);
    const match = /^\/optimized\/(800|720)(\/pipeline\/.*)$/.exec(url.pathname);
    if (!match || url.search) return new Response('Not found', { status: 404 });
    const size = match[1] as '800' | '720';
    url.pathname = match[2]!;
    return workers[size].fetch(new Request(url, request), {
      ATLAS_ASSETS: prefixedBinding(env.ATLAS_ASSETS, '/' + size),
    });
  },
};
