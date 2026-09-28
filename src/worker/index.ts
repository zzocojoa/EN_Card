import { z, ZodError } from 'zod';
import { LIMITS, parseImport } from '../shared/model';
import { kstDate } from '../shared/time';
import { beginOAuth, cookie, disconnect, finishOAuth, liveToken, requireSession } from './auth';
import { assetPage, cardPage, deliveryPage } from './catalog';
import { dryRun, resolveUnknown, runEngine } from './engine';
import { nativeTransport, sendKakao } from './kakao';
import { resumeSchedule, saveSchedule, schedulePage, stopSchedule } from './schedules';
import { deleteImage, publicImage, readJson, reviewCard, saveCard, uploadImage } from './storage';
import { appError, type AppError, type Env } from './types';

const failureHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const uuid = z.string().uuid();
function pathId(path: string, position: number): string {
  return uuid.parse(path.split('/')[position]);
}
export async function route(request: Request, env: Env): Promise<Response> {
  const url: URL = new URL(request.url);
  const path: string = url.pathname;
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
  if (path.startsWith('/api/page/') && request.method === 'GET') {
    const cursor: string | null = url.searchParams.get('cursor');
    if (path === '/api/page/cards') return Response.json(await cardPage(env, cursor));
    if (path === '/api/page/assets') return Response.json(await assetPage(env, cursor));
    if (path === '/api/page/schedules') return Response.json(await schedulePage(env, cursor));
    if (path === '/api/page/deliveries') return Response.json(await deliveryPage(env, cursor));
  }
  if (/^\/api\/deliveries\/[^/]+\/attempts$/.test(path) && request.method === 'GET') {
    const id: string = z.string().min(1).max(200).parse(path.split('/')[3]);
    const attempts = await env.DB.prepare(
      'SELECT id,started_at,outcome,detail,mode FROM delivery_attempts WHERE delivery_id=? ORDER BY started_at,id',
    )
      .bind(id)
      .all();
    const decisions = await env.DB.prepare(
      'SELECT action,created_at,warning_accepted FROM manual_decisions WHERE delivery_id=? ORDER BY created_at,id',
    )
      .bind(id)
      .all();
    return Response.json({ attempts: attempts.results, decisions: decisions.results });
  }
  if (path === '/api/state' && request.method === 'GET') {
    const [cards, assets, schedules, deliveries, previews, usage, connection, totals] =
      await Promise.all([
        cardPage(env, null),
        assetPage(env, null),
        schedulePage(env, null),
        deliveryPage(env, null),
        env.DB.prepare(
          'SELECT id,schedule_id,due_at_utc,detail,created_at FROM dry_runs ORDER BY created_at DESC LIMIT 50',
        ).all(),
        env.DB.prepare("SELECT * FROM usage_counters WHERE day IN (?,'storage')")
          .bind(kstDate(now))
          .all(),
        env.DB.prepare(
          'SELECT status,expires_at,refresh_expires_at FROM credentials WHERE singleton=1',
        ).first(),
        env.DB.prepare(
          "SELECT (SELECT count(*) FROM cards) AS cards,(SELECT count(*) FROM assets WHERE state!='deleted') AS assets,(SELECT count(*) FROM schedules) AS schedules,(SELECT count(*) FROM schedules WHERE enabled=1) AS active_schedules,(SELECT count(*) FROM deliveries) AS deliveries",
        ).first(),
      ]);
    return Response.json({
      csrf: session.csrf,
      cards: cards.items,
      assets: assets.items,
      schedules: schedules.items,
      deliveries: deliveries.items,
      cursors: {
        cards: cards.next,
        assets: assets.next,
        schedules: schedules.next,
        deliveries: deliveries.next,
      },
      totals,
      previews: previews.results,
      usage: usage.results,
      connection,
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
    await env.DB.prepare(
      "INSERT INTO cards(id,revision,content,status,created_at) SELECT json_extract(value,'$.id'),1,json_extract(value,'$.content'),'draft',? FROM json_each(?)",
    )
      .bind(now, JSON.stringify(cards))
      .run();
    return Response.json({ imported: cards.length }, { status: 201 });
  }
  if (path === '/api/export' && request.method === 'GET') {
    const cards = await cardPage(env, url.searchParams.get('cursor'));
    return Response.json(
      {
        schema_version: 1,
        cards: cards.items.map((card) => ({
          id: card.id,
          revision: card.revision,
          ...card.content,
        })),
        next_cursor: cards.next,
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
        { status: 400, headers: failureHeaders },
      );
    if (error instanceof Error && 'status' in error && 'code' in error) {
      const known: AppError = error as AppError;
      return Response.json(
        { error: known.code, message: known.message },
        { status: known.status, headers: failureHeaders },
      );
    }
    const message: string = error instanceof Error ? error.message : '';
    if (
      message.includes('CHECK constraint failed') ||
      message.includes('active_schedule_limit') ||
      message.includes('image_storage_limit')
    )
      return Response.json(
        {
          error: 'QUOTA',
          message:
            '앱의 업로드·저장량·활성 예약 한도에 도달했습니다. 저장량을 정리하거나 다음 날 다시 시도하세요.',
        },
        { status: 409, headers: failureHeaders },
      );
    if (message.includes('asset_not_ready'))
      return Response.json(
        {
          error: 'ASSET_CHANGED',
          message: '예약 저장 중 카드의 검토 상태가 변경되었습니다. 목록을 다시 확인하세요.',
        },
        { status: 409, headers: failureHeaders },
      );
    if (message.includes('asset_in_use'))
      return Response.json(
        {
          error: 'ASSET_IN_USE',
          message:
            '예약 또는 미확정 발송에서 사용 중인 이미지입니다. 먼저 예약·결과 불명을 정리하세요.',
        },
        { status: 409, headers: failureHeaders },
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
      { status: 500, headers: failureHeaders },
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
