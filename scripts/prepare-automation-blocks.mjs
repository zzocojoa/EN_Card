import { build } from 'esbuild';
await build({
  entryPoints: ['experiments/automation-png/prepare-block-pages.ts'],
  outfile: '.automation-png/prepare-block-pages.mjs',
  bundle: true,
  platform: 'node',
  packages: 'external',
  format: 'esm',
});
await import('../.automation-png/prepare-block-pages.mjs');
