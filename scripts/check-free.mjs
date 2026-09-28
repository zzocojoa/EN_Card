import { readFile, readdir } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { parse } from 'jsonc-parser';

const configErrors = [];
const config = parse(
  await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  configErrors,
  { allowTrailingComma: true },
);
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
]);
assert(
  Object.keys(config).every((key) => allowed.has(key)),
  '허용되지 않은 Worker 바인딩/서비스 설정이 있습니다.',
);
assert.equal(config.main, 'src/worker/index.ts');
assert.equal(config.workers_dev, true);
assert.equal(config.vars.COST_MODE, 'free_only');
assert.equal(
  config.vars.SEND_MODE,
  'dry_run',
  '배포 기본값은 dry_run이어야 합니다. 실제 발송 준비 후 별도 승인된 설정으로 변경하세요.',
);
assert(new URL(config.vars.APP_ORIGIN).protocol === 'https:');
assert.deepEqual(Object.keys(config.vars).sort(), ['APP_ORIGIN', 'COST_MODE', 'SEND_MODE']);
assert.deepEqual(config.triggers.crons, ['* * * * *']);
assert.equal(config.d1_databases.length, 1);
assert.equal(config.kv_namespaces.length, 1);
assert.equal(config.d1_databases[0].binding, 'DB');
assert.equal(config.kv_namespaces[0].binding, 'CARD_IMAGES');
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
      accountPlan: '미확인',
      remoteCpu: '미검증',
      billingGuarantee: false,
    },
    null,
    2,
  ),
);
