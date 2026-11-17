import { WATERMARK_FONTS, WATERMARK_INKS } from '@repo/ui/theme/watermark';

import type { Placement, TextWatermark, Watermark } from '@/lib/settings/parseWatermarkInput';

/**
 * The watermark drawn into a photo (plan p04 D4.10): the SAME function previews it in Settings →
 * Watermarks and bakes it into display copies in Phase 5's upload worker, so what the photographer
 * sees is what gets baked. Browser code with no React and no DOM beyond the 2D context: it runs on
 * an `OffscreenCanvas` in a Web Worker as well as on a page's `<canvas>`.
 *
 * `watermarkBox` is pure geometry (table-tested); `applyWatermark` draws; `loadWatermarkAssets`
 * fetches and decodes an image mark once per upload session.
 */

export type Size = { w: number; h: number };
export type Box = { x: number; y: number; w: number; h: number };
export type WatermarkAssets = { bitmap: ImageBitmap | null };
type Context2D = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'drawImage' | 'fillText' | 'measureText' | 'globalAlpha' | 'font' | 'fillStyle' | 'shadowColor' | 'shadowOffsetX' | 'shadowOffsetY' | 'shadowBlur' | 'textBaseline'
>;

/** Text is measured at this size, then scaled so its width matches the box. */
export const TEXT_REFERENCE_PX = 100;
/** A text box's height per font pixel (the line box of the fixed font lists). */
export const TEXT_LINE_HEIGHT = 1.2;
/** Tiling never draws more marks than this (the mark is enlarged until the count fits). */
export const MAX_TILES = 200;

/**
 * Where the mark goes: one box for an anchor, a grid of boxes when tiled.
 * - The mark's width is `size` % of the photo's long edge, its height follows its aspect; a mark that
 *   would not fit is scaled down to fit.
 * - The margin is `margin` % of the short edge, from the anchored edges (ignored when tiled).
 * - Tiled: steps of 2w × 2.5h, every other row offset by w, starting at (−w, −h) so the edges are
 *   covered; at most `MAX_TILES` boxes.
 */
export function watermarkBox(photo: Size, mark: Size, placement: Placement): Box[] {
  const long = Math.max(photo.w, photo.h);
  const short = Math.min(photo.w, photo.h);
  let w = Math.round((long * placement.size) / 100);
  let h = Math.round((w * mark.h) / mark.w);
  if (w > photo.w || h > photo.h) {
    const fit = Math.min(photo.w / w, photo.h / h);
    w = Math.round(w * fit);
    h = Math.round(h * fit);
  }
  w = Math.max(1, w);
  h = Math.max(1, h);
  if (placement.position === 'tiled') return tiles(photo, w, h);

  const m = Math.round((short * placement.margin) / 100);
  const [row, col] = anchorParts(placement.position);
  const along = (side: 'start' | 'middle' | 'end', total: number, size: number) => {
    const at = side === 'start' ? m : side === 'end' ? total - size - m : Math.round((total - size) / 2);
    return Math.min(Math.max(at, 0), total - size);
  };
  return [{ x: along(col, photo.w, w), y: along(row, photo.h, h), w, h }];
}

function anchorParts(position: Exclude<Placement['position'], 'tiled'>): ['start' | 'middle' | 'end', 'start' | 'middle' | 'end'] {
  const row = position.startsWith('top') ? 'start' : position.startsWith('bottom') ? 'end' : 'middle';
  const col = position.endsWith('left') ? 'start' : position.endsWith('right') ? 'end' : 'middle';
  return [row, col];
}

function tiles(photo: Size, w0: number, h0: number): Box[] {
  let w = w0;
  let h = h0;
  for (;;) {
    const boxes: Box[] = [];
    const stepX = 2 * w;
    const stepY = Math.round(2.5 * h);
    for (let y = -h, row = 0; y < photo.h; y += stepY, row++) {
      for (let x = -w + (row % 2 === 1 ? w : 0); x < photo.w; x += stepX) boxes.push({ x, y, w, h });
    }
    if (boxes.length <= MAX_TILES) return boxes;
    w = Math.ceil(w * 1.1);
    h = Math.ceil(h * 1.1);
  }
}

/** The CSS font of a text mark at a size. */
export function watermarkFont(watermark: Pick<TextWatermark, 'font'>, px: number): string {
  return `${px}px ${WATERMARK_FONTS[watermark.font]}`;
}

/** Draw the watermark onto a photo already drawn on `ctx` (which is restored afterwards). */
export function applyWatermark(ctx: Context2D, photo: Size, watermark: Exclude<Watermark, { kind: 'none' }>, assets: WatermarkAssets): void {
  ctx.save();
  try {
    ctx.globalAlpha = watermark.opacity / 100;
    if (watermark.kind === 'image') {
      const bitmap = assets.bitmap;
      if (!bitmap) return;
      for (const box of watermarkBox(photo, { w: bitmap.width, h: bitmap.height }, watermark)) ctx.drawImage(bitmap, box.x, box.y, box.w, box.h);
      return;
    }
    ctx.font = watermarkFont(watermark, TEXT_REFERENCE_PX);
    const measured = Math.max(1, ctx.measureText(watermark.text).width);
    const ink = WATERMARK_INKS[watermark.ink];
    ctx.fillStyle = ink.fill;
    ctx.shadowColor = ink.shadow;
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'top';
    for (const box of watermarkBox(photo, { w: measured, h: TEXT_REFERENCE_PX * TEXT_LINE_HEIGHT }, watermark)) {
      const fontPx = (TEXT_REFERENCE_PX * box.w) / measured;
      const offset = Math.max(1, Math.round(fontPx / 24));
      ctx.font = watermarkFont(watermark, fontPx);
      ctx.shadowOffsetX = offset;
      ctx.shadowOffsetY = offset;
      ctx.fillText(watermark.text, box.x, box.y + ((TEXT_LINE_HEIGHT - 1) / 2) * fontPx);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Fetch and decode an image watermark once per upload session, pre-scaled to the largest size it can
 * be drawn at (`maxLongEdge`, the display copy's long edge, × size %) so no worker holds a 64 MB
 * bitmap (D4.9). Text and none need nothing. The image comes from the public media domain (CORS) or
 * the development read route.
 */
export async function loadWatermarkAssets(watermark: Watermark, url: string | null, opts: { maxLongEdge?: number; signal?: AbortSignal } = {}): Promise<WatermarkAssets> {
  if (watermark.kind !== 'image' || !url) return { bitmap: null };
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: opts.signal });
  if (!res.ok) throw new Error(`watermark image: HTTP ${res.status}`);
  const blob = await res.blob();
  const target = opts.maxLongEdge ? Math.ceil((opts.maxLongEdge * watermark.size) / 100) : null;
  if (target && watermark.width > target) {
    return { bitmap: await createImageBitmap(blob, { resizeWidth: target, resizeHeight: Math.max(1, Math.round((target * watermark.height) / watermark.width)), resizeQuality: 'high' }) };
  }
  return { bitmap: await createImageBitmap(blob) };
}
