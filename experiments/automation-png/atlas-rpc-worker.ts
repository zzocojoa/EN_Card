import { WorkerEntrypoint } from 'cloudflare:workers';
import { createAtlasRpc } from './atlas-rpc';
import { leanRuntime } from './atlas-lean-runtime';
import baseline from './atlas-lean-worker';

const rpc = createAtlasRpc({ '800': leanRuntime('800'), '720': leanRuntime('720') });
// Private Worker; RPC methods require an explicit Service Binding. HTTP routes
// remain available only for the controlled baseline comparison.
export default class AtlasRenderer extends WorkerEntrypoint<{ ATLAS_ASSETS: Fetcher }> {
  fetch(request: Request) {
    return baseline.fetch(request, this.env);
  }
  glyphs(size: unknown, fixture: unknown, index: unknown) {
    return rpc.glyphs(size, fixture, index, this.env.ATLAS_ASSETS);
  }
  assemble(size: unknown, fixture: unknown, bundle: unknown) {
    return rpc.assemble(size, fixture, bundle);
  }
}
