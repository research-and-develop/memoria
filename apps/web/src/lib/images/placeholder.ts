import { IMAGE_MATTE } from '@repo/ui/theme/pipeline';

import { asSource, createOffscreenCanvas, painter, release, type CreateCanvas, type Surface } from './canvas';

/**
 * The placeholder colour shown while a thumbnail loads (plan p05 D5.5): the average colour of an
 * 8 px copy. Transparent pixels are composited on `IMAGE_MATTE` (white: what a JPEG fallback shows).
 */

export const PLACEHOLDER_PX = 8;

const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

/** The average of RGBA pixels as `#rrggbb`, alpha composited on the matte. */
export function averageColor(pixels: Uint8ClampedArray, w: number, h: number): string {
  const [mr = 255, mg = 255, mb = 255] = IMAGE_MATTE.rgb;
  const count = w * h;
  if (count === 0 || pixels.length < count * 4) return `#${hex(mr)}${hex(mg)}${hex(mb)}`;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < count * 4; i += 4) {
    const a = (pixels[i + 3] ?? 255) / 255;
    r += (pixels[i] ?? 0) * a + mr * (1 - a);
    g += (pixels[i + 1] ?? 0) * a + mg * (1 - a);
    b += (pixels[i + 2] ?? 0) * a + mb * (1 - a);
  }
  return `#${hex(r / count)}${hex(g / count)}${hex(b / count)}`;
}

/** Draw `source` at 8 px on its long edge and average it. */
export function placeholderColor(source: Surface, createCanvas: CreateCanvas = createOffscreenCanvas): string {
  const scale = PLACEHOLDER_PX / Math.max(source.width, source.height, 1);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = createCanvas(w, h);
  try {
    const ctx = painter(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(asSource(source), 0, 0, w, h);
    return averageColor(ctx.getImageData(0, 0, w, h).data, w, h);
  } finally {
    release(canvas);
  }
}
