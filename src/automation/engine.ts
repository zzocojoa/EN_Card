import { automationSettings, parseAiCard, expressionKey } from '../shared/automation';
import { kstDate } from '../shared/time';
import { makePayload } from '../worker/kakao';
import { validatePng } from '../worker/png';
import { deleteImage, retainUploadCleanup } from '../worker/storage';
import {
  AUTOMATION_TIMING,
  readiness,
  type AutomationEnv,
  type AutomationRuntime,
  type Run,
  type SettingsRow,
} from './types';
import { unresolvedSql } from './settings';
import { allocateDailyRuns, claimNextRun, completeAutomationIfIdle, expireRuns } from './run-queue';
import { expressionTaken } from './expression-selection';
import { aiPhase } from './ai-phase';
import { ownedRun, ownedArgs, progress, pause, retryDuplicate } from './run-state';

// Keep the existing import path for consumers of the tick's runtime contract.
export type { AutomationRuntime } from './types';

async function renderPhase(
  env: AutomationEnv,
  run: Run,
  runtime: AutomationRuntime,
): Promise<void> {
  if (run.render_attempts >= 3) {
    await pause(env, run, 'storage', runtime.clock());
    return;
  }
  const card = parseAiCard(
    JSON.parse(run.content!),
    automationSettings.parse(JSON.parse(run.settings)),
  );
  // A manual card may have claimed the expression since the AI review.
  // Catch that before PNG work; the final insert still guards the later race.
  if (run.expression_selection && (await expressionTaken(env.DB, run, card.expression))) {
    await retryDuplicate(env, run, card.expression, runtime.clock());
    return;
  }
  const now = runtime.clock();
  if (
    !(await env.DB.prepare(
      `UPDATE automation_runs SET render_attempts=render_attempts+1 WHERE ${ownedRun} RETURNING id`,
    )
      .bind(...ownedArgs(run, now))
      .first())
  )
    return;
  // Parse stored approved content again. A human edit to this card never gets silently overwritten.
  let png: Uint8Array<ArrayBuffer>;
  try {
    png = await runtime.render(card, run.due_at, run.item_index);
    validatePng(png);
  } catch (error) {
    if (error instanceof RangeError)
      await progress(env, run, runtime.clock(), "status='skipped',error='layout'", []);
    else await pause(env, run, 'config', runtime.clock());
    return;
  }
  const time = runtime.clock();
  const key = expressionKey(card.expression);
  const eligible = `SELECT 1 FROM automation_runs WHERE ${ownedRun}`;
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO automation_expressions(expression_key,run_id) SELECT ?,? WHERE EXISTS(${eligible}) AND NOT EXISTS(SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=? AND id!=?) ON CONFLICT DO NOTHING`,
    ).bind(key, run.id, ...ownedArgs(run, time), key, run.card_id),
    env.DB.prepare(
      `INSERT INTO cards(id,revision,content,status,created_at) SELECT ?,1,?,'draft',? WHERE EXISTS(${eligible}) AND EXISTS(SELECT 1 FROM automation_expressions WHERE expression_key=? AND run_id=?) ON CONFLICT(id) DO NOTHING`,
    ).bind(run.card_id, run.content, time, ...ownedArgs(run, time), key, run.id),
    env.DB.prepare(
      `INSERT INTO assets(id,card_id,revision,snapshot,kv_key,public_id,bytes,state,created_at,usage_day) SELECT ?,id,revision,content,?,?,?,'uploading',?,? FROM cards WHERE id=? AND revision=1 AND content=? AND EXISTS(${eligible}) ON CONFLICT(id) DO NOTHING`,
    ).bind(
      run.asset_id,
      run.asset_id,
      run.public_id,
      png.length,
      time,
      kstDate(time),
      run.card_id,
      run.content,
      ...ownedArgs(run, time),
    ),
  ]);
  const asset = await env.DB.prepare('SELECT state,bytes FROM assets WHERE id=?')
    .bind(run.asset_id)
    .first<{ state: string; bytes: number }>();
  if (!asset) {
    if (result[0]?.meta.changes === 0)
      await retryDuplicate(env, run, card.expression, runtime.clock());
    return;
  }
  if (!['uploading', 'ready'].includes(asset.state) || asset.bytes !== png.length) {
    await pause(env, run, 'storage', runtime.clock());
    return;
  }
  if (asset.state === 'uploading') {
    const writingAt = runtime.clock();
    if (
      !(await env.DB.prepare(
        `UPDATE assets SET created_at=? WHERE id=? AND state='uploading' AND EXISTS(${eligible}) RETURNING id`,
      )
        .bind(writingAt, run.asset_id, ...ownedArgs(run, writingAt))
        .first())
    )
      return;
    // Same ID and approved content make recovery after an ambiguous put idempotent.
    await env.CARD_IMAGES.put(run.asset_id, png);
    const finalized = await env.DB.prepare(
      "UPDATE assets SET state='ready',created_at=? WHERE id=? AND state='uploading' RETURNING id",
    )
      .bind(runtime.clock(), run.asset_id)
      .first();
    if (
      !finalized &&
      (await env.DB.prepare('SELECT state FROM assets WHERE id=?')
        .bind(run.asset_id)
        .first('state')) !== 'ready'
    ) {
      // A late put can arrive after manual cleanup. Restore accounting before retrying deletion.
      await retainUploadCleanup(run.asset_id, env);
      await deleteImage(run.asset_id, env, runtime.clock());
      await pause(env, run, 'storage', runtime.clock());
      return;
    }
  }
  const end = runtime.clock();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE cards SET status='ready',asset_id=?,review_source='ai' WHERE id=? AND revision=1 AND content=? AND EXISTS(${eligible}) AND EXISTS(SELECT 1 FROM assets WHERE id=? AND state='ready')`,
    ).bind(run.asset_id, run.card_id, run.content, ...ownedArgs(run, end), run.asset_id),
    env.DB.prepare(
      `UPDATE automation_runs SET status='schedule',claim_owner=NULL,claim_until=NULL,retry_at=?,error=NULL,updated_at=? WHERE ${ownedRun} AND EXISTS(SELECT 1 FROM cards WHERE id=? AND revision=1 AND content=? AND asset_id=? AND review_source='ai')`,
    ).bind(
      end + AUTOMATION_TIMING.imagePropagationMs,
      end,
      ...ownedArgs(run, end),
      run.card_id,
      run.content,
      run.asset_id,
    ),
  ]);
}
async function schedulePhase(env: AutomationEnv, run: Run, now: number): Promise<void> {
  if (await env.DB.prepare(`SELECT 1 WHERE ${unresolvedSql}`).first()) {
    await pause(env, run, 'unresolved', now);
    return;
  }
  if (
    !(await env.DB.prepare(
      "SELECT 1 FROM credentials WHERE singleton=1 AND status='connected'",
    ).first())
  ) {
    await pause(env, run, 'connection', now);
    return;
  }
  const settings = automationSettings.parse(JSON.parse(run.settings));
  const card = parseAiCard(JSON.parse(run.content!), settings);
  const payload = JSON.stringify(makePayload(card, run.public_id, env.APP_ORIGIN));
  const guard = `EXISTS(SELECT 1 FROM automation_runs WHERE ${ownedRun})`;
  const out = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO schedules(id,name,kind,date,time,end_date,weekdays,cards_per_occurrence,timezone,next_run_at_utc,version,cursor,enabled,mutation_id) SELECT ?,?,'once',?,?,NULL,'[]',1,'Asia/Seoul',?,1,0,1,? WHERE ${guard} AND NOT ${unresolvedSql} AND EXISTS(SELECT 1 FROM credentials WHERE singleton=1 AND status='connected') AND EXISTS(SELECT 1 FROM cards c JOIN assets a ON a.id=c.asset_id WHERE c.id=? AND c.revision=1 AND c.content=? AND c.review_source='ai' AND c.status='ready' AND a.id=? AND a.state='ready' AND a.created_at<=?) ON CONFLICT(id) DO NOTHING`,
    ).bind(
      run.schedule_id,
      `AI ${run.day} · ${run.item_index}/${run.item_count} · ${card.expression}`.slice(0, 100),
      run.day,
      settings.time,
      run.due_at,
      run.id,
      ...ownedArgs(run, now),
      run.card_id,
      run.content,
      run.asset_id,
      now - AUTOMATION_TIMING.imagePropagationMs,
    ),
    env.DB.prepare(
      'INSERT INTO schedule_items(schedule_id,version,position,asset_id,payload) SELECT id,1,0,?,? FROM schedules WHERE id=? AND mutation_id=? ON CONFLICT DO NOTHING',
    ).bind(run.asset_id, payload, run.schedule_id, run.id),
    env.DB.prepare(
      `UPDATE automation_runs SET status='scheduled',claim_owner=NULL,claim_until=NULL,retry_at=NULL,error=NULL,updated_at=? WHERE ${ownedRun} AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)`,
    ).bind(now, ...ownedArgs(run, now), run.schedule_id, run.id),
  ]);
  if (!out[2]?.meta.changes) await progress(env, run, now, "status='skipped',error='changed'", []);
}
export async function automationTick(
  env: AutomationEnv,
  runtime: AutomationRuntime,
): Promise<void> {
  if (readiness(env).length || env.SEND_MODE !== 'live') return;
  const now = runtime.clock();
  const config = await env.DB.prepare(
    'SELECT * FROM automation_settings WHERE singleton=1 AND enabled=1',
  ).first<SettingsRow>();
  if (!config) return;
  await expireRuns(env.DB, now);
  await allocateDailyRuns(env.DB, config, now);
  const run = await claimNextRun(env.DB, now);
  if (!run) {
    await completeAutomationIfIdle(env.DB, config.version, now);
    return;
  }
  try {
    if (['draft', 'review', 'revise'].includes(run.status)) await aiPhase(env, run, runtime);
    else if (run.status === 'render') await renderPhase(env, run, runtime);
    else if (run.status === 'schedule') await schedulePhase(env, run, runtime.clock());
  } catch {
    await pause(env, run, 'storage', runtime.clock());
  }
}
