import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ScheduleInput } from '../src/shared/model';
import { kstDate } from '../src/shared/time';
import { accessToken, createSession, disconnect } from '../src/worker/auth';
import { encrypt } from '../src/worker/crypto';
import { assetPage, cardPage, deliveryPage } from '../src/worker/catalog';
import { resolveUnknown, runEngine } from '../src/worker/engine';
import production, { handle } from '../src/worker/index';
import { sendMock } from '../src/worker/mock';
import {
  listSchedules,
  resumeSchedule,
  saveSchedule,
  schedulePage,
  stopSchedule,
} from '../src/worker/schedules';
import { deleteImage, saveCard } from '../src/worker/storage';
import { dueSchedule, harness, NOW, readyCard, SAMPLE, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});

function afterFirst(db: D1Database, after: (sql: string) => Promise<void>): D1Database {
  function statement(source: D1PreparedStatement, sql: string): D1PreparedStatement {
    return new Proxy(source, {
      get(target, key) {
        if (key === 'bind') return (...values: unknown[]) => statement(target.bind(...values), sql);
        if (key === 'first')
          return async (column?: string) => {
            const result: unknown =
              column === undefined ? await target.first() : await target.first(column);
            await after(sql);
            return result;
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  return new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => statement(target.prepare(sql), sql);
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
async function daily(): Promise<ScheduleInput> {
  const assets = await Promise.all([
    readyCard(h.env, NOW - 300_000),
    readyCard(h.env, NOW - 300_000),
  ]);
  return {
    name: '전수 점검',
    kind: 'daily',
    date: '2026-09-28',
    time: '12:05',
    end_date: null,
    weekdays: [],
    cards_per_occurrence: 1,
    asset_ids: assets.map((asset) => asset.assetId),
  };
}
async function authenticated(path: string, method: string, body: unknown): Promise<Response> {
  const session = await createSession(h.env, Date.now());
  return handle(
    new Request(`${h.env.APP_ORIGIN}${path}`, {
      method,
      headers: {
        Cookie: `en_session=${session.token}`,
        Origin: h.env.APP_ORIGIN,
        'X-CSRF-Token': session.csrf,
        'Content-Type': 'application/json',
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    }),
    h.env,
  );
}

it('소비한 이미지 삭제 후에도 남은 카드로 반복 예약을 재개한다', async () => {
  const data = await daily();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW + 300_000,
    token: async () => 'mock',
    sender: sendMock,
  });
  await stopSchedule(id, 1, 'paused', h.env, NOW + 360_000);
  await deleteImage(data.asset_ids[0]!, h.env, NOW + 360_000);
  await resumeSchedule(id, 1, h.env, NOW + 360_000);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW + 86_700_000,
    token: async () => 'mock',
    sender: sendMock,
  });
  expect(
    await h.env.DB.prepare("SELECT count(*) AS n FROM deliveries WHERE state='mock_sent'").first(
      'n',
    ),
  ).toBe(2);
});

it('재개와 수정이 겹쳐도 실패한 재개가 새 목록에 카드를 끼워 넣지 않는다', async () => {
  const data = await daily();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await stopSchedule(id, 1, 'paused', h.env, NOW);
  const db = afterFirst(h.env.DB, async (sql) => {
    if (sql.includes('AS unresolved FROM schedules WHERE id=? AND version=?'))
      await saveSchedule(
        { ...data, asset_ids: [data.asset_ids[0]!] },
        id,
        { version: 1, cursor: 0 },
        h.env,
        NOW,
      );
  });
  await expect(resumeSchedule(id, 1, { ...h.env, DB: db }, NOW)).rejects.toThrow();
  expect((await listSchedules(h.env))[0]?.asset_ids).toEqual([data.asset_ids[0]]);
});

it('원문 편집 후 시간만 수정해도 기존에 고정한 예약 이미지를 유지한다', async () => {
  const data = await daily();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  const card = await h.env.DB.prepare('SELECT card_id FROM assets WHERE id=?')
    .bind(data.asset_ids[0])
    .first<{ card_id: string }>();
  await saveCard({ ...SAMPLE, expression: 'Edited draft' }, card!.card_id, 1, h.env, NOW);
  await saveSchedule({ ...data, time: '12:10' }, id, { version: 1, cursor: 0 }, h.env, NOW);
  expect((await listSchedules(h.env))[0]?.asset_ids).toEqual(data.asset_ids);
});

it('발송 예산 확보 뒤 연결 해제가 완료되면 외부 API를 호출하지 않는다', async () => {
  await dueSchedule(h.env, 1, NOW);
  let calls: number = 0;
  const db = afterFirst(h.env.DB, async (sql) => {
    if (sql.startsWith('INSERT INTO delivery_attempts')) await disconnect(h.env, NOW);
  });
  await runEngine(
    { ...h.env, DB: db },
    {
      mode: 'mock',
      clock: () => NOW,
      token: async () => 'mock',
      sender: async () => {
        calls += 1;
        return { outcome: 'mock_sent', detail: 'mock' };
      },
    },
  );
  expect(calls).toBe(0);
  expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('cancelled');
});

it('41개 이상 백업을 같은 가져오기 경로로 복원할 수 있다', async () => {
  for (let i: number = 0; i < 41; i += 1)
    await saveCard({ ...SAMPLE, expression: `Card ${i}` }, null, null, h.env, NOW);
  const backup = await authenticated('/api/export', 'GET', null);
  const imported = await authenticated('/api/import', 'POST', await backup.json());
  expect(imported.status).toBe(201);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM cards').first('n')).toBe(82);
});

it('잘못된 날짜는 서버 장애 대신 입력 오류로 안내한다', async () => {
  const data = await daily();
  const response = await authenticated('/api/schedules', 'POST', { ...data, date: '2027-02-29' });
  expect(response.status).toBe(400);
  expect((await response.json()) as unknown).toMatchObject({ error: 'VALIDATION' });
});

it('과거 인증의 거절 응답은 새로 연결한 인증과 예약을 중단시키지 않는다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,1,'connected')",
  )
    .bind(NOW + 3600_000, NOW + 86400_000)
    .run();
  await runEngine(h.env, {
    mode: 'live',
    clock: () => NOW,
    token: async () => ({ token: 'old', version: 1 }),
    sender: async () => {
      await h.env.DB.prepare("UPDATE credentials SET version=2,status='connected'").run();
      return { outcome: 'reconnect', detail: '이전 토큰의 권한 오류' };
    },
  });
  expect(await h.env.DB.prepare('SELECT status FROM credentials').first('status')).toBe(
    'connected',
  );
  expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('retry_wait');
  let calls: number = 0;
  await runEngine(h.env, {
    mode: 'live',
    clock: () => NOW + 60_000,
    token: async () => ({ token: 'new', version: 2 }),
    sender: async (_payload, token) => {
      expect(token).toBe('new');
      calls += 1;
      return { outcome: 'sent', detail: '모의 HTTP 응답' };
    },
  });
  expect(calls).toBe(1);
});

it('오래된 토큰으로 시작한 401은 새 토큰을 만료 처리하지 않는다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,1,'connected')",
  )
    .bind(NOW + 3600_000, NOW + 86400_000)
    .run();
  await runEngine(h.env, {
    mode: 'live',
    clock: () => NOW,
    token: async () => ({ token: 'old', version: 1 }),
    sender: async () => {
      await h.env.DB.prepare('UPDATE credentials SET version=2').run();
      return { outcome: 'unauthorized', detail: '401' };
    },
  });
  expect(await h.env.DB.prepare('SELECT expires_at FROM credentials').first('expires_at')).toBe(
    NOW + 3600_000,
  );
});

it('잘못된 피드는 실제 호출·시도 예산을 쓰기 전에 실패로 기록한다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await h.env.DB.prepare("UPDATE schedule_items SET payload='{}'").run();
  let calls: number = 0;
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => {
      calls += 1;
      return { outcome: 'mock_sent', detail: 'mock' };
    },
  });
  expect(calls).toBe(0);
  expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe('failed');
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM delivery_attempts').first('n')).toBe(0);
});

it('같은 생성 시각의 205개 카드도 목록과 JSON 백업에서 누락 없이 순회한다', async () => {
  const cards = Array.from({ length: 205 }, (_, index) => ({
    id: crypto.randomUUID(),
    content: { ...SAMPLE, expression: `Card ${index}` },
  }));
  await h.env.DB.prepare(
    "INSERT INTO cards(id,revision,content,status,created_at) SELECT json_extract(value,'$.id'),1,json_extract(value,'$.content'),'draft',? FROM json_each(?)",
  )
    .bind(NOW, JSON.stringify(cards))
    .run();
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = await cardPage(h.env, cursor);
    ids.push(...page.items.map((card) => card.id));
    cursor = page.next;
  } while (cursor);
  expect(new Set(ids).size).toBe(205);
  expect(ids).toHaveLength(205);
  let restored: number = 0;
  do {
    const response = await authenticated(
      `/api/export${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      null,
    );
    const page = (await response.json()) as { cards: unknown[]; next_cursor: string | null };
    expect(page.cards.length).toBeLessThanOrEqual(100);
    const imported = await authenticated('/api/import', 'POST', page);
    expect(imported.status).toBe(201);
    restored += page.cards.length;
    cursor = page.next_cursor;
  } while (cursor);
  expect(restored).toBe(205);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM cards').first('n')).toBe(410);
});

it('빈 백업과 100개 가져오기를 지원하고 파일 중 한 카드가 잘못되면 모두 거부한다', async () => {
  const empty = await authenticated('/api/export', 'GET', null);
  expect((await authenticated('/api/import', 'POST', await empty.json())).status).toBe(201);
  const cards = Array.from({ length: 100 }, (_, index) => ({
    ...SAMPLE,
    expression: `Import ${index}`,
  }));
  expect(
    (
      await authenticated('/api/import', 'POST', {
        schema_version: 1,
        cards: [...cards.slice(0, 99), {}],
      })
    ).status,
  ).toBe(400);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM cards').first('n')).toBe(0);
  expect((await authenticated('/api/import', 'POST', { schema_version: 1, cards })).status).toBe(
    201,
  );
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM cards').first('n')).toBe(100);
});

it('오래된 발송도 상세 호출 기록과 사용자의 결과 확인 기록을 조회한다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: '응답 유실' }),
  });
  const row = await h.env.DB.prepare('SELECT id FROM deliveries').first<{ id: string }>();
  const resolved = await authenticated(`/api/deliveries/${row!.id}/resolve`, 'POST', {
    action: 'confirm_sent',
    warning_accepted: true,
  });
  expect(resolved.status).toBe(200);
  const response = await authenticated(`/api/deliveries/${row!.id}/attempts`, 'GET', null);
  const history = (await response.json()) as {
    attempts: { outcome: string }[];
    decisions: { action: string }[];
  };
  expect(history.attempts.map((attempt) => attempt.outcome)).toEqual(['unknown']);
  expect(history.decisions.map((decision) => decision.action)).toEqual(['confirm_sent']);
  const state = (await (await authenticated('/api/state', 'GET', null)).json()) as {
    deliveries: { confirmed_by_user: number; total_attempts: number }[];
  };
  expect(state.deliveries[0]?.confirmed_by_user).toBe(1);
  expect(state.deliveries[0]?.total_attempts).toBe(1);
});

it('연결 권한이 철회되면 미래 예약도 카드 소비 전에 중단한다', async () => {
  await dueSchedule(h.env, 1, NOW);
  const future = await saveSchedule(
    { ...(await daily()), date: '2026-09-29' },
    null,
    null,
    h.env,
    NOW,
  );
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,1,'connected')",
  )
    .bind(NOW + 3600_000, NOW + 86400_000)
    .run();
  await runEngine(h.env, {
    mode: 'live',
    clock: () => NOW,
    token: async () => ({ token: 'old', version: 1 }),
    sender: async () => ({ outcome: 'reconnect', detail: '권한 철회' }),
  });
  const row = await h.env.DB.prepare('SELECT enabled,cursor,reason FROM schedules WHERE id=?')
    .bind(future.id)
    .first();
  expect(row).toMatchObject({ enabled: 0, cursor: 0, reason: 'needs_reconnect' });
});

it('실제 인증 함수와 2회차·3장 발송 경로가 D1 Free의 호출당 50쿼리 안에 든다', async () => {
  await dueSchedule(h.env, 3, NOW);
  await dueSchedule(h.env, 3, NOW);
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status) VALUES(1,'42',?,?,0,?,1,'connected')",
  )
    .bind(
      await encrypt('old', h.env.TOKEN_ENCRYPTION_KEY),
      await encrypt('refresh', h.env.TOKEN_ENCRYPTION_KEY),
      NOW + 86400_000,
    )
    .run();
  let statements: number = 0;
  const db = new Proxy(h.env.DB, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          statements += 1;
          if (statements > 50) throw new Error('D1 Free query limit');
          return target.prepare(sql);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const env = { ...h.env, DB: db };
  const result = await runEngine(env, {
    mode: 'live',
    clock: () => NOW,
    token: () =>
      accessToken(env, NOW, async () => Response.json({ access_token: 'new', expires_in: 3600 })),
    sender: async () => ({ outcome: 'sent', detail: '격리된 모의 HTTP 응답' }),
  });
  expect(result.processed).toBe(3);
  expect(statements).toBeLessThanOrEqual(50);
});

it('취소 예약은 수정으로 다시 활성화되지 않고 한 번 예약의 잉여 선택을 거부한다', async () => {
  const data = await daily();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await stopSchedule(id, 1, 'cancelled', h.env, NOW);
  await expect(saveSchedule(data, id, { version: 1, cursor: 0 }, h.env, NOW)).rejects.toThrow();
  await expect(saveSchedule({ ...data, kind: 'once' }, null, null, h.env, NOW)).rejects.toThrow(
    '한 번 예약',
  );
});

it('실패한 OAuth 응답에도 캐시와 referrer 차단 헤더가 있다', async () => {
  const response = await handle(
    new Request(`${h.env.APP_ORIGIN}/auth/callback?code=private`),
    h.env,
  );
  expect(response.status).toBe(400);
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).not.toContain('private');
});

it.each([
  [61_000, 'retry_wait'],
  [16 * 60_000, 'missed'],
] as const)(
  '인증 대기 %dms 뒤 만료된 claim을 발송하거나 유실하지 않는다',
  async (delay, expected) => {
    await dueSchedule(h.env, 1, NOW);
    let now: number = NOW;
    let calls: number = 0;
    const sender = async () => {
      calls += 1;
      return { outcome: 'mock_sent' as const, detail: 'mock' };
    };
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => now,
      token: async () => {
        now = NOW + delay;
        return 'mock';
      },
      sender,
    });
    expect(calls).toBe(0);
    expect(await h.env.DB.prepare('SELECT state FROM deliveries').first('state')).toBe(expected);
    await runEngine(h.env, {
      mode: 'mock',
      clock: () => NOW + delay + 60_000,
      token: async () => 'mock',
      sender,
    });
    expect(calls).toBe(expected === 'retry_wait' ? 1 : 0);
  },
);

it('아직 발송 회차가 없는 재연결 대기 예약도 연결 전에 재개할 수 없다', async () => {
  const data = await daily();
  const { id } = await saveSchedule(data, null, null, h.env, NOW);
  await h.env.DB.prepare("UPDATE schedules SET enabled=0,reason='needs_reconnect' WHERE id=?")
    .bind(id)
    .run();
  await expect(resumeSchedule(id, 1, h.env, NOW)).rejects.toThrow('먼저 카카오');
  expect(await h.env.DB.prepare('SELECT cursor FROM schedules').first('cursor')).toBe(0);
});

it('이미지·예약·발송 목록도 100개 이후 기록을 누락 없이 조회한다', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({
    id: crypto.randomUUID(),
    asset: crypto.randomUUID(),
    public_id: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
    occurrence: crypto.randomUUID(),
    delivery: crypto.randomUUID(),
    day: index < 100 ? '2026-09-28' : '2026-09-29',
  }));
  const data: string = JSON.stringify(rows);
  await h.env.DB.prepare(
    "INSERT INTO cards(id,revision,content,status,created_at) SELECT json_extract(value,'$.id'),1,?,'draft',? FROM json_each(?)",
  )
    .bind(JSON.stringify(SAMPLE), NOW, data)
    .run();
  await h.env.DB.prepare(
    "INSERT INTO assets(id,card_id,revision,snapshot,kv_key,public_id,bytes,state,created_at,usage_day) SELECT json_extract(value,'$.asset'),json_extract(value,'$.id'),1,?,json_extract(value,'$.asset'),json_extract(value,'$.public_id'),33,'ready',?,json_extract(value,'$.day') FROM json_each(?)",
  )
    .bind(JSON.stringify(SAMPLE), NOW, data)
    .run();
  await h.env.DB.prepare(
    "INSERT INTO schedules(id,name,kind,date,time,weekdays,cards_per_occurrence,timezone,version,enabled,reason) SELECT json_extract(value,'$.id'),'지난 예약','once','2026-09-28','12:00','[]',1,'Asia/Seoul',1,0,'cancelled' FROM json_each(?)",
  )
    .bind(data)
    .run();
  await h.env.DB.prepare(
    "INSERT INTO occurrences(id,schedule_id,schedule_version,due_at_utc,mode,created_at) SELECT json_extract(value,'$.occurrence'),json_extract(value,'$.id'),1,?,'mock',? FROM json_each(?)",
  )
    .bind(NOW, NOW, data)
    .run();
  await h.env.DB.prepare(
    "INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,updated_at) SELECT json_extract(value,'$.delivery'),json_extract(value,'$.occurrence'),json_extract(value,'$.id'),1,0,json_extract(value,'$.asset'),'{}','missed','mock',?,? FROM json_each(?)",
  )
    .bind(NOW, NOW, data)
    .run();
  for (const query of [assetPage, schedulePage, deliveryPage]) {
    const first = await query(h.env, null);
    const second = await query(h.env, first.next);
    expect(first.items).toHaveLength(100);
    expect(second.items).toHaveLength(5);
    expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(105);
  }
});

it('운영 진입점은 잘못된 구성을 거부하고 dry_run Cron은 운영 발송을 만들지 않는다', async () => {
  const request = new Request(`${h.env.APP_ORIGIN}/api/boot`);
  for (const env of [
    { ...h.env, COST_MODE: 'paid' },
    { ...h.env, APP_ORIGIN: 'http://localhost' },
    { ...h.env, SEND_MODE: 'mock' as const },
  ])
    await expect(production.fetch(request, env)).rejects.toThrow('운영 환경');
  const response = await production.fetch(request, h.env);
  expect(await response.json()).toMatchObject({ local: false, mode: 'dry_run' });
  const { id } = await saveSchedule(await daily(), null, null, h.env, NOW);
  await production.scheduled({} as ScheduledController, h.env);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM deliveries').first('n')).toBe(0);
  expect(
    await h.env.DB.prepare('SELECT cursor FROM schedules WHERE id=?').bind(id).first('cursor'),
  ).toBe(0);
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM dry_runs').first('n')).toBe(1);
});

it('취소 후 연결 해제와 늦은 인증 오류가 와도 취소 상태를 유지한다', async () => {
  const { env } = h;
  const id = await dueSchedule(env, 1, NOW);
  await runEngine(env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => {
      await stopSchedule(id, 1, 'cancelled', env, NOW);
      await disconnect(env, NOW);
      return { outcome: 'reconnect', detail: '늦은 인증 오류' };
    },
  });
  expect(
    await env.DB.prepare('SELECT reason FROM schedules WHERE id=?').bind(id).first('reason'),
  ).toBe('cancelled');
  await expect(resumeSchedule(id, 1, env, NOW)).rejects.toThrow('취소한 예약');
});

it('결과 불명 수동 처리의 패자는 이미 완료된 선택을 성공으로 보고하지 않는다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: '응답 유실' }),
  });
  const id = await h.env.DB.prepare('SELECT id FROM deliveries').first<string>('id');
  const db = afterFirst(h.env.DB, async (sql) => {
    if (sql === "SELECT * FROM deliveries WHERE id=? AND state='unknown' AND resolution IS NULL")
      await resolveUnknown(id!, 'confirm_sent', h.env, NOW);
  });
  await expect(resolveUnknown(id!, 'retry', { ...h.env, DB: db }, NOW)).rejects.toThrow(
    '상태가 변경',
  );
  expect(await h.env.DB.prepare('SELECT count(*) AS n FROM manual_decisions').first('n')).toBe(1);
  expect(
    await h.env.DB.prepare('SELECT confirmed_by_user FROM deliveries').first('confirmed_by_user'),
  ).toBe(1);
});

it('예약 수정 API는 편집 당시 소비 위치가 없거나 오래되면 거부한다', async () => {
  const data = { ...(await daily()), date: kstDate(Date.now() + 86_400_000) };
  const { id } = await saveSchedule(data, null, null, h.env, Date.now());
  expect(
    (await authenticated(`/api/schedules/${id}`, 'PUT', { version: 1, schedule: data })).status,
  ).toBe(400);
  await h.env.DB.prepare('UPDATE schedules SET cursor=1 WHERE id=?').bind(id).run();
  expect(
    (
      await authenticated(`/api/schedules/${id}`, 'PUT', {
        version: 1,
        expected_cursor: 0,
        schedule: data,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await authenticated(`/api/schedules/${id}`, 'PUT', {
        version: 1,
        expected_cursor: 1,
        schedule: { ...data, asset_ids: data.asset_ids.slice(1) },
      })
    ).status,
  ).toBe(200);
});

it('R1 종료 API는 경고 동의와 CSRF를 요구하고 원래 결과·감사 기록을 노출한다', async () => {
  await dueSchedule(h.env, 1, NOW);
  await runEngine(h.env, {
    mode: 'mock',
    clock: () => NOW,
    token: async () => 'mock',
    sender: async () => ({ outcome: 'unknown', detail: '원래 결과 불명' }),
  });
  const id: string = (await h.env.DB.prepare('SELECT id FROM deliveries').first<string>('id'))!;
  const path: string = `/api/deliveries/${id}/resolve`;
  expect(
    (await handle(new Request(`${h.env.APP_ORIGIN}${path}`, { method: 'POST' }), h.env)).status,
  ).toBe(401);
  expect(
    (await authenticated(path, 'POST', { action: 'abandon', warning_accepted: false })).status,
  ).toBe(400);
  expect(
    (await authenticated(path, 'POST', { action: 'abandon', warning_accepted: true })).status,
  ).toBe(200);
  expect(
    (await authenticated(path, 'POST', { action: 'abandon', warning_accepted: true })).status,
  ).toBe(409);
  const history = (await (
    await authenticated(`/api/deliveries/${id}/attempts`, 'GET', null)
  ).json()) as { attempts: { outcome: string }[]; decisions: { action: string }[] };
  expect(history.attempts.map((attempt) => attempt.outcome)).toEqual(['unknown']);
  expect(history.decisions.map((decision) => decision.action)).toEqual(['abandon']);
});
it('R2 갱신 재시작 API는 로그인·CSRF·현재 인증 버전을 검증한다', async () => {
  await h.env.DB.prepare(
    "INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status,refresh_attempts,refresh_failure) VALUES(1,'42',0,?,1,'connected',3,'exhausted')",
  )
    .bind(NOW + 86400_000)
    .run();
  expect(
    (
      await handle(
        new Request(`${h.env.APP_ORIGIN}/api/connection/retry`, { method: 'POST' }),
        h.env,
      )
    ).status,
  ).toBe(401);
  const session = await createSession(h.env, Date.now());
  expect(
    (
      await handle(
        new Request(`${h.env.APP_ORIGIN}/api/connection/retry`, {
          method: 'POST',
          headers: { Cookie: `en_session=${session.token}`, Origin: h.env.APP_ORIGIN },
          body: JSON.stringify({ version: 1 }),
        }),
        h.env,
      )
    ).status,
  ).toBe(403);
  expect((await authenticated('/api/connection/retry', 'POST', { version: 2 })).status).toBe(409);
  expect((await authenticated('/api/connection/retry', 'POST', { version: 1 })).status).toBe(200);
  expect((await authenticated('/api/connection/retry', 'POST', { version: 1 })).status).toBe(409);
  expect(
    await h.env.DB.prepare(
      'SELECT status,version,refresh_attempts,refresh_failure FROM credentials',
    ).first(),
  ).toEqual({ status: 'connected', version: 2, refresh_attempts: 0, refresh_failure: null });
});
