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
  for (const path of ['scripts', '.worker-build', 'src/worker', 'migrations'])
    await mkdir(join(directory, path), { recursive: true });
  for (const path of [
    'scripts/check-free.mjs',
    'package.json',
    'wrangler.jsonc',
    'wrangler.delivery.jsonc',
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
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function check(args: string[]): Promise<string> {
  return (await execute(process.execPath, ['scripts/check-free.mjs', ...args], { cwd: directory }))
    .stdout;
}
async function liveConfig(): Promise<void> {
  await writeFile(
    join(directory, 'wrangler.live.jsonc'),
    JSON.stringify({ ...config, vars: { ...config.vars, SEND_MODE: 'live' } }),
  );
}
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
it('M5 명시적 live 파일과 일치하는 모드에 같은 검사를 적용한다', async () => {
  await liveConfig();
  expect(
    JSON.parse(await check(['--config', 'wrangler.live.jsonc', '--mode', 'live'])),
  ).toMatchObject({ checkedMode: 'live', deploymentPerformed: false });
  await expect(check(['--config', 'wrangler.live.jsonc'])).rejects.toThrow('SEND_MODE');
  await expect(check(['--mode', 'live'])).rejects.toThrow('--config');
  await expect(check(['--config', 'wrangler.jsonc', '--mode', 'live'])).rejects.toThrow('--config');
});
it.each(['r2_buckets', 'services', 'browser', 'ai', 'usage_model'])(
  'M5 live에서도 %s 추가를 거부한다',
  async (binding) => {
    config[binding] = binding === 'usage_model' ? 'unbound' : [{ binding: 'PAID' }];
    await liveConfig();
    await expect(check(['--config', 'wrangler.live.jsonc', '--mode', 'live'])).rejects.toThrow(
      '허용되지 않은',
    );
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
  await expect(check(['--config', 'wrangler.live.jsonc', '--mode', 'live'])).rejects.toThrow();
  config.main = 'src/worker/index.ts';
  await liveConfig();
  await writeFile(join(directory, 'src/worker/index.ts'), "fetch('https://api.openai.com');");
  await expect(check(['--config', 'wrangler.live.jsonc', '--mode', 'live'])).rejects.toThrow(
    '외부 서비스',
  );
  await writeFile(
    join(directory, 'wrangler.jsonc'),
    JSON.stringify({ ...config, vars: { ...config.vars, SEND_MODE: 'live' } }),
  );
  await expect(check(['--config', 'wrangler.live.jsonc', '--mode', 'live'])).rejects.toThrow(
    '기본 설정',
  );
});
