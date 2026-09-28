import { z, ZodError } from 'zod';
import { LIMITS, parseImport, type Card, type CardInput } from '../shared/model';
import { kstDate } from '../shared/time';
import { beginOAuth, cookie, disconnect, finishOAuth, liveToken, requireSession } from './auth';
import { dryRun, resolveUnknown, runEngine } from './engine';
import { nativeTransport, sendKakao } from './kakao';
import { listSchedules, resumeSchedule, saveSchedule, stopSchedule } from './schedules';
import { deleteImage, publicImage, readJson, reviewCard, saveCard, uploadImage } from './storage';
import { appError, type AppError, type Env } from './types';

const uuid = z.string().uuid();
function pathId(path: string, position: number): string {
  return uuid.parse(path.split('/')[position]);
}
export async function route(request: Request, env: Env): Promise<Response> {
  const path: string = new URL(request.url).pathname;
  const now: number = Date.now();
  if (path.startsWith('/images/') || path.startsWith('/original/')) {
    if (!['GET', 'HEAD'].includes(request.method))
      throw appError(405, 'METHOD', '이미지는 GET 요청만 지원합니다.');
    const publicId: string = path.split('/')[2]?.replace(/\.png$/, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(publicId))
      throw appError(404, 'IMAGE_NOT_FOUND', '이미지 주소가 올바르지 않습니다.');
    return publicImage(publicId, env);
  }
  if (path === '/api/boot' && request.method === 'GET')
    return Response.json({
      local: false,
      mode: env.SEND_MODE,
      kakao_configured: Boolean(env.KAKAO_REST_API_KEY),
      limits: LIMITS,
    });
  if (path === '/auth/start' && request.method === 'POST') return beginOAuth(request, env, now);
  if (path === '/auth/callback' && request.method === 'GET')
    return finishOAuth(request, env, now, nativeTransport);
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  const session = await requireSession(request, env, now);
  if (path === '/api/state' && request.method === 'GET') {
    const [
      cards,
      assets,
      schedules,
      deliveries,
      attempts,
      previews,
      usage,
      connection,
      occurrences,
    ] = await Promise.all([
      env.DB.prepare('SELECT * FROM cards ORDER BY created_at DESC LIMIT 500').all<
        Omit<Card, 'content'> & { content: string }
      >(),
      env.DB.prepare(
        "SELECT id,card_id,revision,public_id,bytes,state,created_at FROM assets WHERE state!='deleted' ORDER BY created_at DESC LIMIT 500",
      ).all(),
      listSchedules(env),
      env.DB.prepare(
        'SELECT id,occurrence_id,schedule_id,position,state,mode,due_at_utc,attempts,error,updated_at FROM deliveries ORDER BY due_at_utc DESC,position LIMIT 200',
      ).all(),
      env.DB.prepare(
        'SELECT id,delivery_id,started_at,outcome,detail,mode FROM delivery_attempts ORDER BY started_at DESC LIMIT 200',
      ).all(),
      env.DB.prepare(
        'SELECT id,schedule_id,due_at_utc,detail,created_at FROM dry_runs ORDER BY created_at DESC LIMIT 50',
      ).all(),
      env.DB.prepare("SELECT * FROM usage_counters WHERE day IN (?,'storage')")
        .bind(kstDate(now))
        .all(),
      env.DB.prepare(
        'SELECT status,expires_at,refresh_expires_at FROM credentials WHERE singleton=1',
      ).first(),
      env.DB.prepare('SELECT * FROM occurrence_results ORDER BY due_at_utc DESC LIMIT 100').all(),
    ]);
    return Response.json({
      csrf: session.csrf,
      cards: cards.results.map((card) => ({
        ...card,
        content: JSON.parse(card.content) as CardInput,
      })),
      assets: assets.results,
      schedules,
      deliveries: deliveries.results,
      attempts: attempts.results,
      previews: previews.results,
      usage: usage.results,
      connection,
      occurrences: occurrences.results,
      mode: env.SEND_MODE,
      now,
    });
  }
  if (path === '/api/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM auth_state WHERE id=?').bind(session.id).run();
    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': cookie('en_session', '', 0, env.APP_ORIGIN) } },
    );
  }
  if (path === '/api/disconnect' && request.method === 'POST') {
    await disconnect(env, now);
    return Response.json({ ok: true });
  }
  if (path === '/api/cards' && request.method === 'POST')
    return Response.json(await saveCard(await readJson(request), null, null, env, now), {
      status: 201,
    });
  if (/^\/api\/cards\/[^/]+$/.test(path) && request.method === 'PUT') {
    const body = z
      .object({ revision: z.number().int().positive(), content: z.unknown() })
      .strict()
      .parse(await readJson(request));
    return Response.json(await saveCard(body.content, pathId(path, 3), body.revision, env, now));
  }
  if (path === '/api/import' && request.method === 'POST') {
    const result = parseImport(await readJson(request));
    if (result.errors.length)
      return Response.json(
        {
          error: 'IMPORT_INVALID',
          message: '오류를 수정한 뒤 다시 가져오세요. 일부 카드도 저장하지 않았습니다.',
          details: result.errors,
        },
        { status: 400 },
      );
    const cards = result.cards.map((content) => ({ id: crypto.randomUUID(), content }));
    await env.DB.batch(
      cards.map((card) =>
        env.DB.prepare(
          "INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,'draft',?)",
        ).bind(card.id, JSON.stringify(card.content), now),
      ),
    );
    return Response.json({ imported: cards.length }, { status: 201 });
  }
  if (path === '/api/export' && request.method === 'GET') {
    const cards = await env.DB.prepare(
      'SELECT id,revision,content FROM cards ORDER BY created_at',
    ).all<{ id: string; revision: number; content: string }>();
    return Response.json(
      {
        schema_version: 1,
        cards: cards.results.map((card) => ({
          id: card.id,
          revision: card.revision,
          ...(JSON.parse(card.content) as CardInput),
        })),
      },
      { headers: { 'Content-Disposition': 'attachment; filename="en-cards.json"' } },
    );
  }
  if (/^\/api\/cards\/[^/]+\/image$/.test(path) && request.method === 'POST')
    return uploadImage(request, pathId(path, 3), env, now);
  if (/^\/api\/cards\/[^/]+\/review$/.test(path) && request.method === 'POST') {
    const body = z
      .object({ asset_id: uuid, revision: z.number().int().positive(), reviewed: z.literal(true) })
      .strict()
      .parse(await readJson(request));
    await reviewCard(pathId(path, 3), body.asset_id, body.revision, env);
    return Response.json({ ok: true });
  }
  if (/^\/api\/assets\/[^/]+$/.test(path) && request.method === 'DELETE') {
    await deleteImage(pathId(path, 3), env, now);
    return Response.json({ ok: true });
  }
  if (path === '/api/schedules' && request.method === 'POST')
    return Response.json(await saveSchedule(await readJson(request), null, null, env, now), {
      status: 201,
    });
  if (/^\/api\/schedules\/[^/]+$/.test(path) && request.method === 'PUT') {
    const body = z
      .object({ version: z.number().int().positive(), schedule: z.unknown() })
      .strict()
      .parse(await readJson(request));
    return Response.json(
      await saveSchedule(body.schedule, pathId(path, 3), body.version, env, now),
    );
  }
  if (/^\/api\/schedules\/[^/]+\/(pause|cancel|resume)$/.test(path) && request.method === 'POST') {
    const body = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await readJson(request));
    const id: string = pathId(path, 3);
    if (path.endsWith('/resume')) await resumeSchedule(id, body.version, env, now);
    else
      await stopSchedule(
        id,
        body.version,
        path.endsWith('/pause') ? 'paused' : 'cancelled',
        env,
        now,
      );
    return Response.json({ ok: true });
  }
  if (path === '/api/dry-run' && request.method === 'POST')
    return Response.json(await dryRun(env, now));
  if (/^\/api\/deliveries\/[^/]+\/resolve$/.test(path) && request.method === 'POST') {
    const body = z
      .object({ action: z.enum(['confirm_sent', 'retry']), warning_accepted: z.literal(true) })
      .strict()
      .parse(await readJson(request));
    const id: string = path.split('/')[3] ?? '';
    await resolveUnknown(id, body.action, env, now);
    return Response.json({ ok: true });
  }
  throw appError(404, 'NOT_FOUND', '요청한 API가 없습니다.');
}
export async function handle(request: Request, env: Env): Promise<Response> {
  try {
    const response: Response = await route(request, env);
    if (
      !new URL(request.url).pathname.startsWith('/api/') &&
      !new URL(request.url).pathname.startsWith('/auth/')
    )
      return response;
    const headers: Headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, { status: response.status, headers });
  } catch (error: unknown) {
    if (error instanceof ZodError)
      return Response.json(
        {
          error: 'VALIDATION',
          message: error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        },
        { status: 400 },
      );
    if (error instanceof Error && 'status' in error && 'code' in error) {
      const known: AppError = error as AppError;
      return Response.json(
        { error: known.code, message: known.message },
        { status: known.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const message: string = error instanceof Error ? error.message : '';
    if (message.includes('CHECK constraint failed') || message.includes('active_schedule_limit'))
      return Response.json(
        {
          error: 'QUOTA',
          message:
            '앱의 업로드·저장량·활성 예약 한도에 도달했습니다. 저장량을 정리하거나 다음 날 다시 시도하세요.',
        },
        { status: 409 },
      );
    if (message.includes('asset_not_ready'))
      return Response.json(
        {
          error: 'ASSET_CHANGED',
          message: '예약 저장 중 카드의 검토 상태가 변경되었습니다. 목록을 다시 확인하세요.',
        },
        { status: 409 },
      );
    if (message.includes('asset_in_use'))
      return Response.json(
        {
          error: 'ASSET_IN_USE',
          message:
            '예약 또는 미확정 발송에서 사용 중인 이미지입니다. 먼저 예약·결과 불명을 정리하세요.',
        },
        { status: 409 },
      );
    const requestId: string = crypto.randomUUID();
    console.error({
      event: 'request_failed',
      request_id: requestId,
      path: new URL(request.url).pathname,
      error_type: error instanceof Error ? error.name : 'unknown',
      cause_type: error instanceof Error && error.cause instanceof Error ? error.cause.name : null,
    });
    return Response.json(
      {
        error: 'INTERNAL',
        message: `요청을 완료하지 못했습니다. 저장소·설정을 확인하고 다시 시도하세요. 오류 ID: ${requestId}`,
      },
      { status: 500 },
    );
  }
}
function validateProduction(env: Env): void {
  if (
    env.COST_MODE !== 'free_only' ||
    !['dry_run', 'live'].includes(env.SEND_MODE) ||
    new URL(env.APP_ORIGIN).protocol !== 'https:'
  )
    throw appError(
      503,
      'CONFIG',
      '운영 환경은 HTTPS, free_only, dry_run 또는 live 설정이 필요합니다.',
    );
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    validateProduction(env);
    return handle(request, env);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    validateProduction(env);
    if (env.SEND_MODE === 'dry_run') {
      await dryRun(env, Date.now());
      return;
    }
    await runEngine(env, {
      mode: 'live',
      clock: Date.now,
      token: () => liveToken(env, Date.now()),
      sender: (payload, token) => sendKakao(payload, token, nativeTransport),
    });
  },
};
