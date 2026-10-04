import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-wasm';
import { packPng, pngScanlines } from './native-png';
import { validatePng } from '../../src/worker/png';

// Workers supports node:zlib. Lower compression effort changes the file size,
// not dimensions, colors, text quality or decoded pixels. Lab only.
export function fastPng(pixels: Uint8Array): Uint8Array<ArrayBuffer> {
  return packPng(deflateSync(pngScanlines(pixels), { level: 1 }));
}

export function rasterizeFast(svg: string): Uint8Array<ArrayBuffer> {
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    const rendered = renderer.render();
    try {
      const png = fastPng(rendered.pixels);
      validatePng(png);
      return png;
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
}
