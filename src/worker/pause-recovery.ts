import {
  LIMITS,
  recoverySchema,
  type PausePreview,
  type RecoveryInput,
  type RecoveryItem,
} from '../shared/model';
import { kstDate, kstToUtc } from '../shared/time';
import { appError, type Env } from './types';

type Source = {
  id: string;
  name: string;
  version: number;
  cursor: number;
  enabled: number;
  reason: string | null;
  remaining: number;
  unresolved: number;
};
type Candidate = {
  delivery_id: string;
  title: string;
  asset_id: string;
  payload: string;
  safe: number;
  state: string;
  asset_state: string | null;
  kv_key: string | null;
  created_at: number | null;
  decision: 'reschedule' | 'exclude' | null;
  target_schedule_id: string | null;
};
async function source(id: string, version: number, env: Env): Promise<Source> {
  const row = await env.DB.prepare(
    "SELECT s.*,(SELECT count(*) FROM schedule_items i WHERE i.schedule_id=s.id AND i.version=s.version AND i.position>=s.cursor) AS remaining,EXISTS(SELECT 1 FROM deliveries d WHERE d.schedule_id=s.id AND (d.state='sending' OR (d.state='unknown' AND d.resolution IS NULL))) AS unresolved FROM schedules s WHERE id=? AND version=?",
  )
    .bind(id, version)
    .first<Source>();
  if (!row) throw appError(409, 'SCHEDULE_CHANGED', '예약 버전이 변경되었습니다. 다시 불러오세요.');
  return row;
}
async function candidates(id: string, env: Env): Promise<Candidate[]> {
  return (
    await env.DB.prepare(
      "SELECT p.*,json_extract(p.payload,'$.content.title') AS title,a.state AS asset_state,a.kv_key,a.created_at FROM pause_recovery_candidates p LEFT JOIN assets a ON a.id=p.asset_id WHERE p.schedule_id=? ORDER BY p.due_at_utc,p.schedule_version,p.position,p.delivery_id",
    )
      .bind(id)
      .all<Candidate>()
  ).results;
}
export async function pausePreview(id: string, version: number, env: Env): Promise<PausePreview> {
  const row: Source = await source(id, version, env);
  const items = await env.DB.prepare(
    "SELECT id AS delivery_id,json_extract(payload,'$.content.title') AS title,state FROM deliveries WHERE schedule_id=? AND state IN ('pending','claimed','retry_wait','blocked') ORDER BY due_at_utc,position",
  )
    .bind(id)
    .all<{ delivery_id: string; title: string; state: string }>();
  return {
    schedule_id: id,
    version,
    remaining: row.remaining,
    can_resume: row.reason !== 'cancelled',
    unresolved: row.unresolved === 1,
    items: items.results.map((item) => ({
      ...item,
      available: false,
      reason: '일시정지 후 호출 이력을 확인하여 새 미래 시각에 다시 예약하거나 제외합니다.',
      decision: null,
      target_schedule_id: null,
    })),
  };
}
async function recoveryItem(item: Candidate, env: Env): Promise<RecoveryItem> {
  const present: boolean =
    item.decision === null &&
    item.safe === 1 &&
    item.asset_state === 'ready' &&
    item.kv_key !== null &&
    (await env.CARD_IMAGES.get(item.kv_key, 'arrayBuffer')) !== null;
  return {
    delivery_id: item.delivery_id,
    title: item.title,
    state: item.state,
    available: present,
    reason: item.decision
      ? '이미 선택이 기록되었습니다.'
      : !item.safe
        ? '호출 이력에서 미발송을 확정할 수 없습니다. 자동 복구하지 않습니다.'
        : !present
          ? '고정 이미지가 없거나 정리되어 복구할 수 없습니다. 제외 후 카드를 다시 준비하세요.'
          : '확정된 미발송: 고정 이미지와 원래 내용으로 다시 예약할 수 있습니다.',
    decision: item.decision,
    target_schedule_id: item.target_schedule_id,
  };
}
export async function recoveryPreview(
  id: string,
  version: number,
  env: Env,
): Promise<PausePreview> {
  const row: Source = await source(id, version, env);
  const items: RecoveryItem[] = [];
  const all: Candidate[] = await candidates(id, env);
  const pending: Candidate[] = all.filter((item) => item.decision === null);
  const current: Candidate[] = pending.length ? pending.slice(0, LIMITS.recoveryBatchSize) : all;
  for (const item of current) items.push(await recoveryItem(item, env));
  return {
    schedule_id: id,
    version,
    remaining: row.remaining,
    can_resume: row.reason !== 'cancelled',
    unresolved: row.unresolved === 1,
    items,
    pending_count: pending.length,
  };
}
export async function decideRecovery(
  id: string,
  input: unknown,
  env: Env,
  now: number,
): Promise<{ schedule_ids: string[]; recovered: number; excluded: number }> {
  const data: RecoveryInput = recoverySchema.parse(input);
  const row: Source = await source(id, data.version, env);
  if (row.unresolved)
    throw appError(
      409,
      'SCHEDULE_UNRESOLVED',
      '발송 기록에서 sending·미해결 unknown을 먼저 확인하세요. 일시정지는 유지됩니다.',
    );
  if (row.enabled || !['paused', 'cancelled'].includes(row.reason ?? ''))
    throw appError(409, 'RECOVERY_STATE', '일시정지·취소 상태에서 미발송 카드를 처리하세요.');
  const ids: string[] = [...data.recover_ids, ...data.exclude_ids];
  const pending: Candidate[] = (await candidates(id, env)).filter(
    (item) => item.decision === null && ids.includes(item.delivery_id),
  );
  if (pending.length !== ids.length)
    throw appError(
      409,
      'RECOVERY_CHANGED',
      '선택한 대상 목록이 변경되었습니다. 복구 또는 제외 대상을 다시 확인하세요.',
    );
  const recovering: Candidate[] = pending.filter((item) =>
    data.recover_ids.includes(item.delivery_id),
  );
  let due: number = now;
  if (recovering.length) {
    if (!data.date || !data.time)
      throw appError(400, 'RECOVERY_TIME', '미발송 카드의 새 날짜와 시각을 선택하세요.');
    due = kstToUtc(data.date, data.time);
    if (due < now + LIMITS.propagationMs)
      throw appError(400, 'RECOVERY_TIME', '복구 예약은 현재부터 최소 2분 이후여야 합니다.');
    if (
      env.SEND_MODE === 'live' &&
      !(await env.DB.prepare(
        "SELECT singleton FROM credentials WHERE singleton=1 AND status='connected'",
      ).first())
    )
      throw appError(409, 'NEEDS_RECONNECT', '카카오를 연결한 뒤 복구 예약을 만드세요.');
    for (const item of recovering) {
      const view: RecoveryItem = await recoveryItem(item, env);
      if (
        !view.available ||
        item.created_at === null ||
        item.created_at + LIMITS.propagationMs > due
      )
        throw appError(409, 'RECOVERY_UNAVAILABLE', `${item.title}: ${view.reason}`);
    }
  }
  const mutation: string = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE schedules SET mutation_id=? WHERE id=? AND version=? AND enabled=0 AND reason IN ('paused','cancelled') AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.schedule_id=schedules.id AND (d.state='sending' OR (d.state='unknown' AND d.resolution IS NULL))) AND (SELECT count(*) FROM pause_recovery_candidates p WHERE p.schedule_id=schedules.id AND p.decision IS NULL AND p.delivery_id IN (SELECT value FROM json_each(?)))=?",
    ).bind(mutation, id, data.version, JSON.stringify(ids), ids.length),
  ];
  const scheduleIds: string[] = [];
  for (let start: number = 0; start < recovering.length; start += LIMITS.cardsPerOccurrence) {
    const group: Candidate[] = recovering.slice(start, start + LIMITS.cardsPerOccurrence);
    const target: string = crypto.randomUUID();
    const time: number = due + scheduleIds.length * LIMITS.propagationMs;
    scheduleIds.push(target);
    statements.push(
      env.DB.prepare(
        "INSERT INTO schedules(id,name,kind,date,time,weekdays,cards_per_occurrence,timezone,next_run_at_utc,version,cursor,enabled) SELECT ?,?,'once',?,?,'[]',?,'Asia/Seoul',?,1,0,1 FROM schedules WHERE id=? AND mutation_id=?",
      ).bind(
        target,
        `${row.name.slice(0, 65)} · 미발송 복구`,
        kstDate(time),
        new Date(time + 9 * 3600_000).toISOString().slice(11, 16),
        group.length,
        time,
        id,
        mutation,
      ),
    );
    const groupIds: string = JSON.stringify(group.map((item) => item.delivery_id));
    statements.push(
      env.DB.prepare(
        "UPDATE pause_recoveries SET decision='reschedule',target_schedule_id=?,target_position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=delivery_id),decided_at=? WHERE delivery_id IN (SELECT value FROM json_each(?)) AND decision IS NULL AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)",
      ).bind(target, groupIds, now, groupIds, id, mutation),
    );
    statements.push(
      env.DB.prepare(
        "INSERT INTO schedule_items(schedule_id,version,position,asset_id,payload) SELECT target_schedule_id,1,target_position,asset_id,payload FROM pause_recovery_candidates WHERE target_schedule_id=? AND decision='reschedule' AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?) ORDER BY target_position",
      ).bind(target, id, mutation),
    );
  }
  if (data.exclude_ids.length)
    statements.push(
      env.DB.prepare(
        "UPDATE pause_recoveries SET decision='exclude',decided_at=? WHERE delivery_id IN (SELECT value FROM json_each(?)) AND decision IS NULL AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)",
      ).bind(now, JSON.stringify(data.exclude_ids), id, mutation),
    );
  const results = await env.DB.batch(statements);
  if (!results[0]?.meta.changes)
    throw appError(
      409,
      'RECOVERY_CHANGED',
      '이미 처리했거나 발송 상태가 바뀌었습니다. 결과를 다시 불러오세요.',
    );
  return {
    schedule_ids: scheduleIds,
    recovered: recovering.length,
    excluded: data.exclude_ids.length,
  };
}
