import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TestInfo } from '@playwright/test';

const execute = promisify(execFile);
export async function seed(sql: string, info: TestInfo): Promise<void> {
  const path: unknown = info.config.metadata.persistencePath;
  if (typeof path !== 'string' || !/^\.wrangler\/e2e-\d+$/.test(path))
    throw new Error('격리된 E2E DB 경로가 없습니다.');
  const directory: string = await mkdtemp(join(tmpdir(), 'en-card-recovery-'));
  try {
    const file: string = join(directory, 'fixture.sql');
    await writeFile(file, sql);
    await execute(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'd1',
        'execute',
        'DB',
        '--local',
        '--config',
        'wrangler.local.jsonc',
        '--persist-to',
        path,
        '--file',
        file,
      ],
      { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 30_000 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
