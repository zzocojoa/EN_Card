import metricsData from '../../.automation-png/atlas-metrics.data';
import commonBytes from '../../.automation-png/atlas-common.bin';
import { atlasAdvance, decodeCommonAtlas, type AtlasMetrics } from './atlas-pages';
import { createPipelineProbe } from './atlas-pipeline';
export default createPipelineProbe({
  advance: atlasAdvance(JSON.parse(metricsData) as AtlasMetrics),
  common: decodeCommonAtlas(new Uint8Array(commonBytes)),
});
