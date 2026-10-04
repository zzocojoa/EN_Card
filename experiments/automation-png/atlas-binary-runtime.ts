import { binaryAtlasChunkCodec } from './atlas-binary';
import { leanRuntime } from './atlas-lean-runtime';

export function binaryRuntime(size: '800' | '720') {
  const original = leanRuntime(size);
  return { ...original, options: { ...original.options, chunkCodec: binaryAtlasChunkCodec } };
}
