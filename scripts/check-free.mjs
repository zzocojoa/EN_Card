import { readFile, readdir } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { parse } from 'jsonc-parser';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    mode: { type: 'string' },
    'delivery-config': { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
const root = fileURLToPath(new URL('../', import.meta.url));
const defaultPath = resolve(root, 'wrangler.jsonc');
const configPath = values.config ? resolve(values.config) : defaultPath;
const mode = values.mode ?? 'dry_run';
assert(['dry_run', 'live'].includes(mode), '검사 모드는 dry_run 또는 live만 허용합니다.');
assert.equal(
  dirname(configPath),
  resolve(root),
  '배포 설정은 프로젝트 루트에 두세요. 상대 자산·소스·마이그레이션 경로를 동일하게 유지합니다.',
);
assert(
  mode !== 'live' || (values.config && configPath !== defaultPath),
  'live 검사는 별도 --config 파일을 명시해야 합니다. 기본 설정은 변경하지 마세요.',
);
const defaultErrors = [];
const defaultConfig = parse(await readFile(defaultPath, 'utf8'), defaultErrors, {
  allowTrailingComma: true,
});
assert.equal(defaultErrors.length, 0, '기본 Wrangler JSONC 구문을 확인하세요.');
assert.equal(defaultConfig.vars.SEND_MODE, 'dry_run', '기본 설정은 항상 dry_run이어야 합니다.');
const configText = await readFile(configPath, 'utf8');
const configErrors = [];
const config = parse(configText, configErrors, { allowTrailingComma: true });
assert.equal(configErrors.length, 0, 'Wrangler JSONC 구문이 잘못되었습니다.');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const allowed = new Set([
  '$schema',
  'name',
  'main',
  'compatibility_date',
  'workers_dev',
  'assets',
  'vars',
  'd1_databases',
  'kv_namespaces',
  'triggers',
  'observability',
  'services',
]);
assert(
  Object.keys(config).every((key) => allowed.has(key)),
  '허용되지 않은 Worker 바인딩/서비스 설정이 있습니다.',
);
assert.equal(config.main, 'src/worker/index.ts');
assert.equal(config.workers_dev, true);
assert.equal(config.vars.COST_MODE, 'free_only');
assert.equal(config.vars.SEND_MODE, mode, '검사 모드와 실제 배포 설정의 SEND_MODE가 다릅니다.');
assert(new URL(config.vars.APP_ORIGIN).protocol === 'https:');
assert.deepEqual(Object.keys(config.vars).sort(), ['APP_ORIGIN', 'COST_MODE', 'SEND_MODE']);
assert.deepEqual(config.triggers.crons, ['* * * * *']);
assert.equal(config.d1_databases.length, 1);
assert.equal(config.kv_namespaces.length, 1);
assert.equal(config.d1_databases[0].binding, 'DB');
assert.equal(config.kv_namespaces[0].binding, 'CARD_IMAGES');
assert(
  JSON.stringify(config.services) ===
    JSON.stringify([{ binding: 'DELIVERY_SERVICE', service: 'en-card-delivery' }]),
  '허용되지 않은 발송 서비스 설정입니다.',
);
const deliveryConfigPath = values['delivery-config']
  ? resolve(values['delivery-config'])
  : resolve(root, 'wrangler.delivery.jsonc');
assert.equal(
  dirname(deliveryConfigPath),
  resolve(root),
  '발송 Worker 설정도 프로젝트 루트에 두세요.',
);
const deliveryConfigText = await readFile(deliveryConfigPath, 'utf8');
const deliveryErrors = [];
const deliveryConfig = parse(deliveryConfigText, deliveryErrors, { allowTrailingComma: true });
assert.equal(deliveryErrors.length, 0, '발송 Worker JSONC 구문을 확인하세요.');
const deliveryAllowed = new Set([
  '$schema',
  'name',
  'main',
  'compatibility_date',
  'workers_dev',
  'preview_urls',
  'vars',
  'd1_databases',
  'observability',
]);
assert(
  Object.keys(deliveryConfig).every((key) => deliveryAllowed.has(key)),
  '허용되지 않은 발송 Worker 바인딩/서비스 설정입니다.',
);
assert.equal(deliveryConfig.name, 'en-card-delivery');
assert.equal(deliveryConfig.main, 'src/worker/delivery-service.ts');
assert.equal(deliveryConfig.workers_dev, false, '발송 Worker의 공개 접근을 끄세요.');
assert.equal(deliveryConfig.preview_urls, false, '발송 Worker의 preview 공개 접근을 끄세요.');
assert.deepEqual(deliveryConfig.vars, {
  APP_ORIGIN: config.vars.APP_ORIGIN,
  COST_MODE: 'free_only',
  SEND_MODE: 'live',
});
assert.equal(deliveryConfig.d1_databases.length, 1);
assert.equal(deliveryConfig.d1_databases[0].binding, 'DB');
assert.equal(
  deliveryConfig.d1_databases[0].database_id,
  config.d1_databases[0].database_id,
  '발송 Worker는 같은 D1을 사용해야 합니다.',
);
assert.equal(deliveryConfig.d1_databases[0].database_name, config.d1_databases[0].database_name);
assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['react', 'react-dom', 'zod']);
assert(
  Object.values({ ...pkg.dependencies, ...pkg.devDependencies }).every((version) =>
    /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version),
  ),
  '의존성 버전을 정확히 고정하세요.',
);
const bundle = await readFile(new URL('../.worker-build/index.js', import.meta.url), 'utf8');
assert(!bundle.includes('/auth/local'), '운영 번들에 로컬 인증 경로가 들어 있습니다.');
assert(!bundle.includes('async function sendMock'), '운영 번들에 모의 발송 구현이 들어 있습니다.');
assert(!bundle.includes('local-development-only'), '운영 번들에 로컬 인증 설정이 들어 있습니다.');
const workerFiles = (await readdir(new URL('../src/worker', import.meta.url))).filter(
  (name) => name.endsWith('.ts') && !['local.ts', 'mock.ts'].includes(name),
);
const code = (
  await Promise.all(
    workerFiles.map((name) => readFile(new URL(`../src/worker/${name}`, import.meta.url), 'utf8')),
  )
).join('\n');
const urls = [...code.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)].map((match) => match[1]);
assert(
  urls.every((host) => ['kapi.kakao.com', 'kauth.kakao.com'].includes(host)),
  '허용되지 않은 외부 서비스 주소가 있습니다.',
);
assert(!/from ['"].*(?:local|mock)['"]/.test(code), '운영 코드에서 로컬/모의 모듈을 참조합니다.');
const migration = await readFile(
  new URL('../migrations/0001_initial.sql', import.meta.url),
  'utf8',
);
for (const limit of [
  '1048576',
  '200000000',
  'BETWEEN 0 AND 100',
  'BETWEEN 0 AND 20',
  'BETWEEN 0 AND 3',
])
  assert(migration.includes(limit), `DB 보호 설정 누락: ${limit}`);
console.log(
  JSON.stringify(
    {
      check: 'free_configuration',
      result: 'passed',
      runtime: ['Workers Free', 'D1 Free', 'KV Free'],
      externalHosts: [...new Set(urls)],
      defaultMode: 'dry_run',
      checkedMode: mode,
      configPath,
      configSha256: createHash('sha256').update(configText).digest('hex'),
      deliveryConfigPath,
      deliveryConfigSha256: createHash('sha256').update(deliveryConfigText).digest('hex'),
      deploymentPerformed: false,
      accountPlan: '미확인',
      remoteCpu: '미검증',
      billingGuarantee: false,
    },
    null,
    2,
  ),
);
