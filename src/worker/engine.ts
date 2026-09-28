import {
  LIMITS,
  type Delivery,
  type FeedPayload,
  type Schedule,
  type SendResult,
} from '../shared/model';
import { kstDate, nextRun } from '../shared/time';
import { markReconnect } from './auth';
import { validatePayload } from './kakao';
import { decodeSchedule } from './schedules';
import { appError, type Env, type Sender } from './types';

type Runtime = {
  mode: 'live' | 'mock';
  sender: Sender;
  token: () => Promise<string>;
  clock: () => number;
};
type ScheduleRow = Omit<Schedule, 'weekdays' | 'asset_ids'> & { weekdays: string };
type EngineReport = { mode: 'live' | 'mock' | 'dry_run'; processed: number; detail: string };
export async function dryRun(env: Env, now: number): Promise<EngineReport> {
  const schedules = await env.DB.prepare(
    'SELECT * FROM schedules WHERE enabled=1 ORDER BY next_run_at_utc LIMIT 10',
  ).all<ScheduleRow>();
  for (const row of schedules.results) {
    const items = await env.DB.prepare(
      'SELECT payload FROM schedule_items WHERE schedule_id=? AND version=? AND position>=? ORDER BY position LIMIT ?',
    )
      .bind(row.id, row.version, row.cursor, row.cards_per_occurrence)
      .all<{ payload: string }>();
    if (items.results.length !== row.cards_per_occurrence)
      throw appError(409, 'CONTENT_SHORTAGE', `예약 ${row.name}의 준비 카드가 부족합니다.`);
    if (
      row.next_run_at_utc === null ||
      nextRun(decodeSchedule(row), row.next_run_at_utc - 1) !== row.next_run_at_utc
    )
      throw appError(
        409,
        'SCHEDULE_TIME_MISMATCH',
        `예약 ${row.name}의 KST 설정과 UTC 실행 시각이 다릅니다. 예약을 수정하세요.`,
      );
    const payloads: FeedPayload[] = items.results.map((item) =>
      validatePayload(JSON.parse(item.payload) as unknown, env.APP_ORIGIN),
    );
    const detail: string = JSON.stringify({
      mode: 'dry_run',
      message: '시간·피드 형식 검사만 수행. 실제 발송 및 카드 소비 없음.',
      due_at_utc: row.next_run_at_utc,
      available: items.results.length,
      payloads,
    });
    await env.DB.prepare(
      'INSERT INTO dry_runs(id,schedule_id,due_at_utc,detail,created_at) VALUES(?,?,?,?,?) ON CONFLICT(schedule_id,due_at_utc) DO UPDATE SET detail=excluded.detail,created_at=excluded.created_at',
    )
      .bind(crypto.randomUUID(), row.id, row.next_run_at_utc, detail, now)
      .run();
  }
  return {
    mode: 'dry_run',
    processed: schedules.results.length,
    detail: '실제 API 호출·운영 회차 생성·목록 커서 소비 없이 검사했습니다.',
  };
}
async function materialize(env: Env, now: number, mode: 'live' | 'mock'): Promise<void> {
  const due = await env.DB.prepare(
    "SELECT * FROM schedules s WHERE enabled=1 AND next_run_at_utc<=? AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.schedule_id=s.id AND d.state='unknown') ORDER BY next_run_at_utc LIMIT 2",
  )
    .bind(now)
    .all<ScheduleRow>();
  for (const row of due.results) {
    if (row.next_run_at_utc === null) continue;
    const occurrence: string = crypto.randomUUID();
    const count = await env.DB.prepare(
      'SELECT count(*) AS count FROM schedule_items WHERE schedule_id=? AND version=? AND position>=?',
    )
      .bind(row.id, row.version, row.cursor)
      .first<{ count: number }>();
    if (!count || count.count < row.cards_per_occurrence) {
      await env.DB.prepare(
        "UPDATE schedules SET enabled=0,reason='content_shortage' WHERE id=? AND version=? AND cursor=?",
      )
        .bind(row.id, row.version, row.cursor)
        .run();
      continue;
    }
    const missed: boolean = now - row.next_run_at_utc > LIMITS.graceMs;
    const next: number | null = nextRun(decodeSchedule(row), Math.max(now, row.next_run_at_utc));
    const exhausted: boolean = count.count - row.cards_per_occurrence < row.cards_per_occurrence;
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO occurrences(id,schedule_id,schedule_version,due_at_utc,mode,created_at) SELECT ?,id,version,next_run_at_utc,?,? FROM schedules WHERE id=? AND enabled=1 AND version=? AND cursor=? AND next_run_at_utc=? ON CONFLICT(schedule_id,schedule_version,due_at_utc) DO NOTHING',
      ).bind(occurrence, mode, now, row.id, row.version, row.cursor, row.next_run_at_utc),
      env.DB.prepare(
        "INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,updated_at,error) SELECT ? || '-' || i.position,?,i.schedule_id,i.version,i.position,i.asset_id,i.payload,?,?,?, ?,? FROM schedule_items i WHERE i.schedule_id=? AND i.version=? AND i.position>=? AND i.position<? AND EXISTS(SELECT 1 FROM occurrences WHERE id=?)",
      ).bind(
        occurrence,
        occurrence,
        missed ? 'missed' : 'pending',
        mode,
        row.next_run_at_utc,
        now,
        missed ? '15분의 자동 발송 허용 시간이 지났습니다.' : null,
        row.id,
        row.version,
        row.cursor,
        row.cursor + row.cards_per_occurrence,
        occurrence,
      ),
      env.DB.prepare(
        'UPDATE schedules SET cursor=cursor+?,next_run_at_utc=?,enabled=?,reason=? WHERE id=? AND version=? AND cursor=? AND EXISTS(SELECT 1 FROM occurrences WHERE id=?)',
      ).bind(
        row.cards_per_occurrence,
        next,
        next && !exhausted ? 1 : 0,
        next ? (exhausted ? 'content_shortage' : null) : 'completed',
        row.id,
        row.version,
        row.cursor,
        occurrence,
      ),
    ]);
  }
}
async function recover(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE delivery_attempts SET outcome='unknown',detail='실행 중단 후 응답 확인 불가' WHERE outcome='sending' AND delivery_id IN (SELECT id FROM deliveries WHERE state='sending' AND claim_until<?)",
    ).bind(now),
    env.DB.prepare(
      "UPDATE deliveries SET state='unknown',error='발송 시작 후 실행이 중단되었습니다. 채팅방을 확인하세요.',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE state='sending' AND claim_until<?",
    ).bind(now, now),
    env.DB.prepare(
      "UPDATE deliveries SET state='pending',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE state='claimed' AND claim_until<?",
    ).bind(now, now),
    env.DB.prepare(
      "UPDATE deliveries SET state='missed',error='자동 발송 허용 시간 15분 경과',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE state IN ('pending','retry_wait') AND due_at_utc<? AND (manual_retry_until IS NULL OR manual_retry_until<?)",
    ).bind(now, now - LIMITS.graceMs, now),
  ]);
}
const eligibleSchedule: string =
  "EXISTS(SELECT 1 FROM schedules s WHERE s.id=deliveries.schedule_id AND s.version=deliveries.schedule_version AND (s.enabled=1 OR s.reason IN ('completed','content_shortage')))";
const ordered: string =
  "NOT EXISTS(SELECT 1 FROM deliveries earlier WHERE earlier.schedule_id=deliveries.schedule_id AND (earlier.state='unknown' OR (earlier.occurrence_id=deliveries.occurrence_id AND earlier.position<deliveries.position AND earlier.state IN ('pending','claimed','sending','retry_wait','blocked'))))";
async function claim(env: Env, now: number, owner: string): Promise<Delivery | null> {
  return env.DB.prepare(
    `UPDATE deliveries SET state='claimed',claim_owner=?,claim_until=?,updated_at=? WHERE id=(SELECT id FROM deliveries WHERE state IN ('pending','retry_wait') AND (retry_at IS NULL OR retry_at<=?) AND (due_at_utc>=? OR manual_retry_until>=?) AND ${eligibleSchedule} AND ${ordered} ORDER BY due_at_utc,position LIMIT 1) AND state IN ('pending','retry_wait') RETURNING *`,
  )
    .bind(owner, now + LIMITS.claimMs, now, now, now - LIMITS.graceMs, now)
    .first<Delivery>();
}
async function finish(
  env: Env,
  item: Delivery,
  owner: string,
  state: string,
  detail: string,
  retryAt: number | null,
  now: number,
  attempt: string | null,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE deliveries SET state=?,error=?,retry_at=?,claim_owner=NULL,claim_until=NULL,updated_at=? WHERE id=? AND claim_owner=? AND state IN ('claimed','sending')",
    ).bind(state, detail, retryAt, now, item.id, owner),
  ];
  if (attempt)
    statements.push(
      env.DB.prepare('UPDATE delivery_attempts SET outcome=?,detail=? WHERE id=?').bind(
        state,
        detail,
        attempt,
      ),
    );
  await env.DB.batch(statements);
}
export async function runEngine(env: Env, runtime: Runtime): Promise<EngineReport> {
  const now: number = runtime.clock();
  await recover(env, now);
  await materialize(env, now, runtime.mode);
  let processed: number = 0;
  for (let index: number = 0; index < LIMITS.sendsPerTick; index += 1) {
    const owner: string = crypto.randomUUID();
    const item: Delivery | null = await claim(env, runtime.clock(), owner);
    if (!item) break;
    let token: string;
    try {
      token = await runtime.token();
    } catch (error: unknown) {
      if (!(error instanceof Error) || (!('code' in error) && error.name !== 'TOKEN_BUSY'))
        throw error;
      const busy: boolean = error.name === 'TOKEN_BUSY';
      await finish(
        env,
        item,
        owner,
        busy ? 'retry_wait' : 'blocked',
        busy
          ? '토큰 갱신 중; 다음 실행에서 확인합니다.'
          : `${error.message} 카카오 연결을 확인한 뒤 예약을 재개하세요.`,
        busy ? runtime.clock() + 60_000 : null,
        runtime.clock(),
        null,
      );
      if (!busy)
        await env.DB.prepare(
          "UPDATE schedules SET enabled=0,reason='needs_reconnect' WHERE id=? AND version=?",
        )
          .bind(item.schedule_id, item.schedule_version)
          .run();
      continue;
    }
    const attempt: string = crypto.randomUUID();
    const callTime: number = runtime.clock();
    try {
      const budget = await env.DB.prepare(
        `INSERT INTO delivery_attempts(id,delivery_id,claim_owner,started_at,usage_day,outcome,mode) SELECT ?,id,?,?,?,'sending',? FROM deliveries WHERE id=? AND state='claimed' AND claim_owner=? AND claim_until>? AND (due_at_utc>=? OR manual_retry_until>=?) AND ${eligibleSchedule} AND ${ordered} RETURNING id`,
      )
        .bind(
          attempt,
          owner,
          callTime,
          kstDate(callTime),
          runtime.mode,
          item.id,
          owner,
          callTime,
          callTime - LIMITS.graceMs,
          callTime,
        )
        .first<{ id: string }>();
      if (!budget) {
        await finish(
          env,
          item,
          owner,
          'cancelled',
          '호출 전 예약·취소·유효 시간을 다시 확인하여 중단했습니다.',
          null,
          callTime,
          null,
        );
        continue;
      }
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      if (!message.includes('CHECK constraint failed')) throw error;
      const day = await env.DB.prepare('SELECT sends FROM usage_counters WHERE day=?')
        .bind(kstDate(callTime))
        .first<{ sends: number }>();
      const daily: boolean = (day?.sends ?? 0) >= LIMITS.attemptsPerDay;
      await finish(
        env,
        item,
        owner,
        daily ? 'blocked' : 'retry_wait',
        daily
          ? '하루 발송 시도 20회 한도입니다. 예약을 수정하거나 다음 날 재개하세요.'
          : '분당 3건 한도; 다음 실행에서 처리합니다.',
        daily ? null : callTime + 60_000,
        callTime,
        null,
      );
      if (daily)
        await env.DB.prepare(
          "UPDATE schedules SET enabled=0,reason='daily_limit' WHERE id=? AND version=?",
        )
          .bind(item.schedule_id, item.schedule_version)
          .run();
      break;
    }
    const stillValid = await env.DB.prepare(
      `SELECT id FROM deliveries WHERE id=? AND claim_owner=? AND state='sending' AND ${eligibleSchedule}`,
    )
      .bind(item.id, owner)
      .first<{ id: string }>();
    if (!stillValid) {
      await finish(
        env,
        item,
        owner,
        'cancelled',
        '발송 직전 취소됨 (예산 예약은 유지)',
        null,
        runtime.clock(),
        attempt,
      );
      continue;
    }
    let result: SendResult;
    try {
      result = await runtime.sender(JSON.parse(item.payload) as FeedPayload, token);
    } catch (error: unknown) {
      console.warn({
        event: 'sender_interrupted',
        delivery_id: item.id,
        error_type: error instanceof Error ? error.name : 'unknown',
      });
      result = {
        outcome: 'unknown',
        detail: '호출 후 결과를 확인하지 못했습니다. 채팅방을 확인하세요.',
      };
    }
    processed += 1;
    if (
      result.outcome === 'unauthorized' &&
      item.auth_retries === 0 &&
      item.attempts + 1 < LIMITS.automaticAttempts
    ) {
      await env.DB.batch([
        env.DB.prepare('UPDATE credentials SET expires_at=0 WHERE singleton=1'),
        env.DB.prepare('UPDATE deliveries SET auth_retries=1 WHERE id=? AND claim_owner=?').bind(
          item.id,
          owner,
        ),
      ]);
      await finish(
        env,
        item,
        owner,
        'retry_wait',
        result.detail,
        runtime.clock() + 60_000,
        runtime.clock(),
        attempt,
      );
    } else if (result.outcome === 'unauthorized' || result.outcome === 'reconnect') {
      await markReconnect(env);
      await finish(env, item, owner, 'blocked', result.detail, null, runtime.clock(), attempt);
      await env.DB.prepare(
        "UPDATE schedules SET enabled=0,reason='needs_reconnect' WHERE id=? AND version=?",
      )
        .bind(item.schedule_id, item.schedule_version)
        .run();
    } else if (result.outcome === 'retry') {
      const retry: boolean = item.attempts + 1 < LIMITS.automaticAttempts;
      await finish(
        env,
        item,
        owner,
        retry ? 'retry_wait' : 'failed',
        result.detail,
        retry ? runtime.clock() + 60_000 * 2 ** item.attempts : null,
        runtime.clock(),
        attempt,
      );
    } else {
      await finish(env, item, owner, result.outcome, result.detail, null, runtime.clock(), attempt);
    }
  }
  return {
    mode: runtime.mode,
    processed,
    detail:
      runtime.mode === 'mock'
        ? '격리된 테스트 저장소에서 모의 전송했습니다. 실제 발송이 아닙니다.'
        : 'API 접수 결과를 기록했습니다. 결과 불명은 자동 재시도하지 않습니다.',
  };
}
export async function resolveUnknown(
  id: string,
  action: 'confirm_sent' | 'retry',
  env: Env,
  now: number,
): Promise<void> {
  const item = await env.DB.prepare("SELECT * FROM deliveries WHERE id=? AND state='unknown'")
    .bind(id)
    .first<Delivery>();
  if (!item) throw appError(409, 'NOT_UNKNOWN', '결과 불명 상태의 발송만 처리할 수 있습니다.');
  if (action === 'retry') {
    const valid = await env.DB.prepare(
      `SELECT id FROM deliveries WHERE id=? AND ${eligibleSchedule}`,
    )
      .bind(id)
      .first<{ id: string }>();
    if (!valid)
      throw appError(
        409,
        'SCHEDULE_INACTIVE',
        '예약이 수정·중지·취소되어 재시도할 수 없습니다. 수신 여부를 확정한 뒤 새 예약을 만드세요.',
      );
  }
  const decision: string = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO manual_decisions(id,delivery_id,action,created_at,warning_accepted) SELECT ?,id,?,?,1 FROM deliveries WHERE id=? AND state='unknown'",
    ).bind(decision, action, now, id),
    env.DB.prepare(
      "UPDATE deliveries SET state=?,attempts=0,auth_retries=0,manual_retry_until=?,retry_at=NULL,error=?,updated_at=? WHERE id=? AND state='unknown' AND EXISTS(SELECT 1 FROM manual_decisions WHERE id=?)",
    ).bind(
      action === 'retry' ? 'pending' : item.mode === 'mock' ? 'mock_sent' : 'sent',
      action === 'retry' ? now + LIMITS.graceMs : null,
      action === 'retry'
        ? '사용자가 중복 가능성을 확인하고 재시도 선택'
        : '사용자가 채팅방 수신 확인',
      now,
      id,
      decision,
    ),
  ]);
}
