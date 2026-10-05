import {
  automationSettings,
  nextAutomationDue,
  type AutomationView,
  type AutomationRunView,
} from '../shared/automation';
import { appError } from '../worker/types';
import { kstDate } from '../shared/time';
import { ACTIVE, readiness, type AutomationEnv, type Run, type SettingsRow } from './types';

export const unresolvedSql =
  "EXISTS(SELECT 1 FROM deliveries d JOIN automation_runs r ON r.schedule_id=d.schedule_id WHERE d.state='sending' OR (d.state='unknown' AND d.resolution IS NULL))";
export async function settingsView(env: AutomationEnv, now = Date.now()): Promise<AutomationView> {
  const row = await env.DB.prepare(
    'SELECT * FROM automation_settings WHERE singleton=1',
  ).first<SettingsRow>();
  const missing = readiness(env);
  return {
    settings: row ? automationSettings.parse(JSON.parse(row.settings)) : null,
    version: row?.version ?? 0,
    enabled: !!row?.enabled,
    reason: row?.reason ?? null,
    next_due_at: row?.next_due_at ?? null,
    available: missing.length === 0,
    missing,
    trial_used_today: !!(await env.DB.prepare(
      "SELECT 1 FROM automation_runs WHERE day=? AND kind='trial'",
    )
      .bind(kstDate(now))
      .first()),
  };
}
export async function runHistory(env: AutomationEnv): Promise<AutomationRunView[]> {
  const rows = await env.DB.prepare(
    `SELECT r.*,a.public_id AS ready_public_id,coalesce((SELECT state FROM deliveries WHERE schedule_id=r.schedule_id ORDER BY updated_at DESC LIMIT 1),(SELECT reason FROM schedules WHERE id=r.schedule_id AND enabled=0)) AS delivery_state FROM automation_runs r LEFT JOIN assets a ON a.id=r.asset_id AND a.state='ready' ORDER BY r.day DESC,r.due_at DESC,r.item_index LIMIT 30`,
  ).all<Run & { ready_public_id: string | null; delivery_state: string | null }>();
  return rows.results.map((r) => ({
    id: r.id,
    day: r.day,
    kind: r.kind,
    item_index: r.item_index,
    item_count: r.item_count,
    not_before: r.not_before,
    due_at: r.due_at,
    status: r.status,
    error: r.error,
    writer: r.writer,
    reviewer: r.reviewer,
    revision: r.revision,
    card_id: r.card_id,
    asset_id: r.asset_id,
    schedule_id: r.schedule_id,
    content: r.content ? JSON.parse(r.content) : null,
    review: r.review ? JSON.parse(r.review) : null,
    public_id: r.ready_public_id,
    updated_at: r.updated_at,
    delivery_state: r.delivery_state,
  }));
}
// A config version is an authorization token. Every in-flight phase rechecks it after awaiting I/O.
export async function changeSettings(
  env: AutomationEnv,
  action: 'save' | 'start' | 'pause',
  version: number,
  value: unknown,
  now: number,
  reason = 'paused',
  claim?: { id: string; owner: string },
): Promise<void> {
  const old = await env.DB.prepare(
    'SELECT * FROM automation_settings WHERE singleton=1',
  ).first<SettingsRow>();
  if ((old?.version ?? 0) !== version)
    throw appError(409, 'AUTOMATION_CHANGED', '다른 탭에서 설정이 바뀌었습니다. 새로고침하세요.');
  const settings =
    action === 'save'
      ? automationSettings.parse(value)
      : old
        ? automationSettings.parse(JSON.parse(old.settings))
        : null;
  if (!settings) throw appError(400, 'AUTOMATION_SETTINGS', '먼저 자동 제작 설정을 저장하세요.');
  if (action === 'start') {
    if (readiness(env).length)
      throw appError(503, 'AUTOMATION_CONFIG', '무료 AI 실행 설정을 먼저 확인하세요.');
    if (env.SEND_MODE !== 'live')
      throw appError(
        409,
        'AUTOMATION_MODE',
        '실제 예약 발송 모드에서만 자동 제작을 시작할 수 있습니다.',
      );
    const connected = await env.DB.prepare(
      "SELECT 1 AS ok FROM credentials WHERE singleton=1 AND status='connected'",
    ).first();
    if (!connected) throw appError(409, 'AUTOMATION_CONNECTION', '먼저 카카오를 연결하세요.');
    if (await env.DB.prepare(`SELECT 1 WHERE ${unresolvedSql}`).first())
      throw appError(409, 'AUTOMATION_UNRESOLVED', '이전 발송 결과를 먼저 확인하세요.');
  }
  const due = nextAutomationDue(settings, now + 3600000 - 1);
  if (action === 'start' && due === null)
    throw appError(
      400,
      'AUTOMATION_DATE',
      '기간 안에 준비 시간 1시간을 확보한 다음 발송 시각이 없습니다.',
    );
  const changed = version + 1;
  const guard = 'EXISTS(SELECT 1 FROM automation_settings WHERE singleton=1 AND version=?)';
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO automation_settings(singleton,settings,version,enabled,reason,next_due_at,updated_at) VALUES(1,?,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET settings=excluded.settings,version=excluded.version,enabled=excluded.enabled,reason=excluded.reason,next_due_at=excluded.next_due_at,updated_at=excluded.updated_at WHERE automation_settings.version=? AND (? IS NULL OR EXISTS(SELECT 1 FROM automation_runs WHERE id=? AND claim_owner=? AND claim_until>? AND status IN ${ACTIVE}))`,
    ).bind(
      JSON.stringify(settings),
      changed,
      action === 'start' ? 1 : 0,
      action === 'start' ? null : action === 'save' ? 'changed' : reason,
      due,
      now,
      version,
      claim?.id ?? null,
      claim?.id ?? null,
      claim?.owner ?? null,
      now,
    ),
    env.DB.prepare(
      `UPDATE automation_runs SET status='cancelled',error=?,claim_owner=NULL,claim_until=NULL,updated_at=? WHERE status IN ${ACTIVE} AND config_version=? AND ${guard}`,
    ).bind(action === 'save' ? 'changed' : reason, now, version, changed),
    env.DB.prepare(
      `UPDATE schedules SET enabled=0,reason='cancelled' WHERE id IN(SELECT schedule_id FROM automation_runs WHERE config_version<=?) AND (enabled=1 OR EXISTS(SELECT 1 FROM deliveries d WHERE d.schedule_id=schedules.id AND (d.state IN ('pending','claimed','sending','retry_wait','blocked') OR (d.state='unknown' AND d.resolution IS NULL)))) AND ${guard}`,
    ).bind(version, changed),
    env.DB.prepare(
      `UPDATE deliveries SET state='cancelled',cancellation_reason='paused',error='자동 제작 일시정지 또는 설정 변경',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE state IN ('pending','claimed','retry_wait','blocked') AND schedule_id IN(SELECT schedule_id FROM automation_runs WHERE config_version<=?) AND ${guard}`,
    ).bind(now, version, changed),
  ]);
  if (!result[0]?.meta.changes)
    throw appError(409, 'AUTOMATION_CHANGED', '설정이 바뀌었습니다. 새로고침하세요.');
}
