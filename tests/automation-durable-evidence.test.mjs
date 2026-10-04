import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarizeDurableTrial } from '../scripts/report-automation-durable.mjs';

const evidence = () =>
  JSON.parse(readFileSync('docs/evidence/AI_PNG_DURABLE_2026-10-03.json', 'utf8'));

describe('DO 원격 실측 증거 판정', () => {
  it('이미지 경로 80건과 전체 로그 89/90을 구별한다', () => {
    const report = evidence();
    const summary = summarizeDurableTrial(report);
    expect(summary).toEqual(report.summary);
    expect(summary.image_path_cpu_pass).toBe(true);
    expect(summary.all_trial_events_complete).toBe(false);
    expect(summary.missing).toEqual([
      { call: 'do-call-044', script: 'en-card-png-do-probe', expected_status: 409 },
    ]);
  });
  it.each([
    [
      'wrong deployment version',
      (r) => {
        r.invocations[0].version = 'wrong-version';
      },
    ],
    [
      'swapped first render flags',
      (r) => {
        r.responses[0].first_for_object = false;
        r.responses[1].first_for_object = true;
      },
    ],
    [
      'missing renderer CPU',
      (r) => {
        r.invocations = r.invocations.filter(
          (x) => !(x.call === 'do-call-003' && x.script === 'en-card-png-do-trial'),
        );
      },
    ],
    [
      'missing gateway CPU',
      (r) => {
        r.invocations = r.invocations.filter(
          (x) => !(x.call === 'do-call-003' && x.script === 'en-card-png-do-probe'),
        );
      },
    ],
    [
      'missing PNG read',
      (r) => {
        r.invocations = r.invocations.filter(
          (x) => !(x.call === 'do-call-004' && x.script === 'en-card-png-do-probe'),
        );
      },
    ],
    [
      'gateway CPU over limit',
      (r) => {
        r.invocations.find(
          (x) => x.call === 'do-call-003' && x.script === 'en-card-png-do-probe',
        ).cpu_ms = 11;
      },
    ],
    [
      'DO CPU over limit',
      (r) => {
        r.invocations.find(
          (x) => x.call === 'do-call-003' && x.script === 'en-card-png-do-trial',
        ).cpu_ms = 30001;
      },
    ],
    [
      'duplicate invocation',
      (r) => {
        r.invocations.push(r.invocations[0]);
      },
    ],
    [
      'failed response',
      (r) => {
        r.attempts.find((x) => x.call === 'do-call-003' && x.event === 'response').status = 503;
      },
    ],
    [
      'duplicate asset',
      (r) => {
        r.responses[1].asset.id = r.responses[0].asset.id;
      },
    ],
    [
      'empty evidence',
      (r) => {
        r.attempts = [];
        r.invocations = [];
        r.responses = [];
      },
    ],
  ])('%s 자료를 합격으로 처리하지 않는다', (_name, mutate) => {
    const report = evidence();
    mutate(report);
    expect(() => summarizeDurableTrial(report)).toThrow();
  });
});
