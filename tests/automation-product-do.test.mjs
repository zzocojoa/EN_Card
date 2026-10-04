import { beforeAll, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const exec = promisify(execFile);
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
it('product SQLite DO renders, validates and saves a real 1080 PNG using packaged fonts', async () => {
  const root = resolve('.worker-automation-build');
  const wasm = (await readdir(root)).find((n) => n.endsWith('.wasm'));
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      cf: false,
      telemetry: { enabled: false },
      workers: [
        {
          name: 'test-gateway',
          modules: true,
          script:
            'export default {fetch(request,env){return env.AUTO.get(env.AUTO.idFromName("owner")).fetch(request)}}',
          compatibilityDate: '2026-09-01',
          durableObjects: {
            AUTO: { className: 'CardAutomation', scriptName: 'automation', useSQLite: true },
          },
        },
        {
          name: 'automation',
          modules: [
            { type: 'ESModule', path: resolve(root, 'worker.js') },
            { type: 'CompiledWasm', path: resolve(root, wasm) },
          ],
          modulesRoot: root,
          compatibilityDate: '2026-09-01',
          compatibilityFlags: ['nodejs_compat'],
          durableObjects: { AUTOMATION: { className: 'CardAutomation', useSQLite: true } },
          d1Databases: ['DB'],
          kvNamespaces: ['CARD_IMAGES'],
          bindings: {
            APP_ORIGIN: 'https://cards.example.test',
            COST_MODE: 'free_only',
            SEND_MODE: 'live',
            AUTOMATION_MODE: 'live',
            AI_FREE_CONFIRMED: 'google_groq_free',
          },
          serviceBindings: {
            FONT_ASSETS: async (request) => {
              const path = new URL(request.url).pathname;
              if (!['/fonts.bin', '/fonts.json'].includes(path))
                return new Response(null, { status: 404 });
              return new Response(await readFile(`.automation-fonts${path}`));
            },
          },
          outboundService: async () => {
            throw new Error('This test must never call AI or Kakao');
          },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'automation');
    for (const file of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await db.exec((await readFile(`migrations/${file}`, 'utf8')).replaceAll('\n', ' '));
    const card = {
      template: 'expression',
      expression: 'Take your time',
      meaning_ko: '천천히 해',
      example_en: 'Take your time. We can leave later.',
      example_ko: '천천히 해. 나중에 출발해도 돼.',
      note_ko: '',
      base_expression: '',
      base_meaning_ko: '',
    };
    const content = JSON.stringify(card);
    const digest = createHash('sha256').update(content).digest('hex');
    const now = Date.now();
    const due = now + 3600000;
    const day = new Date(due + 9 * 3600000).toISOString().slice(0, 10);
    const time = new Date(due + 9 * 3600000).toISOString().slice(11, 16);
    const settings = JSON.stringify({
      topic: '일상',
      base_expression: '',
      level: '초급',
      template: 'expression',
      start_date: day,
      end_date: null,
      time,
    });
    await db
      .prepare(
        'INSERT INTO automation_settings(singleton,settings,version,enabled,updated_at) VALUES(1,?,1,1,?)',
      )
      .bind(settings, now)
      .run();
    const cardId = crypto.randomUUID(),
      assetId = crypto.randomUUID(),
      scheduleId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO automation_runs(id,dedupe_key,day,config_version,settings,due_at,deadline,status,writer,reviewer,content,content_hash,review_hash,card_id,asset_id,public_id,schedule_id,updated_at) VALUES('test',?,?,1,?,?,?,'render','google','groq',?,?,?,?,?,?,?,?)",
      )
      .bind(
        day,
        day,
        settings,
        due,
        due - 300000,
        content,
        digest,
        digest,
        cardId,
        assetId,
        'a'.repeat(64),
        scheduleId,
        now,
      )
      .run();
    const tick = await mf.dispatchFetch('https://internal/tick', {
      method: 'POST',
      headers: { 'X-Card-Relay-Key': 'a'.repeat(64) },
    });
    expect(tick.status).toBe(204);
    const row = await db.prepare('SELECT status,error FROM automation_runs').first();
    expect(row).toEqual({ status: 'schedule', error: null });
    const kv = await mf.getKVNamespace('CARD_IMAGES', 'automation');
    const png = Buffer.from(await kv.get(assetId, 'arrayBuffer'));
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1080);
    expect(png.length).toBeLessThan(1048576);
    expect(await db.prepare('SELECT state,bytes FROM assets').first()).toEqual({
      state: 'ready',
      bytes: png.length,
    });
    expect((await db.prepare('SELECT review_source FROM cards').first()).review_source).toBe('ai');
    expect((await mf.dispatchFetch('https://internal/tick')).status).toBe(404);
    const trialRequest = (body) =>
      mf.dispatchFetch('https://internal/api/automation/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await trialRequest({ version: 1, settings: { topic: 'ignored' } })).status).toBe(400);
    expect((await trialRequest({ version: 1 })).status).toBe(503);
    expect((await mf.dispatchFetch('https://internal/api/automation/trial')).status).toBe(404);
    expect(await db.prepare('SELECT count(*) n FROM automation_runs').first('n')).toBe(1);
    expect(
      (
        await mf.dispatchFetch('https://internal/api/automation', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: 'x'.repeat(4097),
        })
      ).status,
    ).toBe(413);
    await expect(
      (await mf.getWorker('automation'))
        .fetch('https://public.invalid/api/automation')
        .then((r) => r.status),
    ).resolves.toBe(404);
  } finally {
    await mf.dispose();
  }
}, 60000);
