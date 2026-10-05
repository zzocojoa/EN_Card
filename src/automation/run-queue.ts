import { automationSettings, nextAutomationDue } from '../shared/automation';
import { kstDate } from '../shared/time';
import { ACTIVE, AUTOMATION_TIMING, currentGuard, type Run, type SettingsRow } from './types';

// Queue transitions stay separate from AI/rendering I/O. SQL guards remain authoritative
// even when the caller's settings snapshot becomes stale while another request is running.
export async function expireRuns(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE automation_runs SET status='skipped',error='expired',claim_owner=NULL,claim_until=NULL,updated_at=? WHERE status IN ${ACTIVE} AND deadline<=?`,
    )
    .bind(now, now)
    .run();
}

export async function allocateDailyRuns(
  db: D1Database,
  config: SettingsRow,
  now: number,
): Promise<void> {
  const due = config.next_due_at;
  if (due === null || due - AUTOMATION_TIMING.preparationMs > now) return;
  const settings = automationSettings.parse(JSON.parse(config.settings));
  const next = nextAutomationDue(settings, Math.max(due, now + AUTOMATION_TIMING.deadlineMarginMs));
  const deadline = due - AUTOMATION_TIMING.deadlineMarginMs;
  const valid = deadline > now;
  const day = kstDate(due);
  // All slots and the cursor move in one batch. The first legacy-compatible key anchors
  // the day, so changing quantity/time or restarting never replenishes it.
  await db.batch([
    ...Array.from({ length: settings.cards_per_day }, (_, index) =>
      db
        .prepare(
          `INSERT INTO automation_runs(id,dedupe_key,day,item_index,item_count,config_version,settings,due_at,deadline,status,writer,reviewer,card_id,asset_id,public_id,schedule_id,error,updated_at) SELECT ?,?,?,?,?,version,settings,?,?,?,'google','groq',?,?,?,?,?,? FROM automation_settings WHERE singleton=1 AND enabled=1 AND version=? AND next_due_at=? AND (?=1 OR EXISTS(SELECT 1 FROM automation_runs r WHERE r.kind='daily' AND r.day=? AND r.item_index=1 AND r.config_version=? AND r.due_at=? AND r.item_count=?)) ON CONFLICT DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          index === 0 ? day : `${day}:${index + 1}`,
          day,
          index + 1,
          settings.cards_per_day,
          due,
          deadline,
          valid ? 'draft' : 'skipped',
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
          crypto.randomUUID(),
          valid ? null : 'expired',
          now,
          config.version,
          due,
          index + 1,
          day,
          config.version,
          due,
          settings.cards_per_day,
        ),
    ),
    db
      .prepare(
        'UPDATE automation_settings SET next_due_at=?,updated_at=? WHERE singleton=1 AND enabled=1 AND version=? AND next_due_at=?',
      )
      .bind(next, now, config.version, due),
  ]);
}

export async function claimNextRun(db: D1Database, now: number): Promise<Run | null> {
  const owner = crypto.randomUUID();
  return db
    .prepare(
      `UPDATE automation_runs SET claim_owner=?,claim_until=? WHERE id=(SELECT id FROM automation_runs WHERE status IN ${ACTIVE} AND ${currentGuard} AND not_before<=? AND deadline>? AND (retry_at IS NULL OR retry_at<=?) AND (claim_until IS NULL OR claim_until<=?) AND NOT EXISTS(SELECT 1 FROM automation_runs earlier WHERE earlier.kind=automation_runs.kind AND earlier.day=automation_runs.day AND earlier.item_index<automation_runs.item_index AND earlier.status IN ${ACTIVE}) ORDER BY due_at,item_index LIMIT 1) AND (claim_until IS NULL OR claim_until<=?) RETURNING *`,
    )
    .bind(owner, now + AUTOMATION_TIMING.claimMs, now, now, now, now, now)
    .first<Run>();
}

export async function completeAutomationIfIdle(
  db: D1Database,
  version: number,
  now: number,
): Promise<void> {
  // An empty claim result alone is not completion: retries, claims and unknown sends may remain.
  await db
    .prepare(
      `UPDATE automation_settings SET enabled=0,reason='complete',updated_at=? WHERE singleton=1 AND enabled=1 AND next_due_at IS NULL AND version=? AND NOT EXISTS(SELECT 1 FROM automation_runs WHERE status IN ${ACTIVE}) AND NOT EXISTS(SELECT 1 FROM schedules s JOIN automation_runs r ON r.schedule_id=s.id WHERE s.enabled=1) AND NOT EXISTS(SELECT 1 FROM deliveries d JOIN automation_runs r ON r.schedule_id=d.schedule_id WHERE d.state IN ('pending','claimed','sending','retry_wait','blocked') OR (d.state='unknown' AND d.resolution IS NULL))`,
    )
    .bind(now, version)
    .run();
}
