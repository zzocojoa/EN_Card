import { z } from 'zod';
import type { CardInput, FeedPayload, SendResult } from '../shared/model';
import { appError, type Env, type Transport } from './types';
import { tokenError } from './token-errors';

export const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
  scope: z.string().max(2000).optional(),
});
export type TokenResponse = z.infer<typeof tokenSchema>;
const tokenErrorSchema = z.object({
  error: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  error_code: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .optional(),
});
const ownerSchema = z.object({ id: z.number().int().safe().positive() });
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function feedText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200;
}
function feedLink(value: unknown): value is FeedPayload['content']['link'] {
  return (
    record(value) &&
    exactKeys(value, ['web_url', 'mobile_web_url']) &&
    typeof value.web_url === 'string' &&
    typeof value.mobile_web_url === 'string'
  );
}
export function validatePayload(value: unknown, origin: string): FeedPayload {
  // The Free delivery invocation must also stay small on its first call. Keep this
  // fixed feed contract independent of a schema parser's lazy first-use setup.
  if (
    !record(value) ||
    !exactKeys(value, ['object_type', 'content', 'buttons']) ||
    value.object_type !== 'feed' ||
    !record(value.content) ||
    !exactKeys(value.content, [
      'title',
      'description',
      'image_url',
      'image_width',
      'image_height',
      'link',
    ]) ||
    !feedText(value.content.title) ||
    !feedText(value.content.description) ||
    typeof value.content.image_url !== 'string' ||
    value.content.image_width !== 1080 ||
    value.content.image_height !== 1080 ||
    !feedLink(value.content.link) ||
    !Array.isArray(value.buttons) ||
    value.buttons.length !== 1 ||
    !record(value.buttons[0]) ||
    !exactKeys(value.buttons[0], ['title', 'link']) ||
    value.buttons[0].title !== '원본 보기' ||
    !feedLink(value.buttons[0].link)
  )
    throw appError(400, 'PAYLOAD_FORMAT', '저장된 피드 형식이 올바르지 않습니다.');
  const payload = value as FeedPayload;
  const urls: string[] = [
    payload.content.image_url,
    payload.content.link.web_url,
    payload.content.link.mobile_web_url,
    ...payload.buttons.flatMap((button) => [button.link.web_url, button.link.mobile_web_url]),
  ];
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw appError(400, 'PAYLOAD_FORMAT', '피드 이미지·원본 링크의 URL 형식을 확인하세요.');
    }
    if (parsed.origin !== origin)
      throw appError(400, 'PAYLOAD_ORIGIN', '피드 이미지·원본 링크는 등록된 앱 출처여야 합니다.');
  }
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
  const validNumber = (value: unknown): boolean =>
    value === undefined || (typeof value === 'number' && Number.isFinite(value));
  const responseBody = record(body) ? body : null;
  const valid =
    responseBody !== null &&
    validNumber(responseBody.code) &&
    validNumber(responseBody.result_code);
  const code = valid ? (responseBody.code as number | undefined) : undefined;
  const resultCode = valid ? (responseBody.result_code as number | undefined) : undefined;
  const detail: string = `카카오 메시지 API HTTP ${response.status}, code=${String(code)}, result_code=${valid ? String(resultCode) : 'invalid'}; payload_title=${payload.content.title}`;
  if (response.ok && valid && resultCode === 0)
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
    !valid ||
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
    throw tokenError(
      'configuration',
      'KAKAO_CONFIG',
      503,
      '카카오 REST API 키와 Client Secret을 설정하세요.',
      null,
      null,
      null,
      null,
    );
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
    throw tokenError(
      'uncertain',
      'TOKEN_UNCERTAIN',
      502,
      '토큰 응답이 유실되어 회전 여부를 알 수 없습니다. 자동 재시도하지 않습니다. 카카오를 다시 연결하세요.',
      null,
      null,
      null,
      null,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw tokenError(
      'uncertain',
      'TOKEN_RESPONSE',
      502,
      `토큰 API HTTP ${response.status}: 응답을 해석하지 못했습니다. 카카오를 다시 연결하세요.`,
      response.status,
      null,
      null,
      null,
    );
  }
  if (!response.ok) {
    const reason = tokenErrorSchema.safeParse(body);
    const providerError: string | null = reason.success ? reason.data.error : null;
    const providerCode: string | null = reason.success ? (reason.data.error_code ?? null) : null;
    const detail: string = `토큰 API HTTP ${response.status}, error=${providerError ?? 'invalid_response'}, code=${providerCode ?? 'none'}.`;
    if (
      (response.status === 503 && providerError === 'temporarily_unavailable') ||
      ([400, 429].includes(response.status) &&
        providerError === 'invalid_request' &&
        providerCode === 'KOE237')
    )
      throw tokenError(
        'transient',
        'TOKEN_TEMPORARY',
        response.status,
        `${detail} 일시 오류로 갱신을 잠시 미룹니다.`,
        response.status,
        providerError,
        providerCode,
        null,
      );
    if (
      [400, 401].includes(response.status) &&
      providerError === 'invalid_grant' &&
      (providerCode === null ||
        providerCode === 'KOE322' ||
        (params.get('grant_type') === 'authorization_code' && providerCode === 'KOE320'))
    )
      throw tokenError(
        'invalid',
        'TOKEN_REJECTED',
        response.status,
        `${detail} 인증이 유효하지 않습니다. 카카오를 다시 연결하세요.`,
        response.status,
        providerError,
        providerCode,
        null,
      );
    if (response.status >= 400 && response.status < 500 && reason.success)
      throw tokenError(
        'configuration',
        'TOKEN_CONFIGURATION',
        response.status,
        `${detail} 카카오 앱 설정과 요청 구성을 확인하세요.`,
        response.status,
        providerError,
        providerCode,
        null,
      );
    throw tokenError(
      'uncertain',
      'TOKEN_UNCERTAIN',
      response.status,
      `${detail} 처리 결과를 확정할 수 없어 자동 재시도하지 않습니다. 카카오를 다시 연결하세요.`,
      response.status,
      providerError,
      providerCode,
      null,
    );
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success)
    throw tokenError(
      'uncertain',
      'TOKEN_RESPONSE',
      502,
      '토큰 응답 필드가 누락되었습니다. 카카오를 다시 연결하세요.',
      response.status,
      null,
      null,
      null,
    );
  return parsed.data;
}
export async function kakaoOwner(token: string, transport: Transport): Promise<string> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await transport('https://kapi.kakao.com/v2/user/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error: unknown) {
      if (attempt === 3) throw error;
      console.warn({
        event: 'owner_lookup_retry',
        attempt,
        error_type: error instanceof Error ? error.name : 'unknown',
      });
      continue;
    }
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
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw appError(
        502,
        'OWNER_RESPONSE',
        `사용자 조회 HTTP ${response.status}: JSON 응답을 해석하지 못했습니다.`,
      );
    }
    const parsed = ownerSchema.safeParse(body);
    if (!parsed.success)
      throw appError(502, 'OWNER_RESPONSE', '사용자 조회 응답에 올바른 운영자 ID가 없습니다.');
    return String(parsed.data.id);
  }
  throw appError(502, 'OWNER_LOOKUP', '사용자 조회 재시도 한도에 도달했습니다.');
}
