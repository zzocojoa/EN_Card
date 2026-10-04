import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, expect, it } from 'vitest';

const execute = promisify(execFile);
let directory: string;
type Configuration = {
  vars: { APP_ORIGIN: string; COST_MODE: string; SEND_MODE: string };
  main: string;
  [key: string]: unknown;
};
let config: Configuration;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'en-card-free-check-')));
  for (const path of [
    'scripts',
    '.worker-build',
    'src/worker',
    'src/automation',
    'src/shared',
    'migrations',
  ])
    await mkdir(join(directory, path), { recursive: true });
  for (const path of [
    'scripts/check-free.mjs',
    'scripts/check-automation-config.mjs',
    'src/shared/automation-relay.ts',
    'package.json',
    'wrangler.jsonc',
    'wrangler.delivery.jsonc',
    'wrangler.automation.jsonc',
    'migrations/0001_initial.sql',
  ])
    await copyFile(resolve(path), join(directory, path));
  // Windows에서는 symlink 권한 변경 없이 같은 의존성 디렉터리를 공유한다.
  await symlink(
    resolve('node_modules'),
    join(directory, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect(await realpath(join(directory, 'node_modules'))).toBe(
    await realpath(resolve('node_modules')),
  );
  await writeFile(join(directory, '.worker-build/index.js'), 'export default {};');
  await writeFile(join(directory, 'src/worker/index.ts'), "const url = 'https://kapi.kakao.com';");
  config = parse(await readFile('wrangler.jsonc', 'utf8')) as Configuration;
});
it('automation is SQLite-only, private, and the default config always stays inactive', async () => {
  const path = join(directory, 'wrangler.automation.jsonc');
  const original = parse(await readFile(path, 'utf8'));
  const active = {
    ...original,
    vars: {
      ...original.vars,
      SEND_MODE: 'live',
      AUTOMATION_MODE: 'live',
      AI_FREE_CONFIRMED: 'google_groq_free',
    },
  };
  await writeFile(join(directory, 'wrangler.automation.live.jsonc'), JSON.stringify(active));
  await liveConfig();
  const args = [
    '--config',
    'wrangler.live.jsonc',
    '--mode',
    'live',
    '--automation-config',
    'wrangler.automation.live.jsonc',
    '--automation-active',
  ];
  expect(JSON.parse(await check(args))).toMatchObject({ result: 'passed' });
  await writeFile(path, JSON.stringify(active));
  await expect(check(args)).rejects.toThrow();
  await writeFile(path, JSON.stringify(original));
  await expect(
    check([
      '--config',
      'wrangler.live.jsonc',
      '--mode',
      'live',
      '--automation-config',
      'wrangler.automation.jsonc',
      '--automation-active',
    ]),
  ).rejects.toThrow('별도 설정');
  await expect(
    check(['--automation-config', 'wrangler.automation.live.jsonc', '--automation-active']),
  ).rejects.toThrow('주 Worker의 live');
  for (const changed of [
    { ...original, workers_dev: true },
    { ...original, migrations: [{ tag: 'v1', new_classes: ['CardAutomation'] }] },
    { ...original, r2_buckets: [] },
  ]) {
    await writeFile(path, JSON.stringify(changed));
    await expect(check([])).rejects.toThrow();
  }
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function check(args: string[]): Promise<string> {
  return (await execute(process.execPath, ['scripts/check-free.mjs', ...args], { cwd: directory }))
    .stdout;
}
const liveArgs = [
  '--config',
  'wrangler.live.jsonc',
  '--mode',
  'live',
  '--automation-config',
  'wrangler.automation.manual.jsonc',
];
async function liveConfig(): Promise<void> {
  await writeFile(
    join(directory, 'wrangler.live.jsonc'),
    JSON.stringify({ ...config, vars: { ...config.vars, SEND_MODE: 'live' } }),
  );
  const automation = parse(await readFile(join(directory, 'wrangler.automation.jsonc'), 'utf8'));
  await writeFile(
    join(directory, 'wrangler.automation.manual.jsonc'),
    JSON.stringify({
      ...automation,
      vars: { ...automation.vars, SEND_MODE: 'live' },
    }),
  );
}
it('AI off still serves manual live credentials and rejects mismatched DO send modes', async () => {
  await liveConfig();
  const args = [
    '--config',
    'wrangler.live.jsonc',
    '--mode',
    'live',
    '--automation-config',
    'wrangler.automation.manual.jsonc',
  ];
  expect(JSON.parse(await check(args))).toMatchObject({
    result: 'passed',
    automation: {
      aiFreeAccount: '미확인·호출 중지',
    },
  });
  const path = join(directory, 'wrangler.automation.manual.jsonc');
  const automation = parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({ ...automation, vars: { ...automation.vars, SEND_MODE: 'dry_run' } }),
  );
  await expect(check(args)).rejects.toThrow('SEND_MODE');
});
it('M5 기본 dry_run 검사는 배포·발송 없이 설정 경로와 해시를 반환한다', async () => {
  const result = JSON.parse(await check([])) as {
    checkedMode: string;
    configPath: string;
    configSha256: string;
    deploymentPerformed: boolean;
  };
  expect(result).toMatchObject({
    checkedMode: 'dry_run',
    configPath: join(directory, 'wrangler.jsonc'),
    deploymentPerformed: false,
  });
  expect(result.configSha256).toMatch(/^[0-9a-f]{64}$/);
});
it('M1 서비스 속성 순서를 허용하면서 다른 서비스·추가 필드는 거부한다', async () => {
  const path = join(directory, 'wrangler.jsonc');
  config.services = [{ service: 'en-card-delivery', binding: 'DELIVERY_SERVICE' }];
  await writeFile(path, JSON.stringify(config));
  expect(JSON.parse(await check([]))).toMatchObject({ result: 'passed' });
  for (const services of [
    [{ service: 'other-worker', binding: 'DELIVERY_SERVICE' }],
    [{ service: 'en-card-delivery', binding: 'DELIVERY_SERVICE', extra: 'not-allowed' }],
  ]) {
    await writeFile(path, JSON.stringify({ ...config, services }));
    await expect(check([])).rejects.toThrow('허용되지 않은 발송 서비스');
  }
});
it('M5 명시적 live 파일과 일치하는 모드에 같은 검사를 적용한다', async () => {
  await liveConfig();
  expect(JSON.parse(await check(liveArgs))).toMatchObject({
    checkedMode: 'live',
    deploymentPerformed: false,
  });
  await expect(check(['--config', 'wrangler.live.jsonc'])).rejects.toThrow('SEND_MODE');
  await expect(check(['--mode', 'live'])).rejects.toThrow('--config');
  await expect(check(['--config', 'wrangler.jsonc', '--mode', 'live'])).rejects.toThrow('--config');
});
it('별도 배포 설정은 AI 비활성 상태에도 실제 인증 DO 설정을 명시해야 한다', async () => {
  await liveConfig();
  await expect(check(['--config', 'wrangler.live.jsonc', '--mode', 'live'])).rejects.toThrow(
    '--automation-config',
  );
  await writeFile(join(directory, 'wrangler.deploy.jsonc'), JSON.stringify(config));
  await expect(check(['--config', 'wrangler.deploy.jsonc'])).rejects.toThrow('--automation-config');
  const path = join(directory, 'wrangler.automation.manual.jsonc');
  const automation = parse(await readFile(path, 'utf8'));
  automation.d1_databases[0].database_id = crypto.randomUUID();
  await writeFile(path, JSON.stringify(automation));
  await expect(check(liveArgs)).rejects.toThrow();
});
it.each(['r2_buckets', 'services', 'browser', 'ai', 'usage_model'])(
  'M5 live에서도 %s 추가를 거부한다',
  async (binding) => {
    config[binding] = binding === 'usage_model' ? 'unbound' : [{ binding: 'PAID' }];
    await liveConfig();
    await expect(check(liveArgs)).rejects.toThrow('허용되지 않은');
  },
);
it.each(['workers_dev', 'preview_urls'])(
  '비공개 발송 Worker의 %s 공개 노출을 거부한다',
  async (field) => {
    const path = join(directory, 'wrangler.delivery.jsonc');
    const delivery = parse(await readFile(path, 'utf8'));
    delivery[field] = true;
    await writeFile(path, JSON.stringify(delivery));
    await expect(check([])).rejects.toThrow('공개 접근');
  },
);
it('비공개 발송 Worker에 다른 DB·유료 바인딩·Cron을 추가할 수 없다', async () => {
  const path = join(directory, 'wrangler.delivery.jsonc');
  const delivery = parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...delivery, triggers: { crons: ['* * * * *'] } }));
  await expect(check([])).rejects.toThrow('허용되지 않은');
  await writeFile(path, JSON.stringify({ ...delivery, r2_buckets: [{ binding: 'PAID' }] }));
  await expect(check([])).rejects.toThrow('허용되지 않은');
  delivery.d1_databases[0].database_id = crypto.randomUUID();
  await writeFile(path, JSON.stringify(delivery));
  await expect(check([])).rejects.toThrow('같은 D1');
});
it('M5 live도 모의 진입점·외부 서비스·변조한 기본값을 거부한다', async () => {
  config.main = 'src/worker/local.ts';
  await liveConfig();
  await expect(check(liveArgs)).rejects.toThrow();
  config.main = 'src/worker/index.ts';
  await liveConfig();
  await writeFile(join(directory, 'src/worker/index.ts'), "fetch('https://api.openai.com');");
  await expect(check(liveArgs)).rejects.toThrow('외부 서비스');
  await writeFile(
    join(directory, 'wrangler.jsonc'),
    JSON.stringify({ ...config, vars: { ...config.vars, SEND_MODE: 'live' } }),
  );
  await expect(check(liveArgs)).rejects.toThrow('기본 설정');
});
