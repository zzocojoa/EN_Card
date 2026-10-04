import { automationSettings } from '../shared/automation';
import { kstDate } from '../shared/time';
import { appError } from '../worker/types';
import { ACTIVE, readiness, type AutomationEnv, type SettingsRow } from './types';
import { unresolvedSql } from './settings';

export async function startTrial(env: AutomationEnv, version: number, now: number): Promise<void> {
  if (env.SEND_MODE !== 'live' || readiness(env).length)
    throw appError(503, 'AUTOMATION_CONFIG', '무료 AI·실제 발송 연결을 먼저 확인하세요.');
  const old = await env.DB.prepare(
    'SELECT * FROM automation_settings WHERE singleton=1',
  ).first<SettingsRow>();
  if (!old || old.version !== version)
    throw appError(409, 'AUTOMATION_CHANGED', '설정이 바뀌었습니다. 새로고침하세요.');
  if (old.enabled)
    throw appError(409, 'AUTOMATION_ACTIVE', '진행 중인 자동 제작을 먼저 일시정지하세요.');
  const due = Math.ceil((now + 25 * 60000) / 60000) * 60000;
  const day = kstDate(now);
  if (kstDate(due) !== day)
    throw appError(400, 'TRIAL_DATE', '오늘 안에 준비·발송할 시간이 부족합니다. 내일 시험하세요.');
  if (
    await env.DB.prepare("SELECT 1 FROM automation_runs WHERE day=? AND kind='trial'")
      .bind(day)
      .first()
  )
    throw appError(
      409,
      'TRIAL_USED',
      '오늘의 추가 한 장 시험은 이미 사용했습니다. 중단해도 다시 생성하지 않습니다.',
    );
  const settings = automationSettings.parse(JSON.parse(old.settings));
  const configured = JSON.stringify({
    ...settings,
    start_date: day,
    end_date: day,
    time: new Date(due + 9 * 3600000).toISOString().slice(11, 16),
  });
  const idle = `NOT EXISTS(SELECT 1 FROM automation_runs WHERE status IN ${ACTIVE})
    AND NOT EXISTS(SELECT 1 FROM schedules s JOIN automation_runs r ON r.schedule_id=s.id WHERE s.enabled=1)
    AND NOT EXISTS(SELECT 1 FROM deliveries d JOIN automation_runs r ON r.schedule_id=d.schedule_id WHERE d.state IN ('pending','claimed','retry_wait','blocked'))
    AND NOT (${unresolvedSql})`;
  const connected = "EXISTS(SELECT 1 FROM credentials WHERE singleton=1 AND status='connected')";
  const id = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO automation_runs(id,dedupe_key,day,kind,not_before,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at)
      SELECT ?,?,?,'trial',?,version+1,?,?,?,'draft','google','groq',?,?,?,?,?
      FROM automation_settings WHERE singleton=1 AND version=? AND enabled=0 AND ${connected} AND ${idle}
      AND NOT EXISTS(SELECT 1 FROM automation_runs WHERE kind='trial' AND day=?)`,
    ).bind(
      id,
      `trial:${day}`,
      day,
      due - 15 * 60000,
      configured,
      due,
      due - 5 * 60000,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
      crypto.randomUUID(),
      now,
      version,
      day,
    ),
    env.DB.prepare(
      `UPDATE automation_settings SET version=version+1,enabled=1,reason=NULL,next_due_at=NULL,updated_at=?
      WHERE singleton=1 AND version=? AND enabled=0 AND EXISTS(SELECT 1 FROM automation_runs WHERE id=? AND config_version=?)`,
    ).bind(now, version, id, version + 1),
  ]);
  if (!result[0]?.meta.changes || !result[1]?.meta.changes)
    throw appError(
      409,
      'TRIAL_UNAVAILABLE',
      '다른 실행이 있거나 연결·설정이 바뀌었습니다. 새로고침해 확인하세요.',
    );
}
