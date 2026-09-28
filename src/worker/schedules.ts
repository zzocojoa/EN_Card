import {
  LIMITS,
  scheduleSchema,
  type CardInput,
  type Schedule,
  type ScheduleInput,
} from '../shared/model';
import { nextRun } from '../shared/time';
import { makePayload } from './kakao';
import { appError, type Env } from './types';

type ScheduleRow = Omit<Schedule, 'weekdays' | 'asset_ids'> & { weekdays: string };
export function decodeSchedule(row: ScheduleRow): Schedule {
  return { ...row, weekdays: JSON.parse(row.weekdays) as number[], asset_ids: [] };
}
export async function listSchedules(env: Env): Promise<Schedule[]> {
  const [schedules, items] = await Promise.all([
    env.DB.prepare(
      'SELECT * FROM schedules ORDER BY next_run_at_utc,id LIMIT 200',
    ).all<ScheduleRow>(),
    env.DB.prepare(
      'SELECT i.schedule_id,i.asset_id FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id AND s.version=i.version ORDER BY i.position',
    ).all<{ schedule_id: string; asset_id: string }>(),
  ]);
  return schedules.results.map((row) => ({
    ...decodeSchedule(row),
    asset_ids: items.results
      .filter((item) => item.schedule_id === row.id)
      .map((item) => item.asset_id),
  }));
}
export async function saveSchedule(
  input: unknown,
  id: string | null,
  expectedVersion: number | null,
  env: Env,
  now: number,
): Promise<{ id: string }> {
  const data: ScheduleInput = scheduleSchema.parse(input);
  const due: number | null = nextRun(data, now + LIMITS.propagationMs - 1);
  if (!due)
    throw appError(
      400,
      'SCHEDULE_TIME',
      '실행 가능한 미래 시각이 없습니다. 최소 2분 이후로 설정하세요.',
    );
  const assets = await env.DB.prepare(
    `SELECT a.id,a.public_id,a.created_at,a.snapshot FROM assets a JOIN cards c ON c.id=a.card_id AND c.revision=a.revision AND c.asset_id=a.id WHERE a.state='ready' AND c.status='ready' AND a.id IN (${data.asset_ids.map(() => '?').join(',')})`,
  )
    .bind(...data.asset_ids)
    .all<{ id: string; public_id: string; created_at: number; snapshot: string }>();
  if (assets.results.length !== data.asset_ids.length)
    throw appError(
      400,
      'CARDS_NOT_READY',
      '현재 수정본의 PNG를 저장하고 검토 완료한 카드만 예약할 수 있습니다.',
    );
  if (assets.results.some((asset) => asset.created_at + LIMITS.propagationMs > due))
    throw appError(400, 'IMAGE_WAIT', '이미지 저장 후 최소 2분의 여유를 두세요.');
  const scheduleId: string = id ?? crypto.randomUUID();
  const mutation: string = crypto.randomUUID();
  const version: number = id ? (expectedVersion ?? 0) + 1 : 1;
  const statements: D1PreparedStatement[] = [
    id
      ? env.DB.prepare(
          'UPDATE schedules SET name=?,kind=?,date=?,time=?,end_date=?,weekdays=?,cards_per_occurrence=?,next_run_at_utc=?,version=?,cursor=0,enabled=1,reason=NULL,mutation_id=? WHERE id=? AND version=?',
        ).bind(
          data.name,
          data.kind,
          data.date,
          data.time,
          data.end_date,
          JSON.stringify(data.weekdays),
          data.cards_per_occurrence,
          due,
          version,
          mutation,
          id,
          expectedVersion,
        )
      : env.DB.prepare(
          "INSERT INTO schedules(id,name,kind,date,time,end_date,weekdays,cards_per_occurrence,timezone,next_run_at_utc,version,cursor,enabled,mutation_id) VALUES(?,?,?,?,?,?,?,?,'Asia/Seoul',?,1,0,1,?)",
        ).bind(
          scheduleId,
          data.name,
          data.kind,
          data.date,
          data.time,
          data.end_date,
          JSON.stringify(data.weekdays),
          data.cards_per_occurrence,
          due,
          mutation,
        ),
    env.DB.prepare(
      "UPDATE deliveries SET state='cancelled',error='예약 수정',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE schedule_id=? AND schedule_version<? AND state IN ('pending','claimed','retry_wait','blocked') AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)",
    ).bind(now, scheduleId, version, scheduleId, mutation),
    ...data.asset_ids.map((assetId, position) => {
      const asset = assets.results.find((item) => item.id === assetId);
      if (!asset) throw appError(409, 'ASSET_CHANGED', '예약 이미지가 변경되었습니다.');
      const payload: string = JSON.stringify(
        makePayload(JSON.parse(asset.snapshot) as CardInput, asset.public_id, env.APP_ORIGIN),
      );
      return env.DB.prepare(
        'INSERT INTO schedule_items(schedule_id,version,position,asset_id,payload) SELECT id,version,?,?,? FROM schedules WHERE id=? AND mutation_id=?',
      ).bind(position, assetId, payload, scheduleId, mutation);
    }),
  ];
  const results = await env.DB.batch(statements);
  if (!results[0]?.meta.changes)
    throw appError(409, 'SCHEDULE_CHANGED', '예약이 이미 수정되었습니다. 새로 불러오세요.');
  return { id: scheduleId };
}
export async function stopSchedule(
  id: string,
  version: number,
  reason: 'paused' | 'cancelled',
  env: Env,
  now: number,
): Promise<void> {
  const mutation: string = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE schedules SET enabled=0,reason=?,mutation_id=? WHERE id=? AND version=? AND (reason IS NOT 'cancelled' OR ?='cancelled')",
    ).bind(reason, mutation, id, version, reason),
    env.DB.prepare(
      "UPDATE deliveries SET state='cancelled',error=?,claim_owner=NULL,claim_until=NULL,updated_at=? WHERE schedule_id=? AND state IN ('pending','claimed','retry_wait','blocked') AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)",
    ).bind(reason, now, id, id, mutation),
  ]);
  if (!results[0]?.meta.changes)
    throw appError(409, 'SCHEDULE_CHANGED', '예약 버전이 변경되었습니다.');
}
export async function resumeSchedule(
  id: string,
  version: number,
  env: Env,
  now: number,
): Promise<void> {
  const raw = await env.DB.prepare('SELECT * FROM schedules WHERE id=? AND version=?')
    .bind(id, version)
    .first<ScheduleRow>();
  if (!raw) throw appError(409, 'SCHEDULE_CHANGED', '예약을 다시 불러오세요.');
  if (raw.reason === 'needs_reconnect' || raw.reason === 'daily_limit') {
    const outstanding = await env.DB.prepare(
      "SELECT count(*) AS count FROM deliveries WHERE schedule_id=? AND schedule_version=? AND state IN ('blocked','pending','retry_wait') AND due_at_utc>=?",
    )
      .bind(id, version, now - LIMITS.graceMs)
      .first<{ count: number }>();
    if (outstanding && outstanding.count > 0) {
      if (
        raw.reason === 'needs_reconnect' &&
        !(await env.DB.prepare("SELECT owner_id FROM credentials WHERE status='connected'").first())
      )
        throw appError(409, 'NEEDS_RECONNECT', '먼저 카카오를 다시 연결하세요.');
      const remaining = await env.DB.prepare(
        'SELECT count(*) AS count FROM schedule_items WHERE schedule_id=? AND version=? AND position>=?',
      )
        .bind(id, version, raw.cursor)
        .first<{ count: number }>();
      const repeat: boolean =
        raw.next_run_at_utc !== null && (remaining?.count ?? 0) >= raw.cards_per_occurrence;
      const mutation: string = crypto.randomUUID();
      const resumed = await env.DB.batch([
        env.DB.prepare(
          'UPDATE schedules SET reason=?,enabled=?,mutation_id=? WHERE id=? AND version=? AND enabled=0 AND reason=?',
        ).bind(
          repeat ? null : raw.next_run_at_utc ? 'content_shortage' : 'completed',
          repeat ? 1 : 0,
          mutation,
          id,
          version,
          raw.reason,
        ),
        env.DB.prepare(
          "UPDATE deliveries SET state='pending',retry_at=NULL,error=NULL WHERE schedule_id=? AND schedule_version=? AND state='blocked' AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)",
        ).bind(id, version, id, mutation),
      ]);
      if (!resumed[0]?.meta.changes)
        throw appError(409, 'SCHEDULE_CHANGED', '재개 중 예약 상태가 변경되었습니다.');
      return;
    }
  }
  if (raw.reason === 'cancelled')
    throw appError(409, 'SCHEDULE_CANCELLED', '취소한 예약은 새 예약으로 등록하세요.');
  const due: number | null = nextRun(decodeSchedule(raw), now + LIMITS.propagationMs - 1);
  if (!due) throw appError(400, 'SCHEDULE_TIME', '예약의 시각이나 종료일을 수정하세요.');
  const remaining = await env.DB.prepare(
    "SELECT count(*) AS count FROM schedule_items i JOIN assets a ON a.id=i.asset_id WHERE i.schedule_id=? AND i.version=? AND i.position>=? AND a.state='ready'",
  )
    .bind(id, version, raw.cursor)
    .first<{ count: number }>();
  if (!remaining || remaining.count < raw.cards_per_occurrence)
    throw appError(
      409,
      'CONTENT_SHORTAGE',
      '남은 카드가 부족합니다. 카드 목록을 추가하여 예약을 수정하세요.',
    );
  const results = await env.DB.batch([
    env.DB.prepare(
      'UPDATE schedules SET enabled=1,reason=NULL,next_run_at_utc=?,version=version+1 WHERE id=? AND version=? AND enabled=0 AND reason IS ?',
    ).bind(due, id, version, raw.reason),
    env.DB.prepare(
      'INSERT OR IGNORE INTO schedule_items(schedule_id,version,position,asset_id,payload) SELECT i.schedule_id,?,i.position,i.asset_id,i.payload FROM schedule_items i JOIN schedules s ON s.id=i.schedule_id WHERE i.schedule_id=? AND i.version=? AND s.version=?',
    ).bind(version + 1, id, version, version + 1),
    env.DB.prepare(
      "UPDATE deliveries SET state='missed',error='재개 시 이전 회차의 허용 시간 경과',updated_at=? WHERE schedule_id=? AND schedule_version=? AND state='blocked' AND due_at_utc<? AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND version=?)",
    ).bind(now, id, version, now - LIMITS.graceMs, id, version + 1),
  ]);
  if (!results[0]?.meta.changes)
    throw appError(409, 'SCHEDULE_CHANGED', '예약 상태가 변경되었습니다.');
}
