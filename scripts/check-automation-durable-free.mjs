import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';

const root = fileURLToPath(new URL('../', import.meta.url));
export function validateDurableTrialConfigs(renderer, probe, rendererPath, probePath) {
  const keys = (value, allowed) =>
    assert(
      Object.keys(value).every((key) => allowed.includes(key)),
      'Unexpected trial configuration field',
    );
  keys(renderer, [
    '$schema',
    'account_id',
    'name',
    'main',
    'compatibility_date',
    'compatibility_flags',
    'workers_dev',
    'preview_urls',
    'assets',
    'durable_objects',
    'migrations',
    'd1_databases',
    'kv_namespaces',
    'observability',
  ]);
  keys(probe, [
    '$schema',
    'account_id',
    'name',
    'main',
    'compatibility_date',
    'workers_dev',
    'preview_urls',
    'durable_objects',
    'observability',
  ]);
  assert.equal(renderer.name, 'en-card-png-do-trial');
  assert.equal(probe.name, 'en-card-png-do-probe');
  assert.equal(
    resolve(dirname(rendererPath), renderer.main),
    resolve(root, 'experiments/automation-png/durable-worker.ts'),
  );
  assert.equal(
    resolve(dirname(probePath), probe.main),
    resolve(root, 'experiments/automation-png/durable-probe.ts'),
  );
  assert.equal(renderer.compatibility_date, '2026-09-01');
  assert.equal(probe.compatibility_date, renderer.compatibility_date);
  assert.deepEqual(renderer.compatibility_flags, ['nodejs_compat']);
  assert.equal(renderer.workers_dev, false);
  assert.equal(probe.workers_dev, true);
  assert.equal(renderer.preview_urls, false);
  assert.equal(probe.preview_urls, false);
  assert.deepEqual(renderer.observability, { enabled: false });
  assert.deepEqual(probe.observability, { enabled: false });
  assert.deepEqual(renderer.migrations, [{ tag: 'v1', new_sqlite_classes: ['CardPngTrial'] }]);
  assert.deepEqual(renderer.durable_objects, {
    bindings: [{ name: 'PNG_TRIAL', class_name: 'CardPngTrial' }],
  });
  assert.deepEqual(probe.durable_objects, {
    bindings: [{ name: 'PNG_TRIAL', class_name: 'CardPngTrial', script_name: renderer.name }],
  });
  keys(renderer.assets, ['directory', 'binding', 'run_worker_first']);
  assert.equal(renderer.assets.binding, 'FONT_ASSETS');
  assert.equal(renderer.assets.run_worker_first, true);
  assert.equal(
    resolve(dirname(rendererPath), renderer.assets.directory),
    resolve(root, '.automation-png/durable/assets'),
  );
  assert.equal(renderer.d1_databases.length, 1);
  const db = renderer.d1_databases[0];
  keys(db, ['binding', 'database_name', 'database_id', 'migrations_dir']);
  assert.equal(db.binding, 'DB');
  assert.equal(db.database_name, renderer.name);
  assert.match(db.database_id, /^[0-9a-f-]{36}$/);
  assert.equal(resolve(dirname(rendererPath), db.migrations_dir), resolve(root, 'migrations'));
  assert.equal(renderer.kv_namespaces.length, 1);
  keys(renderer.kv_namespaces[0], ['binding', 'id']);
  assert.equal(renderer.kv_namespaces[0].binding, 'CARD_IMAGES');
  assert.match(renderer.kv_namespaces[0].id, /^[0-9a-f]{32}$/);
  return {
    scope: 'isolated SQLite DO PNG trial',
    freeConfiguration: true,
    billingGuarantee: false,
    accountPlanMustBeVerifiedSeparately: true,
    maxRenderAttempts: 40,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [rendererPath, probePath] = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        'experiments/automation-png/wrangler.durable.jsonc',
        'experiments/automation-png/wrangler.durable-probe.jsonc',
      ];
  assert(rendererPath && probePath, 'Supply both config paths');
  const read = async (path) => {
    const errors = [];
    const value = parse(await readFile(path, 'utf8'), errors, { allowTrailingComma: true });
    assert.equal(errors.length, 0, 'Invalid config JSONC');
    return value;
  };
  const renderer = await read(rendererPath),
    probe = await read(probePath);
  const result = validateDurableTrialConfigs(
    renderer,
    probe,
    resolve(rendererPath),
    resolve(probePath),
  );
  // The actual resolved identifiers must never match the existing product resources.
  for (const file of ['wrangler.jsonc', 'wrangler.deploy.jsonc', 'wrangler.live.jsonc']) {
    let production;
    try {
      production = await read(resolve(root, file));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const db of production.d1_databases ?? [])
      if (db.database_id && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(db.database_id))
        assert.notEqual(
          renderer.d1_databases[0].database_id,
          db.database_id,
          'Production DB forbidden',
        );
    for (const kv of production.kv_namespaces ?? [])
      if (kv.id && !/^0{32}$/.test(kv.id))
        assert.notEqual(renderer.kv_namespaces[0].id, kv.id, 'Production KV forbidden');
  }
  console.log(JSON.stringify(result));
}
