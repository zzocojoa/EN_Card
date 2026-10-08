import { expressionKey, type AutomationSettings } from '../shared/automation';
import { type Run } from './types';
import { ownedRun, ownedArgs } from './run-state';

export function expressionScope(settings: AutomationSettings): string {
  return JSON.stringify([
    settings.topic,
    settings.level,
    settings.template,
    settings.base_expression,
  ]);
}
const excluded = `NOT EXISTS(SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=c.expression_key)
  AND NOT EXISTS(SELECT 1 FROM automation_expressions WHERE expression_key=c.expression_key)
  AND NOT EXISTS(SELECT 1 FROM automation_expression_rejections e JOIN automation_runs rejected ON rejected.id=e.run_id
    WHERE e.expression_key=c.expression_key AND rejected.day=r.day AND rejected.kind=r.kind AND rejected.config_version=r.config_version)`;

// Selection and claiming share the same D1 transaction as the persisted target.
// Never spend a full-card AI call on a merely read (unreserved) candidate.
export async function selectExpression(
  db: D1Database,
  run: Run,
  now: number,
): Promise<string | null> {
  const scope = expressionScope(JSON.parse(run.settings) as AutomationSettings);
  await db.batch([
    db
      .prepare(
        `UPDATE automation_expression_candidates SET claim_run_id=? WHERE expression_key=(
      SELECT c.expression_key FROM automation_expression_candidates c JOIN automation_runs r ON r.id=?
      WHERE c.scope=? AND c.claim_run_id IS NULL AND ${excluded}
      ORDER BY c.created_at,c.expression_key LIMIT 1)
      AND claim_run_id IS NULL AND EXISTS(SELECT 1 FROM automation_runs WHERE ${ownedRun} AND selected_expression IS NULL)
      AND NOT EXISTS(SELECT 1 FROM automation_expression_candidates WHERE claim_run_id=?)`,
      )
      .bind(run.id, run.id, scope, ...ownedArgs(run, now), run.id),
    db
      .prepare(
        `UPDATE automation_runs SET selected_expression=(SELECT expression FROM automation_expression_candidates WHERE claim_run_id=automation_runs.id)
      WHERE ${ownedRun} AND selected_expression IS NULL
      AND EXISTS(SELECT 1 FROM automation_expression_candidates WHERE claim_run_id=automation_runs.id)`,
      )
      .bind(...ownedArgs(run, now)),
  ]);
  return db
    .prepare(`SELECT selected_expression FROM automation_runs WHERE ${ownedRun}`)
    .bind(...ownedArgs(run, now))
    .first<string>('selected_expression');
}

export async function storeCandidates(
  db: D1Database,
  run: Run,
  expressions: string[],
  now: number,
): Promise<void> {
  const scope = expressionScope(JSON.parse(run.settings) as AutomationSettings);
  const candidates = [
    ...new Map(expressions.map((value) => [expressionKey(value), value.trim()])).entries(),
  ];
  await db.batch([
    // Only unused suggestions from obsolete settings are discarded; no card/history is deleted.
    db
      .prepare(
        `DELETE FROM automation_expression_candidates WHERE claim_run_id IS NULL AND scope!=?
      AND EXISTS(SELECT 1 FROM automation_runs WHERE ${ownedRun})`,
      )
      .bind(scope, ...ownedArgs(run, now)),
    db
      .prepare(
        `DELETE FROM automation_expression_candidates WHERE claim_run_id IS NULL AND
      (EXISTS(SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=expression_key)
      OR EXISTS(SELECT 1 FROM automation_expressions used WHERE used.expression_key=automation_expression_candidates.expression_key))
      AND EXISTS(SELECT 1 FROM automation_runs WHERE ${ownedRun})`,
      )
      .bind(...ownedArgs(run, now)),
    // Remember old duplicates even when they are outside the prompt's latest 50.
    // The next bounded selection request must not ask for them again.
    ...candidates.map(([key]) =>
      db
        .prepare(
          `INSERT INTO automation_expression_rejections(run_id,expression_key,created_at)
      SELECT id,?,? FROM automation_runs WHERE ${ownedRun}
      AND (EXISTS(SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=?)
        OR EXISTS(SELECT 1 FROM automation_expressions WHERE expression_key=?)) ON CONFLICT DO NOTHING`,
        )
        .bind(key, now, ...ownedArgs(run, now), key, key),
    ),
    ...candidates.map(([key, expression]) =>
      db
        .prepare(
          `INSERT INTO automation_expression_candidates(expression_key,expression,scope,created_at)
      SELECT ?,?,?,? FROM automation_runs WHERE ${ownedRun}
      AND NOT EXISTS(SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=?)
      AND NOT EXISTS(SELECT 1 FROM automation_expressions WHERE expression_key=?)
      AND NOT EXISTS(SELECT 1 FROM automation_expression_rejections e JOIN automation_runs rejected ON rejected.id=e.run_id
        WHERE e.expression_key=? AND rejected.day=automation_runs.day AND rejected.kind=automation_runs.kind AND rejected.config_version=automation_runs.config_version)
      AND (SELECT count(*) FROM automation_expression_candidates)<50 ON CONFLICT DO NOTHING`,
        )
        .bind(key, expression, scope, now, ...ownedArgs(run, now), key, key, key),
    ),
  ]);
}

export async function expressionTaken(
  db: D1Database,
  run: Run,
  expression: string,
): Promise<boolean> {
  const key = expressionKey(expression);
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=? AND id!=?
    UNION ALL SELECT 1 FROM automation_expressions WHERE expression_key=? AND run_id!=?
    UNION ALL SELECT 1 FROM automation_expression_candidates WHERE expression_key=? AND claim_run_id IS NOT NULL AND claim_run_id!=? LIMIT 1`,
      )
      .bind(key, run.card_id, key, run.id, key, run.id)
      .first(),
  );
}
