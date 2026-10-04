import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'jsonc-parser';
import { validateDurableTrialConfigs } from '../scripts/check-automation-durable-free.mjs';

const rendererPath = resolve('experiments/automation-png/wrangler.durable.jsonc');
const probePath = resolve('experiments/automation-png/wrangler.durable-probe.jsonc');
const configs = () => [rendererPath, probePath].map((path) => parse(readFileSync(path, 'utf8')));
const check = (renderer, probe) =>
  validateDurableTrialConfigs(renderer, probe, rendererPath, probePath);

describe('격리한 무료 DO 시험 구성의 경계', () => {
  it('SQLite와 격리 자원만 허용하며 계정 요금 확인을 별도로 요구한다', () => {
    expect(check(...configs())).toMatchObject({
      freeConfiguration: true,
      billingGuarantee: false,
      accountPlanMustBeVerifiedSeparately: true,
      maxRenderAttempts: 40,
    });
  });
  it.each([
    [
      'legacy DO storage',
      (r) => {
        r.migrations[0] = { tag: 'v1', new_classes: ['CardPngTrial'] };
      },
    ],
    [
      'public renderer',
      (r) => {
        r.workers_dev = true;
      },
    ],
    [
      'production database name',
      (r) => {
        r.d1_databases[0].database_name = 'en-card';
      },
    ],
    [
      'external service',
      (r) => {
        r.services = [{ binding: 'SEND', service: 'en-card-delivery' }];
      },
    ],
    [
      'AI binding',
      (r) => {
        r.ai = { binding: 'AI' };
      },
    ],
    [
      'scheduled trigger',
      (r) => {
        r.triggers = { crons: ['* * * * *'] };
      },
    ],
    [
      'different destination class',
      (_r, p) => {
        p.durable_objects.bindings[0].script_name = 'en-card';
      },
    ],
    [
      'extra public variables',
      (_r, p) => {
        p.vars = { BENCH_TOKEN: 'not-a-secret' };
      },
    ],
  ])('%s 변경을 거부한다', (_name, mutate) => {
    const [renderer, probe] = configs();
    mutate(renderer, probe);
    expect(() => check(renderer, probe)).toThrow();
  });
});
