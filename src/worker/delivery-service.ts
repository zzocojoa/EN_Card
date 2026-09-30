import { deliverClaimed, prepareEngine } from './engine';
import { nativeTransport, sendKakao } from './kakao';
import { appError, type DeliveryJob, type Env } from './types';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (env.COST_MODE !== 'free_only' || env.SEND_MODE !== 'live')
      throw appError(503, 'DELIVERY_CONFIG', '비공개 발송 Worker의 무료·live 설정을 확인하세요.');
    const path = new URL(request.url).pathname;
    if (path === '/_internal/prepare') {
      await prepareEngine(env, Date.now(), 'live');
      return new Response(null, { status: 204 });
    }
    if (path !== '/_internal/deliver') return new Response('Not found', { status: 404 });
    // Private service binding only; this Worker has no public or preview URL.
    const job = (await request.json()) as DeliveryJob;
    const report = await deliverClaimed(env, job, {
      mode: 'live',
      clock: Date.now,
      sender: (payload, token) => sendKakao(payload, token, nativeTransport),
    });
    return Response.json(report);
  },
};
