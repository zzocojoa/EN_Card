import { beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { encrypt, decrypt } from '../src/worker/crypto';
const exec = promisify(execFile);
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
beforeAll(async () => {
  await exec(process.execPath, ['scripts/prepare-automation-fonts.mjs']);
  await exec(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js',
    'deploy',
    '--config',
    'wrangler.automation.jsonc',
    '--dry-run',
    '--outdir',
    '.worker-automation-build',
  ]);
}, 60000);

it('real private RPC preserves grants, rotation, error metadata and denies HTTP credential routes', async () => {
  const gateway = await build({
    stdin: {
      contents: `import {scheduledToken} from './src/worker/durable-token';
      export default {async fetch(request,env) {try {
        return Response.json(await scheduledToken(env,Date.now()));
      } catch (e) {return Response.json({name:e.name,code:e.code,kind:e.tokenFailure,
        retryAt:e.retryAt,httpStatus:e.httpStatus,providerError:e.providerError,
        providerCode:e.providerCode}, {status:503});}}};`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const root = resolve('.worker-automation-build');
  const wasm = (await readdir(root)).find((n) => n.endsWith('.wasm'));
  let calls = 0;
  let temporary = false;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      cf: false,
      telemetry: { enabled: false },
      workers: [
        {
          name: 'gateway',
          modules: true,
          script: gateway.outputFiles[0].text,
          compatibilityDate: '2026-09-01',
          durableObjects: {
            AUTOMATION: { className: 'CardAutomation', scriptName: 'automation', useSQLite: true },
          },
          bindings: {
            TOKEN_ENCRYPTION_KEY: key,
            KAKAO_REST_API_KEY: 'synthetic-key',
            KAKAO_CLIENT_SECRET: 'synthetic-secret',
          },
          outboundService: async () => {
            throw new Error('No local token fallback allowed');
          },
        },
        {
          name: 'automation',
          modulesRoot: root,
          modules: [
            { type: 'ESModule', path: resolve(root, 'worker.js') },
            { type: 'CompiledWasm', path: resolve(root, wasm) },
          ],
          compatibilityDate: '2026-09-01',
          compatibilityFlags: ['nodejs_compat'],
          durableObjects: { AUTOMATION: { className: 'CardAutomation', useSQLite: true } },
          d1Databases: ['DB'],
          kvNamespaces: ['CARD_IMAGES'],
          bindings: {
            APP_ORIGIN: 'https://cards.example.test',
            COST_MODE: 'free_only',
            SEND_MODE: 'live',
            AUTOMATION_MODE: 'off',
            AI_FREE_CONFIRMED: 'unconfirmed',
          },
          outboundService: async (request) => {
            expect(request.url).toBe('https://kauth.kakao.com/oauth/token');
            const form = new URLSearchParams(await request.text());
            expect(form.get('client_id')).toBe('synthetic-key');
            expect(form.get('client_secret')).toBe('synthetic-secret');
            expect(form.get('refresh_token')).toBe('synthetic-refresh');
            calls++;
            return temporary
              ? Response.json({ error: 'temporarily_unavailable' }, { status: 503 })
              : Response.json({
                  access_token: 'synthetic-new',
                  expires_in: 3600,
                  refresh_token: 'synthetic-rotated',
                  refresh_token_expires_in: 86400,
                });
          },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'automation');
    for (const file of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await db.exec((await readFile(`migrations/${file}`, 'utf8')).replaceAll('\n', ' '));
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,
      expires_at,refresh_expires_at,version,status) VALUES(1,'fixture',?,?,?,?,1,'connected')`,
      )
      .bind(
        await encrypt('synthetic-old', key),
        await encrypt('synthetic-refresh', key),
        now + 3600_000,
        now + 86400_000,
      )
      .run();
    const invoke = () => mf.dispatchFetch('https://test.invalid/token');
    expect(await (await invoke()).json()).toMatchObject({ token: 'synthetic-old', version: 1 });
    expect(calls).toBe(0);
    await db.prepare('UPDATE credentials SET expires_at=0').run();
    expect(await (await invoke()).json()).toMatchObject({
      token: 'synthetic-new',
      version: 2,
      refreshed: true,
    });
    expect(calls).toBe(1);
    const row = await db.prepare('SELECT refresh_token,lock_owner FROM credentials').first();
    expect(await decrypt(row.refresh_token, key)).toBe('synthetic-rotated');
    expect(row.lock_owner).toBeNull();
    temporary = true;
    await db
      .prepare('UPDATE credentials SET expires_at=0,refresh_token=?')
      .bind(await encrypt('synthetic-refresh', key))
      .run();
    const response = await invoke();
    expect(response.status).toBe(503);
    const error = await response.json();
    expect(error).toMatchObject({
      name: 'TOKEN_TEMPORARY',
      code: 'TOKEN_TEMPORARY',
      kind: 'transient',
      httpStatus: 503,
      providerError: 'temporarily_unavailable',
      providerCode: null,
    });
    expect(error.retryAt).toBeGreaterThan(now);
    expect(await (await invoke()).json()).toEqual(error);
    expect(calls).toBe(2);
    const doNamespace = await mf.getDurableObjectNamespace('AUTOMATION', 'automation');
    const stub = doNamespace.get(doNamespace.idFromName('credentials'));
    for (const path of ['/credentialToken', '/_internal/token', '/api/credentialToken']) {
      expect((await stub.fetch(`https://private.invalid${path}`, { method: 'POST' })).status).toBe(
        404,
      );
      expect(
        (await (await mf.getWorker('automation')).fetch(`https://public.invalid${path}`)).status,
      ).toBe(404);
    }
    expect(calls).toBe(2);
  } finally {
    await mf.dispose();
  }
}, 60000);
