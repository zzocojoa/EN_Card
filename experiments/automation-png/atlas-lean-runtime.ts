import { optimizedRuntimes } from './atlas-optimized-runtime';
import type { PipelineRuntime } from './atlas-pipeline';

export function leanRuntime(size: '800' | '720', chunkSize = 6): PipelineRuntime {
  const original = optimizedRuntimes[size];
  return { ...original, options: { ...original.options, chunkSize } };
}
