import { asSource, createOffscreenCanvas, painter, release, type CreateCanvas, type Surface } from './canvas';

/**
 * Downscaling for the thumbnail and the display copy (plan p05 D5.5): `drawImage` on an
 * `OffscreenCanvas` with high-quality smoothing, halving in steps while the ratio is above 2 (one
 * big jump skips source pixels and aliases in some browsers). Never upscales.
 */

export type Size = { w: number; h: number };

/** The size whose long edge is `longEdge`, keeping the aspect; the source size when it is smaller. */
export function targetSize(w: number, h: number, longEdge: number): Size {
  const long = Math.max(w, h);
  if (long <= longEdge) return { w, h };
  const scale = longEdge / long;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** The sizes drawn in turn: halvings while more than 2× the target remains, then the target itself. */
export function stepPlan(from: Size, to: Size): Size[] {
  const steps: Size[] = [];
  let { w, h } = from;
  while (w / to.w > 2 && h / to.h > 2) {
    w = Math.max(to.w, Math.round(w / 2));
    h = Math.max(to.h, Math.round(h / 2));
    steps.push({ w, h });
  }
  steps.push(to);
  return steps;
}

/** `source` drawn at `size` through `stepPlan`; intermediate canvases are released. */
export function drawResized(source: Surface | ImageBitmap, size: Size, createCanvas: CreateCanvas = createOffscreenCanvas): Surface {
  let current: Surface | ImageBitmap = source;
  for (const step of stepPlan({ w: source.width, h: source.height }, size)) {
    const canvas = createCanvas(step.w, step.h);
    const ctx = painter(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(asSource(current), 0, 0, step.w, step.h);
    if (current !== source) release(current as Surface);
    current = canvas;
  }
  return current as Surface;
}
