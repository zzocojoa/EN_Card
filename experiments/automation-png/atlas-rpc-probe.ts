import { createRpcProbe, type AtlasRpc } from './atlas-rpc';
import { leanRuntime } from './atlas-lean-runtime';
import baseline from './atlas-lean-probe';

const rpc = createRpcProbe({ '800': leanRuntime('800'), '720': leanRuntime('720') });
export default {
  fetch(request: Request, env: { RENDERER: Fetcher & AtlasRpc; BENCH_TOKEN: string }) {
    return /\/atlas_lean(800|720)$/.test(new URL(request.url).pathname)
      ? baseline.fetch(request, env)
      : rpc.fetch(request, env);
  },
};
