import { readFile, readdir } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { parse } from 'jsonc-parser';
export async function checkAutomationConfig(path, main, active = false) {
  const errors = [];
  const config = parse(await readFile(path, 'utf8'), errors, { allowTrailingComma: true });
  assert.equal(errors.length, 0);
  const allowed = [
    '$schema',
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
    'vars',
    'observability',
  ];
  assert(
    Object.keys(config).every((k) => allowed.includes(k)),
    '자동 제작의 미허용 바인딩입니다.',
  );
  assert.equal(config.name, 'en-card-automation');
  assert.equal(config.main, 'src/automation/worker.ts');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.deepEqual(config.assets, {
    directory: '.automation-fonts',
    binding: 'FONT_ASSETS',
    run_worker_first: true,
  });
  assert.deepEqual(config.durable_objects, {
    bindings: [{ name: 'AUTOMATION', class_name: 'CardAutomation' }],
  });
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['CardAutomation'] }]);
  assert.deepEqual(Object.keys(config.vars).sort(), [
    'AI_FREE_CONFIRMED',
    'APP_ORIGIN',
    'AUTOMATION_MODE',
    'COST_MODE',
    'SEND_MODE',
  ]);
  assert.equal(config.vars.COST_MODE, 'free_only');
  assert.equal(config.vars.AUTOMATION_MODE, active ? 'live' : 'off');
  assert.equal(config.vars.AI_FREE_CONFIRMED, active ? 'google_groq_free' : 'unconfirmed');
  // Credential RPC serves manual schedules too, independently of AI activation.
  assert.equal(
    config.vars.SEND_MODE,
    main.vars.SEND_MODE,
    '인증 DO의 SEND_MODE는 주 Worker와 같아야 합니다.',
  );
  if (active) assert.equal(config.vars.SEND_MODE, 'live');
  assert.deepEqual(config.d1_databases, main.d1_databases);
  assert.deepEqual(config.kv_namespaces, main.kv_namespaces);
  assert.equal(config.vars.APP_ORIGIN, main.vars.APP_ORIGIN);
  assert.equal(config.observability.enabled, false);
  const root = new URL('../src/automation/', import.meta.url);
  const code =
    (
      await Promise.all(
        (await readdir(root))
          .filter((n) => n.endsWith('.ts'))
          .map((n) => readFile(new URL(n, root), 'utf8')),
      )
    ).join('\n') +
    (await readFile(new URL('../src/shared/automation-relay.ts', import.meta.url), 'utf8'));
  const hosts = [...code.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)].map((m) => m[1]);
  assert(
    hosts.every((h) =>
      [
        'font.internal',
        'generativelanguage.googleapis.com',
        'api.groq.com',
        'wordgrain-oxford-study.hoihou-o.chatgpt.site',
      ].includes(h),
    ),
    '자동 제작의 미허용 외부 주소입니다.',
  );
  assert(!/from ['"].*(?:experiments|local|mock)['"]/.test(code));
  return {
    runtime: 'SQLite Durable Objects Free',
    aiFreeAccount: active ? '설정 선언: 별도 계정 확인 필요' : '미확인·호출 중지',
    hosts: [...new Set(hosts)],
  };
}
