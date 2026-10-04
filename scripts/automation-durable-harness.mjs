import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const exec = promisify(execFile);
export async function buildDurableTrial() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
  await exec(process.execPath, ['scripts/benchmark-automation-png.mjs', '--durable-build'], {
    env,
  });
  for (const name of ['durable', 'durable-probe']) {
    await exec(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'deploy',
        '--dry-run',
        '--config',
        `experiments/automation-png/wrangler.${name}.jsonc`,
        '--outdir',
        resolve(`.automation-png/durable/${name}-build`),
      ],
      { env },
    );
  }
}

export async function durableHarness({ missingFonts = false, failCommit = false } = {}) {
  const token = randomBytes(32).toString('hex');
  const scriptRoot = resolve('.automation-png/durable/durable-build');
  const wasmFile = (await readdir(scriptRoot)).find((name) => name.endsWith('.wasm'));
  if (!wasmFile) throw new Error('Missing compiled wasm module');
  let rendererSource = await readFile(resolve(scriptRoot, 'durable-worker.js'), 'utf8');
  if (failCommit) {
    // Test-only fault at the durable completion write. No fault endpoint/flag is deployed.
    const marker =
      /await this\.ctx\.storage\.put\(key, \{ hash: \w+, status: "complete", result \}\);/g;
    if ([...rendererSource.matchAll(marker)].length !== 1)
      throw new Error('Commit fault injection target changed');
    rendererSource = rendererSource.replace(
      marker,
      'throw new Error("TEST_COMPLETE_COMMIT_FAILURE");',
    );
  }
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      cf: false,
      telemetry: { enabled: false },
      workers: [
        {
          name: 'probe',
          modules: true,
          scriptPath: resolve('.automation-png/durable/durable-probe-build/durable-probe.js'),
          compatibilityDate: '2026-09-01',
          bindings: { BENCH_TOKEN: token },
          durableObjects: {
            PNG_TRIAL: { className: 'CardPngTrial', scriptName: 'renderer', useSQLite: true },
          },
        },
        {
          name: 'renderer',
          modules: [
            {
              type: 'ESModule',
              path: resolve(scriptRoot, 'durable-worker.js'),
              contents: rendererSource,
            },
            { type: 'CompiledWasm', path: resolve(scriptRoot, wasmFile) },
          ],
          modulesRoot: scriptRoot,
          compatibilityDate: '2026-09-01',
          compatibilityFlags: ['nodejs_compat'],
          durableObjects: { PNG_TRIAL: { className: 'CardPngTrial', useSQLite: true } },
          d1Databases: ['DB'],
          kvNamespaces: ['CARD_IMAGES'],
          serviceBindings: {
            FONT_ASSETS: async (request) => {
              const name = new URL(request.url).pathname;
              if (missingFonts || !['/fonts.json', '/fonts.bin'].includes(name))
                return new Response('Not found', { status: 404 });
              return new Response(await readFile(`.automation-png/durable/assets${name}`));
            },
          },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'renderer');
    for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await db.exec((await readFile(`migrations/${name}`, 'utf8')).replaceAll('\n', ' '));
    const call = (slot, input, options = {}) =>
      mf.dispatchFetch(`https://trial.invalid/durable/${slot}/render`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: typeof input === 'string' ? input : JSON.stringify(input),
      });
    const image = (slot, job) =>
      mf.dispatchFetch(`https://trial.invalid/durable/${slot}/image/${job}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    return { mf, db, call, image, token };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
