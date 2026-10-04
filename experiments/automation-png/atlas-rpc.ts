import { fixtures, atlasCoverageCard } from './fixtures';
import {
  assembleAtlasBundle,
  maxAssemblyBytes,
  packAtlasBundle,
  pipelinePlan,
  preparePipelineFrame,
  type PipelineRuntime,
} from './atlas-pipeline';
import { validateAtlasChunkEnvelope } from './atlas-chunks';
import { probeAuthorization } from './probe';

export type RpcSize = '800' | '720';
export type RpcRuntimes = Record<RpcSize, PipelineRuntime>;
// Value-only RPC: no callbacks, RpcTarget, arbitrary paths, text, or URLs.
export interface AtlasRpc {
  glyphs(size: RpcSize, fixture: string, index: number): Promise<ArrayBuffer>;
  assemble(size: RpcSize, fixture: string, bundle: ArrayBuffer): Promise<ArrayBuffer>;
}
const cards = { ...fixtures, coverage: atlasCoverageCard };
function parameters(size: unknown, fixture: unknown, runtimes: RpcRuntimes) {
  if (
    (size !== '800' && size !== '720') ||
    typeof fixture !== 'string' ||
    !Object.hasOwn(cards, fixture)
  )
    throw new RangeError('Invalid fixed fixture');
  return { runtime: runtimes[size], card: cards[fixture as keyof typeof cards] };
}
export function boundedRpcBytes(value: unknown, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (!(value instanceof ArrayBuffer) || value.byteLength === 0 || value.byteLength > maxBytes)
    throw new RangeError('Invalid binary RPC value');
  return new Uint8Array(value);
}
// Exact view only: never expose unrelated bytes preceding/following a subarray.
function exactBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
}
export function createAtlasRpc(runtimes: RpcRuntimes) {
  return {
    async glyphs(size: unknown, fixture: unknown, index: unknown, assets: Fetcher) {
      const { runtime, card } = parameters(size, fixture, runtimes);
      if (typeof index !== 'number' || !Number.isInteger(index))
        throw new RangeError('Invalid glyph index');
      const frame = await preparePipelineFrame(
        pipelinePlan(card, runtime),
        runtime,
        index,
        assets,
        `/${size}`,
      );
      return exactBuffer(frame); // packAtlasChunk enforces the 1MiB producer limit.
    },
    assemble(size: unknown, fixture: unknown, bundle: unknown) {
      const { runtime, card } = parameters(size, fixture, runtimes);
      const png = assembleAtlasBundle(card, runtime, boundedRpcBytes(bundle, maxAssemblyBytes));
      if (png.byteLength > 1048576) throw new RangeError('PNG output too large');
      return exactBuffer(png); // Existing assembler validates glyphs and the PNG.
    },
  };
}
export function createRpcProbe(runtimes: RpcRuntimes) {
  return {
    async fetch(request: Request, env: { RENDERER: AtlasRpc; BENCH_TOKEN: string }) {
      const denied = probeAuthorization(request, env);
      if (denied) return denied;
      const url = new URL(request.url);
      const match =
        /^\/probe\/(expression|comparison|long|long_comparison|coverage)\/atlas_rpc(800|720)$/.exec(
          url.pathname,
        );
      if (!match || url.search) return new Response('Not found', { status: 404 });
      const fixture = match[1]!,
        size = match[2] as RpcSize;
      try {
        const { runtime, card } = parameters(size, fixture, runtimes);
        const plan = pipelinePlan(card, runtime);
        const frames: Uint8Array[] = [];
        let totalBytes = 8;
        for (let index = 0; index < plan.chunks.length; index++) {
          const frame = boundedRpcBytes(
            await env.RENDERER.glyphs(size, fixture, index),
            Math.min(1048576, maxAssemblyBytes - totalBytes - 4),
          );
          validateAtlasChunkEnvelope(frame, index, plan.chunks.length);
          totalBytes += 4 + frame.byteLength;
          frames.push(frame);
        }
        const bundle = packAtlasBundle(frames);
        const png = boundedRpcBytes(
          await env.RENDERER.assemble(size, fixture, bundle.buffer),
          1048576,
        );
        return new Response(png, {
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
