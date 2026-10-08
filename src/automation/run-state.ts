import { MAX_DUPLICATE_CANDIDATES } from '../shared/automation';
import { changeSettings } from './settings';
import { currentGuard, type AutomationEnv, type Run } from './types';

// Every state change must still own the live claim, deadline and settings version.
export const ownedRun = `id=? AND claim_owner=? AND claim_until>? AND deadline>? AND ${currentGuard}`;
export const ownedArgs = (run: Run, now: number) => [run.id, run.claim_owner, now, now];

export async function progress(
  env: AutomationEnv,
  run: Run,
  now: number,
  columns: string,
  args: (string | number | null)[],
): Promise<void> {
  await env.DB.prepare(
    `UPDATE automation_runs SET ${columns},claim_owner=NULL,claim_until=NULL,updated_at=? WHERE ${ownedRun}`,
  )
    .bind(...args, now, ...ownedArgs(run, now))
    .run();
}
export async function pause(env: AutomationEnv, run: Run, reason: string, now: number): Promise<void> {
  try {
    if (!run.claim_owner) return;
    await changeSettings(env, 'pause', run.config_version, null, now, reason, {
      id: run.id,
      owner: run.claim_owner,
    });
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AUTOMATION_CHANGED')) throw e;
  }
}
export async function retryDuplicate(
  env: AutomationEnv,
  run: Run,
  expression: string,
  now: number,
): Promise<void> {
  const rejected = JSON.parse(run.rejected_expressions) as string[];
  const retry = rejected.length + 1 < MAX_DUPLICATE_CANDIDATES;
  // Legacy corrections retain their original card/review. Selected expressions
  // that became duplicates need a different reserved target and a fresh review.
  const correction = run.status === 'revise' && !run.expression_selection;
  const changed = await env.DB.prepare(
    `UPDATE automation_runs SET rejected_expressions=json_insert(rejected_expressions,'$[#]',?),
      status=?,error=?,retry_at=NULL,claim_owner=NULL,claim_until=NULL,updated_at=?,
      content=?,content_hash=?,review=?,review_hash=NULL${run.expression_selection ? ',selected_expression=NULL' : ''}
      WHERE ${ownedRun} AND json_array_length(rejected_expressions)<?
      AND NOT EXISTS(SELECT 1 FROM cards WHERE id=automation_runs.card_id)
      AND NOT EXISTS(SELECT 1 FROM assets WHERE id=automation_runs.asset_id)
      AND NOT EXISTS(SELECT 1 FROM automation_expressions WHERE run_id=automation_runs.id)`,
  )
    .bind(
      expression,
      retry ? (correction ? 'revise' : 'draft') : 'skipped',
      retry ? 'duplicate_retry' : 'duplicate_limit',
      now,
      correction ? run.content : null,
      correction ? run.content_hash : null,
      correction ? run.review : null,
      ...ownedArgs(run, now),
      MAX_DUPLICATE_CANDIDATES,
    )
    .run();
  // Never repurpose a card/asset already created or edited during rendering.
  if (!changed.meta.changes) await progress(env, run, now, "status='skipped',error='changed'", []);
}
