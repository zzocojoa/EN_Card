import metricsData from '../../.automation-png/atlas-metrics.data';
import commonBytes from '../../.automation-png/atlas-common.bin';
import { atlasAdvance, decodeCommonAtlas, type AtlasMetrics } from './atlas-pages';
import { createPipelineWorker } from './atlas-pipeline';
export default createPipelineWorker({
  advance: atlasAdvance(JSON.parse(metricsData) as AtlasMetrics),
  common: decodeCommonAtlas(new Uint8Array(commonBytes)),
});
