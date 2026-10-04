import metricsData from '../../.automation-png/atlas-optimized/800/metrics.data';
import common800 from '../../.automation-png/atlas-optimized/800/common.bin';
import common720 from '../../.automation-png/atlas-optimized/720/common.bin';
import { atlasAdvance, decodeCommonAtlas, type AtlasMetrics } from './atlas-pages';
import type { PipelineRuntime } from './atlas-pipeline';

const advance = atlasAdvance(JSON.parse(metricsData) as AtlasMetrics);
export const optimizedRuntimes: Record<'800' | '720', PipelineRuntime> = {
  '800': {
    advance,
    common: decodeCommonAtlas(new Uint8Array(common800)),
    options: { size: 800, slots: 64, chunkSize: 3, compactRead: true, rle: true },
  },
  '720': {
    advance,
    common: decodeCommonAtlas(new Uint8Array(common720)),
    options: { size: 720, slots: 64, chunkSize: 3, compactRead: true, rle: true },
  },
};
// Only fixed internal bindings are rewritten. Caller URLs never reach fetch().
export function prefixedBinding(binding: Fetcher, prefix: string): Fetcher {
  return {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      url.pathname = prefix + url.pathname;
      return binding.fetch(new Request(url, request));
    },
  } as Fetcher;
}
