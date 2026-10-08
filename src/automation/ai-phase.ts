import {
  automationSettings,
  parseAiCard,
  reviewPassed,
  reviewSchema,
  expressionKey,
  expressionCandidatesSchema,
  type AiReview,
} from '../shared/automation';
import { type CardInput } from '../shared/model';
import { AiError } from './providers';
import {
  AUTOMATION_TIMING,
  MAX_AUTOMATION_AI_ATTEMPTS,
  MAX_CORRECTED_REVISION,
  REPLACEMENT_REVISION,
  type AutomationEnv,
  type AutomationRuntime,
  type Run,
} from './types';
import { expressionTaken, selectExpression, storeCandidates } from './expression-selection';
import { ownedRun, ownedArgs, progress, pause, retryDuplicate } from './run-state';

async function hash(content: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function applyReview(
  env: AutomationEnv,
  run: Run,
  review: AiReview,
  totalAttempts: number,
  reviewedAt: number,
): Promise<void> {
  const passed = reviewPassed(review);
  // Include the current reserved review. A correction must leave room for
  // a fresh independent review; stage/provider retry limits still apply.
  const enoughCalls = totalAttempts + 1 <= MAX_AUTOMATION_AI_ATTEMPTS - 2;
  const canCorrect =
    run.revision < MAX_CORRECTED_REVISION &&
    enoughCalls &&
    (run.revision === 1 ||
      run.deadline - reviewedAt > AUTOMATION_TIMING.additionalCorrectionMs);
  const changeCorrector = !passed && canCorrect && run.revision === 2;
  const canReplace =
    !passed &&
    run.revision === MAX_CORRECTED_REVISION &&
    !run.replacement_origin &&
    enoughCalls &&
    totalAttempts + 1 <= MAX_AUTOMATION_AI_ATTEMPTS - (run.expression_selection ? 3 : 2) &&
    run.deadline - reviewedAt >
      AUTOMATION_TIMING.replacementCandidateMs + (run.expression_selection ? 60_000 : 0);
  if (canReplace) {
    // Save the failed candidate and its actual final review in the same
    // guarded write that clears approval and starts the single fresh draft.
    // Never recycle a run with an existing card/image/reservation/schedule.
    const changed = await env.DB.prepare(
      `UPDATE automation_runs SET replacement_origin=?,revision=?,status='draft',
        writer='google',reviewer='groq',content=NULL,content_hash=NULL,review=NULL,review_hash=NULL,
        error='quality_replacement',retry_at=NULL,claim_owner=NULL,claim_until=NULL,updated_at=?${run.expression_selection ? ',selected_expression=NULL' : ''}
        WHERE ${ownedRun} AND status='review' AND revision=? AND replacement_origin IS NULL
        AND (SELECT count(*) FROM automation_attempts WHERE run_id=automation_runs.id)<=?
        AND NOT EXISTS(SELECT 1 FROM cards WHERE id=automation_runs.card_id)
        AND NOT EXISTS(SELECT 1 FROM assets WHERE id=automation_runs.asset_id)
        AND NOT EXISTS(SELECT 1 FROM automation_expressions WHERE run_id=automation_runs.id)
        AND NOT EXISTS(SELECT 1 FROM schedules WHERE id=automation_runs.schedule_id)`,
    )
      .bind(
        JSON.stringify({
          content: JSON.parse(run.content!),
          content_hash: run.content_hash,
          review,
          writer: run.writer,
          reviewer: run.reviewer,
          revision: run.revision,
          rejected_at: reviewedAt,
        }),
        REPLACEMENT_REVISION,
        reviewedAt,
        ...ownedArgs(run, reviewedAt),
        MAX_CORRECTED_REVISION,
        MAX_AUTOMATION_AI_ATTEMPTS - (run.expression_selection ? 3 : 2),
      )
      .run();
    if (!changed.meta.changes)
      await progress(env, run, reviewedAt, "status='skipped',error='changed'", []);
  } else
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
          : run.revision >= MAX_CORRECTED_REVISION || enoughCalls
            ? 'review_failed'
            : 'ai_limit',
        changeCorrector ? run.reviewer : run.writer,
        changeCorrector ? run.writer : run.reviewer,
      ],
    );
}

export async function aiPhase(env: AutomationEnv, run: Run, runtime: Pick<AutomationRuntime, 'ai' | 'clock'>): Promise<void> {
  let stage: 'select' | 'draft' | 'review' | 'revise' = run.status as 'draft' | 'review' | 'revise';
  if (run.expression_selection) {
    if (run.selected_expression && (await expressionTaken(env.DB, run, run.selected_expression))) {
      await retryDuplicate(env, run, run.selected_expression, runtime.clock());
      return;
    }
    if (stage === 'draft' && !run.selected_expression) {
      run.selected_expression = await selectExpression(env.DB, run, runtime.clock());
      if (!run.selected_expression) stage = 'select';
    }
  }
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
      (stage === 'revise' || (['draft', 'select'].includes(stage) && run.writer === 'google')) &&
      attemptsFor(replacement) < 3
    )
      // Preserve the original correction and feedback, revision, and durable budgets.
      // The replacement writer must earn a NEW review from the opposite provider.
      // Exhausted attempts prevent a later tick from switching back indefinitely.
      await progress(env, run, runtime.clock(), 'writer=?,reviewer=?,retry_at=NULL', [
        replacement,
        run.writer,
      ]);
    else
      await progress(env, run, runtime.clock(), "status='skipped',error=?", [
        stage === 'select' && run.error === 'candidate_empty' ? 'candidate_limit' : 'unavailable',
      ]);
    return;
  }
  const id = crypto.randomUUID();
  const now = runtime.clock();
  const reserved = await env.DB.prepare(
    `INSERT INTO automation_attempts(id,run_id,stage,revision,provider,started_at,outcome) SELECT ?,id,?,?,?,?,'started' FROM automation_runs WHERE ${ownedRun}
      AND (SELECT count(*) FROM automation_attempts WHERE run_id=automation_runs.id)<? RETURNING id`,
  )
    .bind(
      id,
      stage,
      run.revision,
      provider,
      now,
      ...ownedArgs(run, now),
      MAX_AUTOMATION_AI_ATTEMPTS,
    )
    .first();
  if (!reserved) return;
  try {
    const recent = await env.DB.prepare(
      "SELECT json_extract(content,'$.expression') AS expression FROM cards ORDER BY created_at DESC LIMIT 50",
    ).all<{ expression: string }>();
    const settings = automationSettings.parse(JSON.parse(run.settings));
    const replacedExpression = run.replacement_origin
      ? (JSON.parse(run.replacement_origin) as { content: CardInput }).content.expression
      : null;
    const rejectedExpressions = [
      ...(replacedExpression ? [replacedExpression] : []),
      ...(JSON.parse(run.rejected_expressions) as string[]),
    ];
    if (run.expression_selection) {
      const excluded = await env.DB.prepare(
        `SELECT expression AS expression FROM automation_expression_candidates WHERE claim_run_id IS NOT NULL AND claim_run_id!=?
        UNION SELECT e.expression_key AS expression FROM automation_expression_rejections e JOIN automation_runs r ON r.id=e.run_id
        WHERE r.day=? AND r.kind=? AND r.config_version=? LIMIT 50`,
      )
        .bind(run.id, run.day, run.kind, run.config_version)
        .all<{ expression: string }>();
      rejectedExpressions.push(...excluded.results.map((row) => row.expression));
    }
    const selecting = stage === 'select';
    const value = await runtime.ai({
      provider,
      stage,
      settings,
      content: selecting ? null : run.content ? JSON.parse(run.content) : null,
      review: selecting ? null : run.review ? JSON.parse(run.review) : null,
      ...(!selecting && run.selected_expression ? { expression: run.selected_expression } : {}),
      // Put rejections first so even an older duplicate outside the latest 50
      // remains in the existing bounded relay request. Do not log these texts.
      recent: [
        ...new Set([...rejectedExpressions, ...recent.results.map((r) => r.expression)]),
      ].slice(0, 50),
    });
    if (stage === 'select') {
      const candidates = expressionCandidatesSchema.parse(value);
      await storeCandidates(
        env.DB,
        run,
        candidates.expressions.filter(
          (expression) =>
            !rejectedExpressions.some(
              (rejected) => expressionKey(rejected) === expressionKey(expression),
            ),
        ),
        runtime.clock(),
      );
      const selected = await selectExpression(env.DB, run, runtime.clock());
      await progress(env, run, runtime.clock(), 'error=?,retry_at=NULL', [
        selected ? null : 'candidate_empty',
      ]);
    } else if (stage === 'review') {
      const review = reviewSchema.parse(value);
      await applyReview(env, run, review, totalAttempts, runtime.clock());
    } else {
      const card = parseAiCard(value, settings);
      if (
        run.expression_selection &&
        (!run.selected_expression ||
          expressionKey(card.expression) !== expressionKey(run.selected_expression))
      )
        throw new AiError('invalid');
      const content = JSON.stringify(card);
      const digest = await hash(content);
      const duplicate = run.expression_selection
        ? await expressionTaken(env.DB, run, card.expression)
        : await env.DB.prepare(
            "SELECT 1 FROM cards WHERE lower(trim(json_extract(content,'$.expression')))=? UNION ALL SELECT 1 FROM automation_expressions WHERE expression_key=? AND run_id!=? LIMIT 1",
          )
            .bind(expressionKey(card.expression), expressionKey(card.expression), run.id)
            .first();
      if (
        duplicate ||
        rejectedExpressions.some(
          (expression) => expressionKey(expression) === expressionKey(card.expression),
        )
      )
        await retryDuplicate(env, run, card.expression, runtime.clock());
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
