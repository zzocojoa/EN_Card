import { readBody } from './storage';
import { appError, type Env } from './types';
import { deriveRelayKey, RELAY_ORIGIN } from '../shared/automation-relay';
async function relayHeaders(env: Env): Promise<Record<string, string>> {
  if (env.STUDIO_ORIGIN !== RELAY_ORIGIN || !env.STUDIO_BRIDGE_SECRET || !env.STUDIO_OWNER_ID)
    return {};
  return {
    'X-Card-Relay-Key': await deriveRelayKey(env.STUDIO_BRIDGE_SECRET, env.STUDIO_OWNER_ID),
  };
}
const allowed: Record<string, string> = {
  '/api/automation': 'GET,PUT',
  '/api/automation/runs': 'GET',
  '/api/automation/start': 'POST',
  '/api/automation/pause': 'POST',
  '/api/automation/trial': 'POST',
};
export async function automationApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!allowed[path]?.split(',').includes(request.method))
    throw appError(404, 'NOT_FOUND', '경로를 찾을 수 없습니다.');
  if (['/api/automation/start', '/api/automation/trial'].includes(path) && env.SEND_MODE !== 'live')
    throw appError(
      409,
      'AUTOMATION_MODE',
      '실제 예약 발송 모드에서만 자동 제작을 시작할 수 있습니다.',
    );
  if (!env.AUTOMATION) {
    if (path === '/api/automation' && request.method === 'GET')
      return Response.json({
        settings: null,
        version: 0,
        enabled: false,
        reason: 'config',
        next_due_at: null,
        available: false,
        missing: ['AUTOMATION'],
      });
    if (path.endsWith('/runs') && request.method === 'GET') return Response.json([]);
    throw appError(503, 'AUTOMATION_CONFIG', '자동 제작 서버 연결을 먼저 설정하세요.');
  }
  const body = request.method === 'GET' ? undefined : await readBody(request, 4096);
  const stub = env.AUTOMATION.get(env.AUTOMATION.idFromName('owner'));
  return stub.fetch(
    new Request(`${env.APP_ORIGIN}${path}`, {
      method: request.method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') ?? '',
        ...(await relayHeaders(env)),
      },
      ...(body ? { body } : {}),
    }),
  );
}
export async function automationCron(env: Env): Promise<void> {
  if (!env.AUTOMATION || env.SEND_MODE !== 'live') return;
  try {
    const stub = env.AUTOMATION.get(env.AUTOMATION.idFromName('owner'));
    const response = await stub.fetch(
      new Request(`${env.APP_ORIGIN}/tick`, { method: 'POST', headers: await relayHeaders(env) }),
    );
    if (!response.ok) console.warn({ event: 'automation_tick_failed', status: response.status });
  } catch {
    console.warn({ event: 'automation_tick_unavailable' });
  }
}
