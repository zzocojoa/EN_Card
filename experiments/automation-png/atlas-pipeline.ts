import type { CardInput } from '../../src/shared/model';
import { atlasPngPrepared, type Atlas, type AtlasRenderOptions } from './atlas';
import {
  atlasAdvance,
  planCardAtlas,
  type AtlasPageSize,
  type decodeAtlasPage,
} from './atlas-pages';
import {
  atlasChunks,
  loadAtlasChunk,
  maxAtlasChunks,
  mergeAtlases,
  jsonAtlasChunkCodec,
  type AtlasChunkCodec,
  selectAtlas,
} from './atlas-chunks';
import { fixtures, atlasCoverageCard } from './fixtures';
import { probeAuthorization } from './probe';
import { referenceAtlases } from './atlas-reference';

export const pipelineChunkSize = 2;
export const maxAssemblyBytes = 4 * 1048576;
export type PipelineOptions = AtlasRenderOptions & {
  slots?: AtlasPageSize;
  compactRead?: boolean;
  chunkSize?: number;
  chunkCodec?: AtlasChunkCodec;
  pageDecoder?: typeof decodeAtlasPage;
  referencePixels?: boolean;
};
export type PipelineRuntime = {
  advance: ReturnType<typeof atlasAdvance>;
  common: Atlas;
  options?: PipelineOptions;
};
type Runtime = PipelineRuntime;
const cards: typeof fixtures = { ...fixtures, coverage: atlasCoverageCard };

export function pipelinePlan(card: CardInput, runtime: Runtime) {
  const plan = planCardAtlas(card, runtime.advance, 1, runtime.common, runtime.options?.slots);
  return {
    ...plan,
    chunks: atlasChunks(
      plan.pages,
      runtime.options?.chunkSize ?? pipelineChunkSize,
      runtime.options?.slots,
    ),
  };
}
// Shared computation for the HTTP baseline and RPC candidate. Transport only
// wraps the returned frame; page reads and all glyph validation stay identical.
export async function preparePipelineFrame(
  plan: ReturnType<typeof pipelinePlan>,
  runtime: Runtime,
  index: number,
  assets: Fetcher,
  assetPrefix = '',
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(index) || index < 0 || index >= plan.chunks.length)
    throw new RangeError('글자 묶음 인덱스 오류');
  const atlas = await loadAtlasChunk(
    plan.chunks[index]!,
    async (name) => {
      const response = await assets.fetch(`https://atlas.internal${assetPrefix}/${name}`);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Atlas unavailable');
      }
      return readBoundedBody(response, 4 * 1048576, runtime.options?.compactRead);
    },
    runtime.options?.slots,
    runtime.options?.pageDecoder,
  );
  return (runtime.options?.chunkCodec ?? jsonAtlasChunkCodec).pack(
    atlas,
    index,
    plan.chunks.length,
  );
}
// Both request and response streams are bounded even without Content-Length.
export async function readBoundedBody(
  message: Request | Response,
  maxBytes: number,
  compact = false,
): Promise<Uint8Array<ArrayBuffer>> {
  if (compact) return readCompactBody(message, maxBytes);
  if (Number(message.headers.get('Content-Length')) > maxBytes) {
    await message.body?.cancel();
    throw new RangeError('본문 크기 초과');
  }
  const reader = message.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RangeError('본문 크기 초과');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
// Avoid the final full-body copy for single-chunk streams. For multi-chunk bodies
// use a bounded growing buffer; Content-Length is only an allocation hint. Check
// actual bytes even when headers are absent, malformed or deliberately too small.
async function readCompactBody(
  message: Request | Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const hint = Number(message.headers.get('Content-Length'));
  if (hint > maxBytes) {
    await message.body?.cancel();
    throw new RangeError('본문 크기 초과');
  }
  const reader = message.body?.getReader();
  if (!reader) return new Uint8Array();
  let buffer: Uint8Array<ArrayBuffer> | undefined;
  let length = 0;
  let borrowed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > maxBytes) {
        await reader.cancel();
        throw new RangeError('본문 크기 초과');
      }
      if (!buffer) {
        buffer = value;
        length = value.length;
        borrowed = true;
        continue;
      }
      if (borrowed || length + value.length > buffer.length) {
        const capacity = Math.min(
          maxBytes,
          Math.max(
            length + value.length,
            buffer.length * 2,
            Number.isSafeInteger(hint) && hint > 0 ? hint : 0,
          ),
        );
        const next = new Uint8Array(capacity);
        next.set(buffer.subarray(0, length));
        buffer = next;
        borrowed = false;
      }
      buffer.set(value, length);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return buffer ? buffer.subarray(0, length) : new Uint8Array();
}
export function packAtlasBundle(
  frames: Uint8Array[],
  codec: AtlasChunkCodec = jsonAtlasChunkCodec,
): Uint8Array<ArrayBuffer> {
  if (frames.length > maxAtlasChunks) throw new RangeError('조립 묶음 개수 오류');
  const size = 8 + frames.reduce((sum, frame) => sum + 4 + frame.length, 0);
  if (size > maxAssemblyBytes) throw new RangeError('조립 본문 용량 초과');
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x41544231); // ATB1: count, reserved zero, length-prefixed frames
  view.setUint16(4, frames.length);
  let offset = 8;
  for (const [index, frame] of frames.entries()) {
    codec.envelope(frame, index, frames.length);
    view.setUint32(offset, frame.length);
    result.set(frame, offset + 4);
    offset += 4 + frame.length;
  }
  return result;
}
export function unpackAtlasBundle(
  bytes: Uint8Array,
  count: number,
  codec: AtlasChunkCodec = jsonAtlasChunkCodec,
): Uint8Array[] {
  if (bytes.length < 8 || bytes.length > maxAssemblyBytes)
    throw new RangeError('조립 본문 크기 오류');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    count < 0 ||
    count > maxAtlasChunks ||
    view.getUint32(0) !== 0x41544231 ||
    view.getUint16(4) !== count ||
    view.getUint16(6) !== 0
  )
    throw new RangeError('조립 본문 형식 오류');
  const frames = [];
  let offset = 8;
  for (let index = 0; index < count; index++) {
    if (offset + 4 > bytes.length) throw new RangeError('조립 응답 누락');
    const length = view.getUint32(offset);
    offset += 4;
    if (length < 12 || length > 1048576 || offset + length > bytes.length)
      throw new RangeError('조립 응답 범위 오류');
    const frame = bytes.subarray(offset, offset + length);
    codec.envelope(frame, index, count);
    frames.push(frame);
    offset += length;
  }
  if (offset !== bytes.length) throw new RangeError('조립 본문 잔여 데이터');
  return frames;
}
export function assembleAtlasBundle(card: CardInput, runtime: Runtime, bytes: Uint8Array) {
  const plan = pipelinePlan(card, runtime);
  const codec = runtime.options?.chunkCodec ?? jsonAtlasChunkCodec;
  const frames = unpackAtlasBundle(bytes, plan.chunks.length, codec);
  const parts = [selectAtlas(runtime.common, plan.commonKeys)];
  for (const [index, chunk] of plan.chunks.entries())
    parts.push(
      codec.unpack(
        frames[index]!,
        index,
        frames.length,
        new Set(chunk.flatMap(([, keys]) => [...keys])),
      ),
    );
  const atlas = runtime.options?.referencePixels
    ? referenceAtlases(parts, runtime.advance)
    : mergeAtlases(parts, runtime.advance);
  return atlasPngPrepared(plan.prepared, atlas, runtime.options);
}

// Private fixed-fixture service. No arbitrary input, URL, file path or storage.
export function createPipelineWorker(
  runtime: Runtime,
  routing: { prefix?: string; assetPrefix?: string } = {},
) {
  return {
    async fetch(request: Request, env: { ATLAS_ASSETS: Fetcher }): Promise<Response> {
      const url = new URL(request.url);
      const prefix = routing.prefix ?? '';
      if (!url.pathname.startsWith(prefix + '/')) return new Response('Not found', { status: 404 });
      const path = url.pathname.slice(prefix.length);
      const match =
        /^\/pipeline\/(glyphs|assemble)\/(expression|comparison|long|long_comparison|coverage)(?:\/(\d+))?$/.exec(
          path,
        );
      if (!match || url.search) return new Response('Not found', { status: 404 });
      const assemble = match[1] === 'assemble';
      if ((assemble && match[3] !== undefined) || (!assemble && match[3] === undefined))
        return new Response('Not found', { status: 404 });
      if (request.method !== (assemble ? 'POST' : 'GET'))
        return new Response('Method not allowed', { status: 405 });
      const card = cards[match[2]!]!;
      try {
        if (assemble) {
          const png = assembleAtlasBundle(
            card,
            runtime,
            await readBoundedBody(request, maxAssemblyBytes, runtime.options?.compactRead),
          );
          return new Response(png, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
          });
        }
        const plan = pipelinePlan(card, runtime);
        const index = Number(match[3]);
        if (!Number.isInteger(index) || index < 0 || index >= plan.chunks.length)
          return new Response('Not found', { status: 404 });
        const frame = await preparePipelineFrame(
          plan,
          runtime,
          index,
          env.ATLAS_ASSETS,
          routing.assetPrefix,
        );
        return new Response(frame, {
          headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
        });
      } catch {
        return new Response(assemble ? 'Invalid assembly input' : 'Glyph preparation failed', {
          status: assemble ? 400 : 502,
        });
      }
    },
  };
}
// The authenticated collector only checks envelopes and relays bounded frames.
// Full glyph validation and PNG generation occur in one separate invocation.
export function createPipelineProbe(
  runtime: Runtime,
  routing: { encoder?: string; rendererPrefix?: string } = {},
) {
  return {
    async fetch(
      request: Request,
      env: { RENDERER: Fetcher; BENCH_TOKEN: string },
    ): Promise<Response> {
      const denied = probeAuthorization(request, env);
      if (denied) return denied;
      const url = new URL(request.url);
      const match =
        /^\/probe\/(expression|comparison|long|long_comparison|coverage)\/([a-z_0-9]+)$/.exec(
          url.pathname,
        );
      if (!match || match[2] !== (routing.encoder ?? 'atlas_pipeline') || url.search)
        return new Response('Not found', { status: 404 });
      const plan = pipelinePlan(cards[match[1]!]!, runtime);
      const frames = [];
      let totalBytes = 8;
      try {
        for (let index = 0; index < plan.chunks.length; index++) {
          const response = await env.RENDERER.fetch(
            `https://png.internal${routing.rendererPrefix ?? ''}/pipeline/glyphs/${match[1]}/${index}`,
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('Glyph preparation failed');
          }
          const frame = await readBoundedBody(
            response,
            Math.min(1048576, maxAssemblyBytes - totalBytes - 4),
            runtime.options?.compactRead,
          );
          (runtime.options?.chunkCodec ?? jsonAtlasChunkCodec).envelope(
            frame,
            index,
            plan.chunks.length,
          );
          totalBytes += 4 + frame.length;
          frames.push(frame);
        }
        const response = await env.RENDERER.fetch(
          `https://png.internal${routing.rendererPrefix ?? ''}/pipeline/assemble/${match[1]}`,
          {
            method: 'POST',
            body: packAtlasBundle(frames, runtime.options?.chunkCodec),
            headers: { 'Content-Type': 'application/octet-stream' },
          },
        );
        if (!response.ok || response.headers.get('Content-Type') !== 'image/png') {
          await response.body?.cancel();
          throw new Error('Assembly failed');
        }
        return new Response(response.body, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'X-Atlas-Chunks': String(plan.chunks.length),
            'X-Atlas-Pages': String(plan.pages.size),
          },
        });
      } catch {
        return new Response('PNG pipeline failed', { status: 502 });
      }
    },
  };
}
