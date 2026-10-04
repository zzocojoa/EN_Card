import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { atlasAdvance, decodeCommonAtlas, decodeAtlasPage } from './atlas-pages';
import { pipelinePlan, packAtlasBundle, assembleAtlasBundle } from './atlas-pipeline';
import { loadAtlasChunk, packAtlasChunk } from './atlas-chunks';
import { blockPageDecoder, type BlockStats } from './atlas-blocks';
import { fixtures, atlasCoverageCard } from './fixtures';

export const variants = ['single', 'b4', 'b8'] as const;
export type BlockVariant = (typeof variants)[number];
export const assetRoot = (variant: BlockVariant) =>
  variant === 'single'
    ? '.automation-png/atlas-optimized/assets'
    : `.automation-png/atlas-blocks/${variant}/assets`;
function measuredDecoder(variant: BlockVariant, stats: BlockStats): typeof decodeAtlasPage {
  if (variant !== 'single') return blockPageDecoder(variant === 'b4' ? 4 : 8, stats);
  return (data, keys, slots) => {
    const all = [...keys],
      view = new DataView(data.buffer, data.byteOffset, data.byteLength),
      base = view.getUint32(4);
    const result = decodeAtlasPage(data, all, slots);
    for (const key of all) {
      const record = 16 + (Number(key.split(':')[2]) - base) * 32;
      stats.calls++;
      stats.compressedBytes += view.getUint32(record + 20);
      stats.inflatedBytes += view.getUint16(record + 12) * view.getUint16(record + 14);
    }
    return result;
  };
}
type Stats = BlockStats & {
  assetReads: number;
  assetBytes: number;
  selectedBytes: number;
  assetSha256: string;
};
type Candidate = {
  frames: Uint8Array[];
  bundle: Uint8Array<ArrayBuffer>;
  png: Uint8Array<ArrayBuffer>;
  stats: Stats;
};
export const inputs: {
  size: number;
  fixture: string;
  chunks: number;
  variants: Record<BlockVariant, Candidate>;
  png: Uint8Array;
}[] = [];
export const microInputs: {
  size: number;
  fixture: string;
  keys: string[];
  chunks: number;
  variants: Record<BlockVariant, { page: Uint8Array; frame: Uint8Array; stats: Stats }>;
}[] = [];
const advance = atlasAdvance(
  JSON.parse(await readFile('.automation-png/atlas-metrics.json', 'utf8')),
);
for (const size of [800, 720] as const) {
  const runtime = {
    advance,
    common: decodeCommonAtlas(await readFile(`.automation-png/atlas-optimized/${size}/common.bin`)),
    options: { size, slots: 64 as const, chunkSize: 6, compactRead: true, rle: true },
  };
  for (const [fixture, card] of Object.entries({ ...fixtures, coverage: atlasCoverageCard })) {
    const plan = pipelinePlan(card, runtime),
      candidates = {} as Record<BlockVariant, Candidate>;
    const png = await readFile(`.automation-png/optimized-combined${size}_64-${fixture}.png`);
    for (const variant of variants) {
      const stats: Stats = {
          calls: 0,
          compressedBytes: 0,
          inflatedBytes: 0,
          assetReads: 0,
          assetBytes: 0,
          selectedBytes: 0,
          assetSha256: '',
        },
        frames: Uint8Array[] = [];
      const decoder = measuredDecoder(variant, stats),
        assetHash = createHash('sha256');
      for (const [index, chunk] of plan.chunks.entries()) {
        const atlas = await loadAtlasChunk(
          chunk,
          async (name) => {
            const data = new Uint8Array(await readFile(`${assetRoot(variant)}/${size}/${name}`));
            stats.assetReads++;
            stats.assetBytes += data.length;
            assetHash.update(name + '\n').update(data);
            return data;
          },
          64,
          decoder,
        );
        stats.selectedBytes += atlas.pixels.length;
        frames.push(packAtlasChunk(atlas, index, plan.chunks.length));
      }
      stats.assetSha256 = assetHash.digest('hex');
      const bundle = packAtlasBundle(frames),
        actual = assembleAtlasBundle(card, runtime, bundle);
      assert.ok(Buffer.from(actual).equals(png), 'Preserved PNG mismatch');
      candidates[variant] = { frames, bundle, png: actual, stats };
      if (variant !== 'single')
        assert.ok(Buffer.from(bundle).equals(candidates.single.bundle), 'ATC1 bundle changed');
    }
    inputs.push({ size, fixture, chunks: plan.chunks.length, variants: candidates, png });
  }
  // One real, fully populated Hangul page: same style and pixels, with three
  // request distributions. No hand-made repeated pixels in the timing fixtures.
  for (const [fixture, slots] of Object.entries({
    single: [0],
    dense: [0, 1, 2, 3, 4, 5, 6, 7],
    sparse: [0, 8, 16, 24, 32, 40, 48, 56],
  })) {
    const keys = slots.map((slot) => `450:30:${44032 + slot}`),
      candidates = {} as (typeof microInputs)[number]['variants'];
    for (const variant of variants) {
      const page = new Uint8Array(await readFile(`${assetRoot(variant)}/${size}/450-30-688.bin`));
      const stats: Stats = {
        calls: 0,
        compressedBytes: 0,
        inflatedBytes: 0,
        assetReads: 0,
        assetBytes: page.length,
        selectedBytes: 0,
        assetSha256: createHash('sha256').update(page).digest('hex'),
      };
      const atlas = measuredDecoder(variant, stats)(page, keys, 64);
      stats.selectedBytes = atlas.pixels.length;
      const frame = packAtlasChunk(atlas, 0, 1);
      candidates[variant] = { page, frame, stats };
      if (variant !== 'single')
        assert.ok(Buffer.from(frame).equals(candidates.single.frame), 'Micro frame mismatch');
    }
    microInputs.push({ size, fixture, keys, chunks: 1, variants: candidates });
  }
}
