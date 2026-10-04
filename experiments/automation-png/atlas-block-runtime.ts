import { blockPageDecoder, type BlockSize } from './atlas-blocks';
import { leanRuntime } from './atlas-lean-runtime';

export function blockRuntime(size: '800' | '720', blockSize: BlockSize) {
  const original = leanRuntime(size);
  return {
    ...original,
    options: { ...original.options, pageDecoder: blockPageDecoder(blockSize) },
  };
}
