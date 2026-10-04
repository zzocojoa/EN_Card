import { Resvg } from '@resvg/resvg-wasm';
import { validatePng } from '../../src/worker/png';
import { nativePng } from './native-png';

export function rasterize(svg: string): Uint8Array<ArrayBuffer> {
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  try {
    const rendered = renderer.render();
    try {
      const png = new Uint8Array(rendered.asPng());
      validatePng(png);
      return png;
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
}

export async function rasterizeNative(svg: string): Promise<Uint8Array<ArrayBuffer>> {
  const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
  let pixels: Uint8Array;
  try {
    const rendered = renderer.render();
    try {
      pixels = rendered.pixels;
    } finally {
      rendered.free();
    }
  } finally {
    renderer.free();
  }
  const png = await nativePng(pixels);
  validatePng(png);
  return png;
}
