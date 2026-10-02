import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Delivery } from '../src/shared/model';
import {
  deliverClaimed,
  prepareEngine,
  dryRun,
  runEngine,
  resolveUnknown,
} from '../src/worker/engine';
import { sendMock } from '../src/worker/mock';
import { stopSchedule } from '../src/worker/schedules';
import { dueSchedule, harness, NOW, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});
async function states(): Promise<Delivery[]> {
  return (await h.env.DB.prepare('SELECT * FROM deliveries ORDER BY position').all<Delivery>())
    .results;
}
describe('실제 로컬 D1의 발송 일관성', () => {
  it('분리 발송은 준비 후 세 장의 고정 내용·순서·예산을 보존한다', async () => {
    await dueSchedule(h.env, 3, NOW);
    const sent: string[] = [];
    const report = await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        throw new Error('Direct fallback forbidden');
      },
      prepare: () => prepareEngine(h.env, NOW, 'mock'),
      dispatch: (job) =>
        deliverClaimed(h.env, job, {
          mode: 'mock',
          clock: () => NOW,
          sender: async () => {
            sent.push(job.item.id);
            return { outcome: 'mock_sent', detail: 'mock' };
          },
        }),
    });
    expect(report.processed).toBe(3);
    expect(sent).toEqual((await states()).map((row) => row.id));
    expect((await states()).map((row) => row.state)).toEqual(Array(3).fill('mock_sent'));
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      3,
    );
  });
  it('분리 발송의 같은 claim 중복 호출은 첫 sending을 되돌리거나 중복 전송하지 않는다', async () => {
    await dueSchedule(h.env, 1, NOW);
    let calls = 0;
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        throw new Error('Direct fallback forbidden');
      },
      dispatch: async (job) => {
        let release!: () => void, started!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const entering = new Promise<void>((resolve) => {
          started = resolve;
        });
        const runtime = {
          mode: 'mock' as const,
          clock: () => NOW,
          sender: async () => {
            calls += 1;
            started();
            await gate;
            return { outcome: 'mock_sent' as const, detail: 'mock' };
          },
        };
        const first = deliverClaimed(h.env, job, runtime);
        await entering;
        const duplicate = await deliverClaimed(h.env, job, runtime);
        expect(duplicate.processed).toBe(0);
        expect((await states())[0]?.state).toBe('sending');
        release();
        return first;
      },
    });
    expect(calls).toBe(1);
    expect((await states())[0]?.state).toBe('mock_sent');
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      1,
    );
  });
  it('분리 발송 성공 저장 후 내부 응답이 유실돼도 다음 Cron에서 재전송하지 않는다', async () => {
    await dueSchedule(h.env, 1, NOW);
    let calls = 0;
    const sender = async () => {
      calls += 1;
      return { outcome: 'mock_sent' as const, detail: 'mock' };
    };
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender,
      dispatch: async (job) => {
        await deliverClaimed(h.env, job, { mode: 'mock', clock: () => NOW, sender });
        throw new Error('Response lost');
      },
    });
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + 61_000,
      token: async () => 'mock',
      sender,
    });
    expect(calls).toBe(1);
    expect((await states())[0]?.state).toBe('mock_sent');
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      1,
    );
  });
  it('분리 준비 실패는 회차·목록·예산을 소비하지 않고 직접 준비로 우회하지 않는다', async () => {
    await dueSchedule(h.env, 1, NOW);
    await expect(
      runEngine(h.env, {
        mode: 'mock',
        clock: () => NOW,
        token: async () => 'mock',
        sender: sendMock,
        prepare: async () => {
          throw new Error('Preparation unavailable');
        },
      }),
    ).rejects.toThrow('Preparation unavailable');
    expect(await h.env.DB.prepare('SELECT count(*) FROM occurrences').first('count(*)')).toBe(0);
    expect(await h.env.DB.prepare('SELECT cursor FROM schedules').first('cursor')).toBe(0);
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      0,
    );
  });
  it('분리 발송 Worker도 손상된 피드를 검증하고 외부 호출·예산 없이 실패 처리한다', async () => {
    await dueSchedule(h.env, 1, NOW);
    await h.env.DB.prepare("UPDATE schedule_items SET payload='{}'").run();
    let calls = 0;
    const sender = async () => {
      calls += 1;
      return { outcome: 'mock_sent' as const, detail: 'mock' };
    };
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender,
      dispatch: (job) => deliverClaimed(h.env, job, { mode: 'mock', clock: () => NOW, sender }),
    });
    expect(calls).toBe(0);
    expect((await states())[0]?.state).toBe('failed');
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      0,
    );
  });
  it('내부 발송 호출이 시작 전에 실패하면 직접 우회 발송하지 않고 claim 만료 후 복구한다', async () => {
    await dueSchedule(h.env, 1, NOW);
    let calls = 0;
    const runtime = {
      mode: 'mock' as const,
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        calls += 1;
        return { outcome: 'mock_sent' as const, detail: 'mock' };
      },
      dispatch: async () => {
        throw new Error('RPC response unavailable');
      },
    };
    const report = await runEngine(h.env, runtime);
    expect(report.processed).toBe(0);
    expect(calls).toBe(0);
    expect((await states())[0]?.state).toBe('claimed');
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      0,
    );
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + 61_000,
      token: async () => 'mock',
      sender: runtime.sender,
    });
    expect(calls).toBe(1);
    expect((await states())[0]?.state).toBe('mock_sent');
  });
  it('한 Cron의 토큰 재사용은 유효한 인증 조회·복호화를 한 번만 수행한다', async () => {
    await dueSchedule(h.env, 3, NOW);
    await h.env.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'fixture',?,?,1,'connected')",
    )
      .bind(NOW + 3600_000, NOW + 86400_000)
      .run();
    let reads = 0;
    const report = await runEngine(h.env, {
      mode: 'live',
      clock: () => NOW,
      token: async () => {
        reads += 1;
        return { token: 'fixture', version: 1, expiresAt: NOW + 3600_000 };
      },
      sender: async () => ({ outcome: 'sent', detail: '격리된 모의 응답' }),
    });
    expect(report.processed).toBe(3);
    expect(reads).toBe(1);
    expect((await states()).map((row) => row.state)).toEqual(Array(3).fill('sent'));
  });
  it('한 Cron의 토큰 재사용 중 재연결되면 옛 토큰의 추가 호출·예산을 막는다', async () => {
    await dueSchedule(h.env, 3, NOW);
    await h.env.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'fixture',?,?,1,'connected')",
    )
      .bind(NOW + 3600_000, NOW + 86400_000)
      .run();
    let reads = 0,
      calls = 0;
    const token = async () => {
      reads += 1;
      const version = await h.env.DB.prepare('SELECT version FROM credentials').first<number>(
        'version',
      );
      return { token: version === 1 ? 'old' : 'new', version: version!, expiresAt: NOW + 3600_000 };
    };
    const sender = async (_payload: unknown, usedToken: string) => {
      calls += 1;
      if (calls === 1) {
        expect(usedToken).toBe('old');
        await h.env.DB.prepare('UPDATE credentials SET version=2').run();
      } else expect(usedToken).toBe('new');
      return { outcome: 'sent' as const, detail: '격리된 모의 응답' };
    };
    await runEngine(h.env, { mode: 'live', clock: () => NOW, token, sender });
    expect(calls).toBe(1);
    expect(reads).toBe(1);
    expect(await h.env.DB.prepare('SELECT count(*) FROM delivery_attempts').first('count(*)')).toBe(
      1,
    );
    expect((await states()).map((row) => row.state)).toEqual(['sent', 'retry_wait', 'pending']);
    await runEngine(h.env, { mode: 'live', clock: () => NOW + 60_000, token, sender });
    expect(calls).toBe(3);
    expect(reads).toBe(2);
  });
  it('한 Cron의 토큰 재사용은 만료 1분 전에 다시 인증을 조회한다', async () => {
    await dueSchedule(h.env, 3, NOW);
    await h.env.DB.prepare(
      "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'fixture',?,?,1,'connected')",
    )
      .bind(NOW + 3600_000, NOW + 86400_000)
      .run();
    let reads = 0,
      now = NOW;
    await runEngine(h.env, {
      mode: 'live',
      clock: () => now,
      token: async () => {
        reads += 1;
        return {
          token: 'fixture',
          version: 1,
          expiresAt: reads === 1 ? NOW + 60_001 : NOW + 3600_000,
        };
      },
      sender: async () => {
        now = NOW + 2000;
        return { outcome: 'sent', detail: '격리된 모의 응답' };
      },
    });
    expect(reads).toBe(2);
    expect((await states()).map((row) => row.state)).toEqual(Array(3).fill('sent'));
  });
  it('동시 Cron도 회차·카드를 한 번만 소비한다', async () => {
    const id = await dueSchedule(h.env, 3, NOW);
    let calls: number = 0;
    const runtime = {
      mode: 'mock' as const,
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        calls += 1;
        return { outcome: 'mock_sent' as const, detail: 'mock' };
      },
    };
    await Promise.all([runEngine(h.env, runtime), runEngine(h.env, runtime)]);
    expect(calls).toBe(3);
    expect((await states()).map((item) => item.state)).toEqual([
      'mock_sent',
      'mock_sent',
      'mock_sent',
    ]);
    expect(
      await h.env.DB.prepare('SELECT cursor FROM schedules WHERE id=?').bind(id).first('cursor'),
    ).toBe(3);
    await runEngine(h.env, runtime);
    expect(calls).toBe(3);
  });
  it('부분 성공 뒤 unknown이면 나머지를 기다리고 성공 카드를 재전송하지 않는다', async () => {
    await dueSchedule(h.env, 3, NOW);
    let calls: number = 0;
    const runtime = {
      mode: 'mock' as const,
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        calls += 1;
        return {
          outcome: calls === 1 ? ('mock_sent' as const) : ('unknown' as const),
          detail: 'test',
        };
      },
    };
    await runEngine(h.env, runtime);
    await runEngine(h.env, runtime);
    expect(calls).toBe(2);
    expect((await states()).map((item) => item.state)).toEqual(['mock_sent', 'unknown', 'pending']);
  });
  it('dry_run은 회차·발송 예산·커서를 소비하지 않는다', async () => {
    const id = await dueSchedule(h.env, 1, NOW);
    await h.env.DB.prepare('UPDATE schedules SET next_run_at_utc=? WHERE id=?')
      .bind(NOW + 300_000, id)
      .run();
    await dryRun(h.env, NOW);
    await dryRun(h.env, NOW);
    expect(await states()).toHaveLength(0);
    expect(
      await h.env.DB.prepare('SELECT cursor FROM schedules WHERE id=?').bind(id).first('cursor'),
    ).toBe(0);
    expect(await h.env.DB.prepare('SELECT count(*) AS n FROM dry_runs').first('n')).toBe(1);
  });
  it('인증 후 호출 직전 취소 경합을 차단한다', async () => {
    const id = await dueSchedule(h.env, 1, NOW);
    let calls: number = 0;
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => {
        await stopSchedule(id, 1, 'cancelled', h.env, NOW);
        return 'mock';
      },
      sender: async () => {
        calls += 1;
        return { outcome: 'mock_sent', detail: 'mock' };
      },
    });
    expect(calls).toBe(0);
    expect((await states())[0]?.state).toBe('cancelled');
  });
  it('15분 초과 회차를 missed로 남긴다', async () => {
    await dueSchedule(h.env, 1, NOW);
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + 16 * 60_000,
      token: async () => 'mock',
      sender: sendMock,
    });
    expect((await states())[0]?.state).toBe('missed');
  });
  it('분당 3건을 동시 실행 전체에 적용한다', async () => {
    await dueSchedule(h.env, 5, NOW);
    const runtime = {
      mode: 'mock' as const,
      clock: () => NOW,
      token: async () => 'mock',
      sender: sendMock,
    };
    await Promise.all([runEngine(h.env, runtime), runEngine(h.env, runtime)]);
    expect((await states()).filter((item) => item.state === 'mock_sent')).toHaveLength(3);
    await runEngine(h.env, { ...runtime, clock: () => NOW + 60_000 });
    expect((await states()).filter((item) => item.state === 'mock_sent')).toHaveLength(5);
  });
});

describe('장애·재시도 상한', () => {
  it('성공 응답 뒤 DB 기록 실패는 sending으로 보존하고 재시작 때 unknown 처리한다', async () => {
    await dueSchedule(h.env, 1, NOW);
    let calls: number = 0;
    const runtime = {
      mode: 'mock' as const,
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        calls += 1;
        await h.env.DB.exec(
          "CREATE TRIGGER reject_finalize BEFORE UPDATE OF state ON deliveries WHEN NEW.state='mock_sent' BEGIN SELECT RAISE(ABORT,'injected_db_failure'); END;",
        );
        return { outcome: 'mock_sent' as const, detail: '접수' };
      },
    };
    await expect(runEngine(h.env, runtime)).rejects.toThrow('injected_db_failure');
    expect((await states())[0]?.state).toBe('sending');
    await h.env.DB.exec('DROP TRIGGER reject_finalize;');
    await runEngine(h.env, { ...runtime, clock: () => NOW + 61_000 });
    expect(calls).toBe(1);
    expect((await states())[0]?.state).toBe('unknown');
  });
  it('sending 이전의 만료 claim만 회수한다', async () => {
    await dueSchedule(h.env, 1, NOW);
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => {
        throw Object.assign(new Error('busy'), { name: 'TOKEN_BUSY' });
      },
      sender: sendMock,
    });
    await h.env.DB.prepare(
      "UPDATE deliveries SET state='claimed',claim_owner='crashed',claim_until=?,retry_at=NULL",
    )
      .bind(NOW - 1)
      .run();
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender: sendMock,
    });
    expect((await states())[0]?.state).toBe('mock_sent');
  });
  it('확실한 거절만 최초 포함 3회 재시도한다', async () => {
    await dueSchedule(h.env, 1, NOW);
    let calls: number = 0;
    const sender = async () => {
      calls += 1;
      return { outcome: 'retry' as const, detail: 'HTTP 400 code=-10' };
    };
    for (const offset of [0, 60_000, 180_000, 360_000])
      await runEngine(h.env, {
        mode: 'mock',
        clock: () => NOW + offset,
        token: async () => 'mock',
        sender,
      });
    expect(calls).toBe(3);
    expect((await states())[0]?.state).toBe('failed');
  });
  it('401은 갱신 후 최대 한 번 다시 시도한다', async () => {
    await dueSchedule(h.env, 1, NOW);
    let calls: number = 0;
    const sender = async () => {
      calls += 1;
      return { outcome: 'unauthorized' as const, detail: 'HTTP 401 code=-401' };
    };
    for (const offset of [0, 60_000, 120_000])
      await runEngine(h.env, {
        mode: 'mock',
        clock: () => NOW + offset,
        token: async () => 'mock',
        sender,
      });
    expect(calls).toBe(2);
    expect((await states())[0]?.state).toBe('blocked');
  });
  it('일일 실제 시도 상한은 재시도에도 적용한다', async () => {
    await dueSchedule(h.env, 2, NOW);
    await h.env.DB.prepare("UPDATE usage_counters SET sends=19 WHERE day='2026-09-28'").run();
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender: sendMock,
    });
    expect((await states()).map((item) => item.state)).toEqual(['mock_sent', 'blocked']);
    expect(
      await h.env.DB.prepare("SELECT sends FROM usage_counters WHERE day='2026-09-28'").first(
        'sends',
      ),
    ).toBe(20);
  });
});

it('사용자 재시도는 원래 예정 시각과 이전 시도 기록을 보존한다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: 'response lost' }),
  });
  const item = (await states())[0]!;
  await resolveUnknown(item.id, 'retry', h.env, NOW + 3600_000);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW + 3600_000,
    token: async () => 'mock',
    sender: sendMock,
  });
  const result = (await states())[0]!;
  expect(result.state).toBe('mock_sent');
  expect(result.due_at_utc).toBe(NOW);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first('n')).toBe(2);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM manual_decisions').first('n')).toBe(1);
});

it('dry_run은 KST 설정과 UTC 저장 시각이 불일치하면 성공 기록을 남기지 않는다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await expect(dryRun(h.env, NOW)).rejects.toThrow('UTC 실행 시각');
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM dry_runs').first('n')).toBe(0);
});
