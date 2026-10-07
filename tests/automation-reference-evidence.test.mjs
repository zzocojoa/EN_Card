import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateReferenceManifest } from '../scripts/check-automation-reference.mjs';

const original = JSON.parse(
  readFileSync('docs/evidence/AI_PNG_REFERENCE_WORKER_2026-10-03.json', 'utf8'),
);
it('accepts the complete recorded reference manifest', () => {
  expect(() => validateReferenceManifest(original)).not.toThrow();
});
it('requires the shared layout in version 2 without accepting a legacy or missing dependency', () => {
  const current = structuredClone(original);
  current.source_manifest_version = 2;
  expect(() => validateReferenceManifest(current)).toThrow();
  const layout = current.sources.find((entry) => entry.file === 'src/web/canvas.ts');
  layout.file = 'src/shared/card-layout.ts';
  expect(() => validateReferenceManifest(current)).not.toThrow();
  current.sources = current.sources.filter((entry) => entry !== layout);
  expect(() => validateReferenceManifest(current)).toThrow();
});
it('rejects unknown source manifest versions', () => {
  expect(() => validateReferenceManifest({ ...original, source_manifest_version: 3 })).toThrow();
});
it.each(['sources', 'assets', 'scriptHashes', 'probe_sha256'])(
  'rejects missing %s evidence',
  (field) => {
    const bad = structuredClone(original);
    delete bad[field];
    expect(() => validateReferenceManifest(bad)).toThrow();
  },
);
it('rejects empty, partial, duplicated and malformed manifests before any file read', () => {
  const mutations = [
    (x) => {
      x.sources = [];
    },
    (x) => {
      x.assets = {};
    },
    (x) => {
      x.scriptHashes = {};
    },
    (x) => {
      x.sources[0] = x.sources[1];
    },
    (x) => {
      x.sources[0].sha256 = 'not-a-hash';
    },
    (x) => {
      x.scriptHashes.copy_native = 'invalid';
    },
    (x) => {
      x.probe_sha256 = '';
    },
    (x) => {
      delete x.assets['.automation-png/atlas-optimized/800/common.bin'];
    },
    (x) => {
      const key = Object.keys(x.assets)[4];
      delete x.assets[key];
    },
    (x) => {
      const key = Object.keys(x.assets)[4];
      x.assets['../outside.bin'] = x.assets[key];
      delete x.assets[key];
    },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(original);
    mutate(bad);
    expect(() => validateReferenceManifest(bad)).toThrow();
  }
});
