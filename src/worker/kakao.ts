import { z } from 'zod';
import type { CardInput, FeedPayload, SendResult } from '../shared/model';
import { appError, type Env, type Transport } from './types';

export const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});
export type TokenResponse = z.infer<typeof tokenSchema>;
const linkSchema = z.object({ web_url: z.url(), mobile_web_url: z.url() }).strict();
const feedSchema = z
  .object({
    object_type: z.literal('feed'),
    content: z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(200),
        image_url: z.url(),
        image_width: z.literal(1080),
        image_height: z.literal(1080),
        link: linkSchema,
      })
      .strict(),
    buttons: z
      .array(z.object({ title: z.literal('원본 보기'), link: linkSchema }).strict())
      .length(1),
  })
  .strict();
export function validatePayload(value: unknown, origin: string): FeedPayload {
  const payload = feedSchema.parse(value);
  const urls: string[] = [
    payload.content.image_url,
    payload.content.link.web_url,
    payload.content.link.mobile_web_url,
    ...payload.buttons.flatMap((button) => [button.link.web_url, button.link.mobile_web_url]),
  ];
  if (urls.some((url) => new URL(url).origin !== origin))
    throw appError(400, 'PAYLOAD_ORIGIN', '피드 이미지·원본 링크는 등록된 앱 출처여야 합니다.');
  return payload;
}
export const nativeTransport: Transport = (url: string, init: RequestInit): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
export function makePayload(card: CardInput, publicId: string, origin: string): FeedPayload {
  const link = {
    web_url: `${origin}/original/${publicId}`,
    mobile_web_url: `${origin}/original/${publicId}`,
  };
  return {
    object_type: 'feed',
    content: {
      title: card.expression,
      description: card.meaning_ko,
      image_url: `${origin}/images/${publicId}.png`,
      image_width: 1080,
      image_height: 1080,
      link,
    },
    buttons: [{ title: '원본 보기', link }],
  };
}
export async function sendKakao(
  payload: FeedPayload,
  token: string,
  transport: Transport,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await transport('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(payload) }).toString(),
    });
  } catch (error: unknown) {
    console.warn({
      event: 'send_response_missing',
      error_type: error instanceof Error ? error.name : 'unknown',
    });
    return {
      outcome: 'unknown',
      detail: '응답을 받지 못했습니다. 채팅방 확인 전 재발송하지 마세요.',
    };
  }
  const raw: string = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return {
      outcome: 'unknown',
      detail: `HTTP ${response.status}: JSON 응답이 아닙니다. 접수 여부를 확인하세요.`,
    };
  }
  const parsed = z
    .object({ result_code: z.number().optional(), code: z.number().optional() })
    .safeParse(body);
  const code: number | undefined = parsed.success ? parsed.data.code : undefined;
  const detail: string = `카카오 메시지 API HTTP ${response.status}, code=${String(code)}, result_code=${parsed.success ? String(parsed.data.result_code) : 'invalid'}; payload_title=${payload.content.title}`;
  if (response.ok && parsed.success && parsed.data.result_code === 0)
    return { outcome: 'sent', detail: '카카오 API 접수 확인 (열람 확인 아님)' };
  if (response.status === 401 && code === -401) return { outcome: 'unauthorized', detail };
  if (code === -402 || code === -3 || code === -403) return { outcome: 'reconnect', detail };
  if ([400, 429].includes(response.status) && code === -10) return { outcome: 'retry', detail };
  if (
    response.status >= 500 ||
    code === -603 ||
    code === -1 ||
    code === -7 ||
    response.ok ||
    !parsed.success ||
    code === undefined
  )
    return { outcome: 'unknown', detail };
  return { outcome: 'failed', detail };
}
export async function requestTokens(
  params: URLSearchParams,
  env: Env,
  transport: Transport,
): Promise<TokenResponse> {
  if (!env.KAKAO_REST_API_KEY || !env.KAKAO_CLIENT_SECRET)
    throw appError(503, 'KAKAO_CONFIG', '카카오 REST API 키와 Client Secret을 설정하세요.');
  const requestParams: URLSearchParams = new URLSearchParams(params);
  requestParams.set('client_id', env.KAKAO_REST_API_KEY);
  requestParams.set('client_secret', env.KAKAO_CLIENT_SECRET);
  let response: Response;
  try {
    response = await transport('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: requestParams.toString(),
    });
  } catch (error: unknown) {
    console.warn({
      event: 'token_response_missing',
      error_type: error instanceof Error ? error.name : 'unknown',
    });
    throw appError(
      502,
      'TOKEN_UNCERTAIN',
      '토큰 응답이 유실되었습니다. 코드를 재사용하지 말고 카카오를 다시 연결하세요.',
    );
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    const reason = z
      .object({ error: z.string(), error_code: z.string().optional() })
      .safeParse(body);
    throw appError(
      401,
      'TOKEN_REJECTED',
      `토큰 API HTTP ${response.status}, error=${reason.success ? reason.data.error : 'invalid_response'}, code=${reason.success ? (reason.data.error_code ?? 'none') : 'none'}. 카카오를 다시 연결하세요.`,
    );
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success)
    throw appError(
      502,
      'TOKEN_RESPONSE',
      '토큰 응답 필드가 누락되었습니다. 카카오를 다시 연결하세요.',
    );
  return parsed.data;
}
export async function kakaoOwner(token: string, transport: Transport): Promise<string> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    const response: Response = await transport('https://kapi.kakao.com/v2/user/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status >= 500 && attempt < 3) {
      console.warn({ event: 'owner_lookup_retry', status: response.status, attempt });
      continue;
    }
    if (!response.ok)
      throw appError(
        401,
        'OWNER_LOOKUP',
        `사용자 조회 HTTP ${response.status}. 로그인 상태를 확인하세요.`,
      );
    return String(
      z.object({ id: z.number().int().safe().positive() }).parse(await response.json()).id,
    );
  }
  throw appError(502, 'OWNER_LOOKUP', '사용자 조회 재시도 한도에 도달했습니다.');
}
