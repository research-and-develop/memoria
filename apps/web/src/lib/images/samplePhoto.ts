import { WATERMARK_SAMPLE } from '@repo/ui/theme/watermark';

type Context2D = Pick<CanvasRenderingContext2D, 'createLinearGradient' | 'fillRect' | 'fillStyle' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'arc'>;

/**
 * The sample photo Settings → Watermarks previews on (plan p04: generated at runtime, no binary
 * asset): a dusk sky, a low sun and three ranges of hills, so a watermark can be judged on light and
 * dark areas. 1600 × 1067 or 1067 × 1600.
 */
export function drawSamplePhoto(ctx: Context2D, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  WATERMARK_SAMPLE.sky.forEach((colour, i) => sky.addColorStop(i / (WATERMARK_SAMPLE.sky.length - 1), colour));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = WATERMARK_SAMPLE.sun;
  ctx.beginPath();
  ctx.arc(w * 0.68, h * 0.55, Math.min(w, h) * 0.07, 0, Math.PI * 2);
  ctx.fill();

  WATERMARK_SAMPLE.hills.forEach((colour, i) => {
    const base = h * (0.62 + i * 0.12);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, base);
    for (let x = 0; x <= 8; x++) ctx.lineTo((w * x) / 8, base - Math.sin(x * 1.3 + i * 2) * h * 0.05);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });
}
