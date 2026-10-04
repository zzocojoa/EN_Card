import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = process.argv.includes('--durable-build')
  ? 'durable-build'
  : process.argv.includes('--atlas-optimized-build')
    ? 'atlas-optimized-build'
    : process.argv.includes('--atlas-optimized')
      ? 'atlas-optimized-benchmark'
      : process.argv.includes('--atlas-pipeline')
        ? 'atlas-pipeline-benchmark'
        : process.argv.includes('--atlas-assembly-profile')
          ? 'atlas-assembly-profile'
          : process.argv.includes('--atlas-chunks')
            ? 'atlas-chunks-benchmark'
            : process.argv.includes('--atlas-common')
              ? 'atlas-common-build'
              : process.argv.includes('--atlas-pages')
                ? 'atlas-pages-benchmark'
                : process.argv.includes('--atlas-full')
                  ? 'atlas-full-build'
                  : process.argv.includes('--atlas')
                    ? 'atlas-benchmark'
                    : process.argv.includes('--profile')
                      ? 'profile'
                      : 'benchmark';
await mkdir(new URL('../.automation-png/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [`experiments/automation-png/${entry}.ts`],
  outfile: `.automation-png/${entry}.mjs`,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
});
const result = spawnSync(process.execPath, ['--expose-gc', `.automation-png/${entry}.mjs`], {
  cwd: root,
  stdio: 'inherit',
  timeout: ['atlas-full-build', 'atlas-optimized-build'].includes(entry) ? 600000 : 120000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
