// Local-only decoder endpoint for the benchmark. No deployment configuration.
import { decodeAtlasPage } from './atlas-pages';
import { blockPageDecoder } from './atlas-blocks';
import { packAtlasChunk } from './atlas-chunks';
import { readBoundedBody } from './atlas-pipeline';

const decoders = { single: decodeAtlasPage, b4: blockPageDecoder(4), b8: blockPageDecoder(8) };
export default {
  async fetch(request: Request, env: { MODE: string; KEYS: string }) {
    if (env.MODE !== 'single' && env.MODE !== 'b4' && env.MODE !== 'b8')
      return new Response('Invalid configuration', { status: 503 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    try {
      const keys: unknown = JSON.parse(env.KEYS);
      if (!Array.isArray(keys) || keys.length > 64 || keys.some((key) => typeof key !== 'string'))
        throw new Error('Invalid keys');
      const bytes = await readBoundedBody(request, 4 * 1048576, true);
      return new Response(packAtlasChunk(decoders[env.MODE](bytes, keys, 64), 0, 1), {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    } catch {
      return new Response('Invalid page', { status: 400 });
    }
  },
};
