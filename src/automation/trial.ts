import { automationSettings, automationTrial, trialLeadMinutes } from '../shared/automation';
import { kstDate } from '../shared/time';
import { appError } from '../worker/types';
import {
  ACTIVE,
  AUTOMATION_TIMING,
  readiness,
  type AutomationEnv,
  type SettingsRow,
} from './types';
import { unresolvedSql } from './settings';

export async function startTrial(
  env: AutomationEnv,
  version: number,
  now: number,
  options: unknown = {},
): Promise<void> {
  if (env.SEND_MODE !== 'live' || readiness(env).length)
    throw appError(503, 'AUTOMATION_CONFIG', '무료 AI·실제 발송 연결을 먼저 확인하세요.');
  await registerTrial(env.DB, version, now, options);
}

// Database operation shared by the authenticated endpoint and authorized maintenance tooling.
// External callers must go through startTrial's runtime readiness check.
export async function registerTrial(
  db: D1Database,
  version: number,
  now: number,
  options: unknown = {},
): Promise<void> {
  await registerTrialBatch(db, version, now, options);
}

// Privileged maintenance only, after explicit operator approval of one extra
// five-card verification. This is not exposed through the public trial API.
// Reusing the same authorization ID never creates another batch.
export async function registerVerificationTrial(
  db: D1Database,
  version: number,
  now: number,
  authorizationId: string,
  dueAt?: number,
): Promise<void> {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(authorizationId)
  )
    throw appError(400, 'VERIFICATION_ID', '검증 승인 식별자를 확인하세요.');
  await registerTrialBatch(
    db,
    version,
    now,
    { cards: 5, due_at: dueAt },
    `verification:${authorizationId}`,
  );
}

async function registerTrialBatch(
  db: D1Database,
  version: number,
  now: number,
  options: unknown,
  verificationKey?: string,
): Promise<void> {
  const trial = automationTrial.parse(options);
  const old = await db
    .prepare('SELECT * FROM automation_settings WHERE singleton=1')
    .first<SettingsRow>();
  if (!old || old.version !== version)
    throw appError(409, 'AUTOMATION_CHANGED', '설정이 바뀌었습니다. 새로고침하세요.');
  if (old.enabled)
    throw appError(409, 'AUTOMATION_ACTIVE', '진행 중인 자동 제작을 먼저 일시정지하세요.');
  const earliest = Math.ceil((now + trialLeadMinutes(trial.cards) * 60000) / 60000) * 60000;
  const due = trial.due_at ?? earliest;
  if (due < earliest || due % 60000 !== 0)
    throw appError(
      400,
      'TRIAL_TIME',
      `시험 준비를 위해 최소 ${trialLeadMinutes(trial.cards)}분 뒤의 분 단위 시각을 선택하세요.`,
    );
  const day = kstDate(now);
  if (kstDate(due) !== day)
    throw appError(400, 'TRIAL_DATE', '오늘 안에 준비·발송할 시간이 부족합니다. 내일 시험하세요.');
  const unused = verificationKey
    ? 'NOT EXISTS(SELECT 1 FROM automation_runs WHERE dedupe_key=?)'
    : "NOT EXISTS(SELECT 1 FROM automation_runs WHERE kind='trial' AND day=?)";
  const trialIdentity = verificationKey ?? day;
  if (!(await db.prepare(`SELECT 1 WHERE ${unused}`).bind(trialIdentity).first()))
    throw appError(
      409,
      'TRIAL_USED',
      verificationKey
        ? '이미 사용한 검증 승인입니다. 같은 요청으로 다시 생성하지 않습니다.'
        : '오늘의 추가 시험은 이미 사용했습니다. 중단해도 다시 생성하지 않습니다.',
    );
  const settings = automationSettings.parse(JSON.parse(old.settings));
  const configured = JSON.stringify({
    ...settings,
    cards_per_day: trial.cards,
    start_date: day,
    end_date: day,
    time: new Date(due + 9 * 3600000).toISOString().slice(11, 16),
  });
  const idle = `NOT EXISTS(SELECT 1 FROM automation_runs WHERE status IN ${ACTIVE})
    AND NOT EXISTS(SELECT 1 FROM schedules s JOIN automation_runs r ON r.schedule_id=s.id WHERE s.enabled=1)
    AND NOT EXISTS(SELECT 1 FROM deliveries d JOIN automation_runs r ON r.schedule_id=d.schedule_id WHERE d.state IN ('pending','claimed','retry_wait','blocked'))
    AND NOT (${unresolvedSql})`;
  const connected = "EXISTS(SELECT 1 FROM credentials WHERE singleton=1 AND status='connected')";
  const ids = Array.from({ length: trial.cards }, () => crypto.randomUUID());
  const notBefore = due - (trial.cards === 1 ? 15 : trialLeadMinutes(trial.cards)) * 60000;
  const result = await db.batch([
    ...ids.map((id, index) =>
      db
        .prepare(
          `INSERT INTO automation_runs(id,dedupe_key,day,kind,item_index,item_count,not_before,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,updated_at,expression_selection)
      SELECT ?,?,?,'trial',?,?,?,version+1,?,?,?,'draft','google','groq',?,?,?,?,?,1
      FROM automation_settings WHERE singleton=1 AND version=? AND enabled=0 AND ${connected}
      AND ((?=1 AND ${idle} AND ${unused})
        OR (? > 1 AND EXISTS(SELECT 1 FROM automation_runs WHERE id=? AND config_version=?)))`,
        )
        .bind(
          id,
          index === 0
            ? (verificationKey ?? `trial:${day}`)
            : `${verificationKey ?? `trial:${day}`}:${index + 1}`,
          day,
          index + 1,
          trial.cards,
          notBefore,
          configured,
          due,
          due - AUTOMATION_TIMING.deadlineMarginMs,
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
          crypto.randomUUID(),
          now,
          version,
          index + 1,
          trialIdentity,
          index + 1,
          ids[0],
          version + 1,
        ),
    ),
    db
      .prepare(
        `UPDATE automation_settings SET version=version+1,enabled=1,reason=NULL,next_due_at=NULL,updated_at=?
      WHERE singleton=1 AND version=? AND enabled=0 AND EXISTS(SELECT 1 FROM automation_runs WHERE id=? AND config_version=?)`,
      )
      .bind(now, version, ids[0], version + 1),
  ]);
  if (result.length !== trial.cards + 1 || result.some((r) => r.meta.changes !== 1))
    throw appError(
      409,
      'TRIAL_UNAVAILABLE',
      '다른 실행이 있거나 연결·설정이 바뀌었습니다. 새로고침해 확인하세요.',
    );
}
