import { createSession, cookie, requireOrigin } from './auth';
import { handle } from './index';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url: URL = new URL(request.url);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      env.SEND_MODE !== 'dry_run' ||
      env.APP_ORIGIN !== 'http://127.0.0.1:8787'
    )
      return Response.json(
        { message: '로컬 전용 진입점은 loopback의 dry_run 환경에서만 실행할 수 있습니다.' },
        { status: 403 },
      );
    if (url.pathname === '/api/boot')
      return Response.json({ local: true, mode: 'dry_run', kakao_configured: false });
    if (url.pathname === '/auth/local' && request.method === 'POST') {
      try {
        requireOrigin(request, env);
      } catch {
        return Response.json({ message: '로컬 앱에서 다시 시도하세요.' }, { status: 403 });
      }
      const session = await createSession(env, Date.now());
      return Response.json(
        { ok: true },
        { headers: { 'Set-Cookie': cookie('en_session', session.token, 86400, env.APP_ORIGIN) } },
      );
    }
    return handle(request, env);
  },
};
