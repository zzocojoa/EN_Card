import { LIMITS, cardSchema, type CardInput } from '../shared/model';
import { validatePng } from './png';
import { kstDate } from '../shared/time';
import { appError, type Env } from './types';
export { validatePng } from './png';

export async function readBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared: string | null = request.headers.get('Content-Length');
  if (declared && Number(declared) > max)
    throw appError(413, 'BODY_LIMIT', `요청 크기는 ${max}바이트 이하여야 합니다.`);
  if (!request.body) throw appError(400, 'BODY_MISSING', '요청 본문이 없습니다.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total: number = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw appError(413, 'BODY_LIMIT', `요청 크기는 ${max}바이트 이하여야 합니다.`);
    }
    chunks.push(item.value);
  }
  const output: Uint8Array<ArrayBuffer> = new Uint8Array(total);
  let offset: number = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.includes('application/json'))
    throw appError(415, 'JSON_REQUIRED', 'application/json 본문이 필요합니다.');
  try {
    return JSON.parse(
      new TextDecoder().decode(await readBody(request, LIMITS.jsonBytes)),
    ) as unknown;
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      throw appError(400, 'JSON_INVALID', 'JSON 문법을 확인하세요.');
    throw error;
  }
}
export async function retainUploadCleanup(assetId: string, env: Pick<Env, 'DB'>): Promise<void> {
  await env.DB.prepare(
    "UPDATE assets SET state='cleanup_needed',cleanup_owner=NULL WHERE id=? AND state!='ready'",
  )
    .bind(assetId)
    .run();
}
function uploadFailure(assetId: string, error: unknown): Error {
  console.warn({
    event: 'image_upload_failed',
    asset_id: assetId,
    error_type: error instanceof Error ? error.name : 'unknown',
  });
  return appError(
    503,
    'IMAGE_UPLOAD',
    `이미지 저장을 완료하지 못했습니다. 저장량 화면에서 미완료 이미지 ${assetId}를 정리한 뒤 다시 시도하세요.`,
  );
}
export async function uploadImage(
  request: Request,
  cardId: string,
  env: Env,
  now: number,
): Promise<Response> {
  const revision: number = Number(request.headers.get('X-Card-Revision'));
  const bytes: Uint8Array<ArrayBuffer> = await readBody(request, LIMITS.imageBytes);
  validatePng(bytes);
  const card = await env.DB.prepare('SELECT content FROM cards WHERE id=? AND revision=?')
    .bind(cardId, revision)
    .first<{ content: string }>();
  if (!card)
    throw appError(409, 'CARD_CHANGED', '카드가 수정되었습니다. 최신 카드로 PNG를 다시 만드세요.');
  const id: string = crypto.randomUUID();
  const publicId: string =
    crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const reserved = await env.DB.prepare(
    "INSERT INTO assets(id,card_id,revision,snapshot,kv_key,public_id,bytes,state,created_at,usage_day) SELECT ?,id,revision,content,?,?,?,'uploading',?,? FROM cards WHERE id=? AND revision=? RETURNING id",
  )
    .bind(id, id, publicId, bytes.length, now, kstDate(now), cardId, revision)
    .first<{ id: string }>();
  if (!reserved) throw appError(409, 'CARD_CHANGED', '업로드 중 카드가 수정되었습니다.');
  let completed: { id: string } | null;
  try {
    await env.CARD_IMAGES.put(id, bytes);
    completed = await env.DB.prepare(
      "UPDATE assets SET state='ready' WHERE id=? AND state='uploading' RETURNING id",
    )
      .bind(id)
      .first<{ id: string }>();
  } catch (error: unknown) {
    await retainUploadCleanup(id, env);
    throw uploadFailure(id, error);
  }
  if (!completed) {
    await retainUploadCleanup(id, env);
    try {
      await deleteImage(id, env, now);
    } catch (error: unknown) {
      throw uploadFailure(id, error);
    }
    throw appError(
      409,
      'IMAGE_UPLOAD_CANCELLED',
      '저장 중 이미지 정리가 요청되어 업로드를 취소했습니다. 다시 저장하세요.',
    );
  }
  return Response.json({ id, public_id: publicId, bytes: bytes.length, created_at: now });
}
export async function reviewCard(
  cardId: string,
  assetId: string,
  revision: number,
  env: Env,
): Promise<void> {
  const result = await env.DB.prepare(
    "UPDATE cards SET status='ready',asset_id=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM assets WHERE id=? AND card_id=? AND revision=? AND state='ready') RETURNING id",
  )
    .bind(assetId, cardId, revision, assetId, cardId, revision)
    .first<{ id: string }>();
  if (!result)
    throw appError(
      409,
      'REVIEW_CONFLICT',
      '최신 카드와 저장된 PNG를 확인한 뒤 검토 완료를 눌러주세요.',
    );
}
export async function deleteImage(
  assetId: string,
  env: Pick<Env, 'DB' | 'CARD_IMAGES'>,
  now: number,
): Promise<void> {
  const owner: string = crypto.randomUUID();
  const row = await env.DB.prepare(
    "UPDATE assets SET state='deleting',cleanup_owner=? WHERE id=? AND state!='deleted' AND (state!='uploading' OR created_at<?) RETURNING kv_key",
  )
    .bind(owner, assetId, now - 300_000)
    .first<{ kv_key: string }>();
  if (!row)
    throw appError(
      409,
      'ASSET_NOT_READY_TO_DELETE',
      '이미지가 없거나 업로드 중입니다. 업로드가 중단됐다면 5분 뒤 정리를 시도하세요.',
    );
  await env.CARD_IMAGES.delete(row.kv_key);
  await env.DB.prepare(
    "UPDATE assets SET state='deleted',cleanup_owner=NULL WHERE id=? AND state='deleting' AND cleanup_owner=?",
  )
    .bind(assetId, owner)
    .run();
}
export async function publicImage(publicId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT kv_key,bytes FROM assets WHERE public_id=? AND state='ready'",
  )
    .bind(publicId)
    .first<{ kv_key: string; bytes: number }>();
  if (!row) throw appError(404, 'IMAGE_NOT_FOUND', '이미지를 찾을 수 없습니다.');
  const image: ArrayBuffer | null = await env.CARD_IMAGES.get(row.kv_key, 'arrayBuffer');
  if (!image)
    throw appError(
      503,
      'IMAGE_PROPAGATING',
      '이미지 전파 중이거나 저장소가 응답하지 않습니다. 잠시 후 다시 시도하세요.',
    );
  return new Response(image, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(image.byteLength),
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function saveCard(
  input: unknown,
  id: string | null,
  revision: number | null,
  env: Env,
  now: number,
): Promise<{ id: string; revision: number }> {
  const content: CardInput = cardSchema.parse(input);
  if (!id) {
    const newId: string = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,'draft',?)",
    )
      .bind(newId, JSON.stringify(content), now)
      .run();
    return { id: newId, revision: 1 };
  }
  const updated = await env.DB.prepare(
    "UPDATE cards SET content=?,revision=revision+1,status='draft',asset_id=NULL WHERE id=? AND revision=? RETURNING id,revision",
  )
    .bind(JSON.stringify(content), id, revision)
    .first<{ id: string; revision: number }>();
  if (!updated)
    throw appError(409, 'CARD_CHANGED', '다른 탭에서 수정된 카드입니다. 목록을 새로 불러오세요.');
  return updated;
}
