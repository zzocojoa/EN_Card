import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { atlasAdvance, decodeCommonAtlas } from './atlas-pages';
import {
  pipelinePlan,
  packAtlasBundle,
  assembleAtlasBundle,
  type PipelineRuntime,
} from './atlas-pipeline';
import { loadAtlasChunk, packAtlasChunk, selectAtlas, mergeAtlases } from './atlas-chunks';
import { referenceAtlases } from './atlas-reference';
import { fixtures, atlasCoverageCard } from './fixtures';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const assetRoot = '.automation-png/atlas-optimized/assets';
export const assetHashes = new Map<string, string>();
async function asset(file: string) {
  const bytes = await readFile(file);
  assetHashes.set(file, hash(bytes));
  return bytes;
}
const metrics = await asset('.automation-png/atlas-optimized/800/metrics.data');
const advance = atlasAdvance(JSON.parse(metrics.toString()));
export const inputs: {
  size: 800 | 720;
  fixture: string;
  bundle: Uint8Array<ArrayBuffer>;
  png: Uint8Array<ArrayBuffer>;
  chunks: number;
  selected_glyphs: number;
  eliminated_pixel_copy_bytes: number;
}[] = [];
for (const size of [800, 720] as const) {
  const common = decodeCommonAtlas(
    await asset(`.automation-png/atlas-optimized/${size}/common.bin`),
  );
  const runtime: PipelineRuntime = {
    advance,
    common,
    options: { size, slots: 64, chunkSize: 6, compactRead: true, rle: true },
  };
  for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
    const plan = pipelinePlan(card, runtime),
      frames = [],
      parts = [selectAtlas(common, plan.commonKeys)];
    for (const [index, chunk] of plan.chunks.entries()) {
      const part = await loadAtlasChunk(chunk, (name) => asset(`${assetRoot}/${size}/${name}`), 64);
      parts.push(part);
      frames.push(packAtlasChunk(part, index, plan.chunks.length));
    }
    const bundle = packAtlasBundle(frames),
      png = assembleAtlasBundle(card, runtime, bundle);
    assert.ok(
      Buffer.from(png).equals(
        await readFile(`.automation-png/optimized-combined${size}_64-${fixture}.png`),
      ),
    );
    const referenced = assembleAtlasBundle(
      card,
      { ...runtime, options: { ...runtime.options, referencePixels: true } },
      bundle,
    );
    assert.ok(Buffer.from(png).equals(referenced));
    const copied = mergeAtlases(parts).pixels.byteLength;
    assert.equal(referenceAtlases(parts).pixels.byteLength, 0);
    inputs.push({
      size,
      fixture,
      bundle,
      png,
      chunks: frames.length,
      selected_glyphs: parts.reduce((sum, part) => sum + Object.keys(part.glyphs).length, 0),
      eliminated_pixel_copy_bytes: copied,
    });
  }
}
