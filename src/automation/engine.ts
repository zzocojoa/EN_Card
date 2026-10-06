import {
  automationSettings,
  parseAiCard,
  reviewPassed,
  reviewSchema,
  expressionKey,
  MAX_DUPLICATE_CANDIDATES,
} from '../shared/automation';
import { kstDate } from '../shared/time';
import { type CardInput } from '../shared/model';
import { makePayload } from '../worker/kakao';
import { validatePng } from '../worker/png';
import { deleteImage, retainUploadCleanup } from '../worker/storage';
import { AiError, type AiCall } from './providers';
import {
  AUTOMATION_TIMING,
  MAX_AUTOMATION_AI_ATTEMPTS,
  MAX_AUTOMATION_REVISION,
  currentGuard,
  readiness,
  type AutomationEnv,
  type Run,
  type SettingsRow,
} from './types';
import { changeSettings, unresolvedSql } from './settings';
import { allocateDailyRuns, claimNextRun, completeAutomationIfIdle, expireRuns } from './run-queue';

export type AutomationRuntime = {
  ai: AiCall;
  render: (card: CardInput) => Promise<Uint8Array<ArrayBuffer>>;
  clock: () => number;
};
const owned = `id=? AND claim_owner=? AND claim_until>? AND deadline>? AND ${currentGuard}`;
async function hash(content: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
function guardArgs(run: Run, now: number) {
  return [run.id, run.claim_owner, now, now];
}
async function progress(
  env: AutomationEnv,
  run: Run,
  now: number,
  columns: string,
  args: (string | number | null)[],
): Promise<void> {
  await env.DB.prepare(
    `UPDATE automation_runs SET ${columns},claim_owner=NULL,claim_until=NULL,updated_at=? WHERE ${owned}`,
  )
    .bind(...args, now, ...guardArgs(run, now))
    .run();
}
async function pause(env: AutomationEnv, run: Run, reason: string, now: number): Promise<void> {
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
async function retryDuplicate(
  env: AutomationEnv,
  run: Run,
  expression: string,
  now: number,
): Promise<void> {
  const rejected = JSON.parse(run.rejected_expressions) as string[];
  const retry = rejected.length + 1 < MAX_DUPLICATE_CANDIDATES;
  // A correction retains its original card and review. A render-time collision
  // starts a fresh draft and must earn a new review before another render.
  const correction = run.status === 'revise';
  const changed = await env.DB.prepare(
    `UPDATE automation_runs SET rejected_expressions=json_insert(rejected_expressions,'$[#]',?),
      status=?,error=?,retry_at=NULL,claim_owner=NULL,claim_until=NULL,updated_at=?,
      content=?,content_hash=?,review=?,review_hash=NULL
      WHERE ${owned} AND json_array_length(rejected_expressions)<?
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
      ...guardArgs(run, now),
      MAX_DUPLICATE_CANDIDATES,
    )
    .run();
  // Never repurpose a card/asset already created or edited during rendering.
  if (!changed.meta.changes) await progress(env, run, now, "status='skipped',error='changed'", []);
}
async function aiPhase(env: AutomationEnv, run: Run, runtime: AutomationRuntime): Promise<void> {
  const stage = run.status as 'draft' | 'review' | 'revise';
  const provider = stage === 'review' ? run.reviewer : run.writer;
  const counts = await env.DB.prepare(
    'SELECT stage,revision,provider,count(*) AS n FROM automation_attempts WHERE run_id=? GROUP BY stage,revision,provider',
  )
    .bind(run.id)
    .all<{ stage: string; revision: number; provider: Run['writer']; n: number }>();
  const totalAttempts = counts.results.reduce((total, row) => total + row.n, 0);
  if (totalAttempts >= MAX_AUTOMATION_AI_ATTEMPTS) {
    await progress(env, run, runtime.clock(), "status='skipped',error='ai_limit'", []);
    return;
  }
  const attemptsFor = (candidate: Run['writer']) =>
    counts.results.find(
      (row) => row.provider === candidate && row.stage === stage && row.revision === run.revision,
    )?.n ?? 0;
  const attempts = attemptsFor(provider);
  if (attempts >= 3) {
    const replacement = run.writer === 'google' ? 'groq' : 'google';
    if (
      (stage === 'revise' || (stage === 'draft' && run.writer === 'google')) &&
      attemptsFor(replacement) < 3
    )
      // Preserve the original correction and feedback, revision, and durable budgets.
      // The replacement writer must earn a NEW review from the opposite provider.
      // Exhausted attempts prevent a later tick from switching back indefinitely.
      await progress(env, run, runtime.clock(), 'writer=?,reviewer=?,retry_at=NULL', [
        replacement,
        run.writer,
      ]);
    else await progress(env, run, runtime.clock(), "status='skipped',error='unavailable'", []);
    return;
  }
  const id = crypto.randomUUID();
  const now = runtime.clock();
  const reserved = await env.DB.prepare(
    `INSERT INTO automation_attempts(id,run_id,stage,revision,provider,started_at,outcome) SELECT ?,id,?,?,?,?,'started' FROM automation_runs WHERE ${owned}
      AND (SELECT count(*) FROM automation_attempts WHERE run_id=automation_runs.id)<? RETURNING id`,
  )
    .bind(
      id,
      stage,
      run.revision,
      provider,
      now,
      ...guardArgs(run, now),
      MAX_AUTOMATION_AI_ATTEMPTS,
    )
    .first();
  if (!reserved) return;
  try {
    const recent = await env.DB.prepare(
      "SELECT json_extract(content,'$.expression') AS expression FROM cards ORDER BY created_at DESC LIMIT 50",
    ).all<{ expression: string }>();
    const settings = automationSettings.parse(JSON.parse(run.settings));
    const value = await runtime.ai({
      provider,
      stage,
      settings,
      content: run.content ? JSON.parse(run.content) : null,
      review: run.review ? JSON.parse(run.review) : null,
      // Put rejections first so even an older duplicate outside the latest 50
      // remains in the existing bounded relay request. Do not log these texts.
      recent: [
        ...new Set([
          ...(JSON.parse(run.rejected_expressions) as string[]),
          ...recent.results.map((r) => r.expression),
        ]),
      ].slice(0, 50),
    });
    if (stage === 'review') {
      const review = reviewSchema.parse(value);
      const passed = reviewPassed(review);
      const reviewedAt = runtime.clock();
      // Include the current reserved review. A correction must leave room for
      // a fresh independent review; stage/provider retry limits still apply.
      const enoughCalls = totalAttempts + 1 <= MAX_AUTOMATION_AI_ATTEMPTS - 2;
      const canCorrect =
        run.revision < MAX_AUTOMATION_REVISION &&
        enoughCalls &&
        (run.revision === 1 ||
          run.deadline - reviewedAt > AUTOMATION_TIMING.additionalCorrectionMs);
      const changeCorrector = !passed && canCorrect && run.revision === 2;
      await progress(
        env,
        run,
        reviewedAt,
        'status=?,review=?,review_hash=?,error=?,writer=?,reviewer=?,retry_at=NULL',
        [
          passed ? 'render' : canCorrect ? 'revise' : 'skipped',
          JSON.stringify(review),
          passed ? run.content_hash : null,
          passed || canCorrect
            ? null
            : run.revision >= MAX_AUTOMATION_REVISION || enoughCalls
              ? 'review_failed'
              : 'ai_limit',
          changeCorrector ? run.reviewer : run.writer,
          changeCorrector ? run.writer : run.reviewer,
        ],
      );
    } else {
      const card = parseAiCard(value, settings);
      const content = JSON.stringify(card);
      const digest = await hash(content);
      const duplicate = await env.DB.prepare(
        "SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=? UNION ALL SELECT 1 FROM automation_expressions WHERE expression_key=? AND run_id!=? LIMIT 1",
      )
        .bind(expressionKey(card.expression), expressionKey(card.expression), run.id)
        .first();
      if (duplicate) await retryDuplicate(env, run, card.expression, runtime.clock());
      else
        await progress(
          env,
          run,
          runtime.clock(),
          "status='review',content=?,content_hash=?,review=NULL,review_hash=NULL,revision=?,error=NULL,retry_at=NULL",
          [content, digest, stage === 'revise' ? run.revision + 1 : run.revision],
        );
    }
    await env.DB.prepare("UPDATE automation_attempts SET outcome='ok' WHERE id=?").bind(id).run();
  } catch (e) {
    const failure = e instanceof AiError ? e : new AiError('invalid');
    await env.DB.prepare('UPDATE automation_attempts SET outcome=?,http_status=? WHERE id=?')
      .bind(failure.code, failure.httpStatus, id)
      .run();
    if (['auth', 'quota', 'config'].includes(failure.code))
      await pause(env, run, failure.code, runtime.clock());
    else
      await progress(env, run, runtime.clock(), 'error=?,retry_at=?', [
        failure.code,
        runtime.clock() + AUTOMATION_TIMING.aiRetryMs,
      ]);
  }
}
async function renderPhase(
  env: AutomationEnv,
  run: Run,
  runtime: AutomationRuntime,
): Promise<void> {
  if (run.render_attempts >= 3) {
    await pause(env, run, 'storage', runtime.clock());
    return;
  }
  const now = runtime.clock();
  if (
    !(await env.DB.prepare(
      `UPDATE automation_runs SET render_attempts=render_attempts+1 WHERE ${owned} RETURNING id`,
    )
      .bind(...guardArgs(run, now))
      .first())
  )
    return;
  const card = parseAiCard(
    JSON.parse(run.content!),
    automationSettings.parse(JSON.parse(run.settings)),
  );
  // Parse stored approved content again. A human edit to this card never gets silently overwritten.
  let png: Uint8Array<ArrayBuffer>;
  try {
    png = await runtime.render(card);
    validatePng(png);
  } catch (error) {
    if (error instanceof RangeError)
      await progress(env, run, runtime.clock(), "status='skipped',error='layout'", []);
    else await pause(env, run, 'config', runtime.clock());
    return;
  }
  const time = runtime.clock();
  const key = expressionKey(card.expression);
  const eligible = `SELECT 1 FROM automation_runs WHERE ${owned}`;
  const result = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO automation_expressions(expression_key,run_id) SELECT ?,? WHERE EXISTS(${eligible}) AND NOT EXISTS(SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=? AND id!=?) ON CONFLICT DO NOTHING`,
    ).bind(key, run.id, ...guardArgs(run, time), key, run.card_id),
    env.DB.prepare(
      `INSERT INTO cards(id,revision,content,status,created_at) SELECT ?,1,?,'draft',? WHERE EXISTS(${eligible}) AND EXISTS(SELECT 1 FROM automation_expressions WHERE expression_key=? AND run_id=?) ON CONFLICT(id) DO NOTHING`,
    ).bind(run.card_id, run.content, time, ...guardArgs(run, time), key, run.id),
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
      ...guardArgs(run, time),
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
        .bind(writingAt, run.asset_id, ...guardArgs(run, writingAt))
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
    ).bind(run.asset_id, run.card_id, run.content, ...guardArgs(run, end), run.asset_id),
    env.DB.prepare(
      `UPDATE automation_runs SET status='schedule',claim_owner=NULL,claim_until=NULL,retry_at=?,error=NULL,updated_at=? WHERE ${owned} AND EXISTS(SELECT 1 FROM cards WHERE id=? AND revision=1 AND content=? AND asset_id=? AND review_source='ai')`,
    ).bind(
      end + AUTOMATION_TIMING.imagePropagationMs,
      end,
      ...guardArgs(run, end),
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
  const guard = `EXISTS(SELECT 1 FROM automation_runs WHERE ${owned})`;
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
      ...guardArgs(run, now),
      run.card_id,
      run.content,
      run.asset_id,
      now - AUTOMATION_TIMING.imagePropagationMs,
    ),
    env.DB.prepare(
      'INSERT INTO schedule_items(schedule_id,version,position,asset_id,payload) SELECT id,1,0,?,? FROM schedules WHERE id=? AND mutation_id=? ON CONFLICT DO NOTHING',
    ).bind(run.asset_id, payload, run.schedule_id, run.id),
    env.DB.prepare(
      `UPDATE automation_runs SET status='scheduled',claim_owner=NULL,claim_until=NULL,retry_at=NULL,error=NULL,updated_at=? WHERE ${owned} AND EXISTS(SELECT 1 FROM schedules WHERE id=? AND mutation_id=?)`,
    ).bind(now, ...guardArgs(run, now), run.schedule_id, run.id),
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
