import { IMAGE_MATTE } from '@repo/ui/theme/pipeline';

import { asSource, createOffscreenCanvas, painter, release, type CreateCanvas, type Surface } from './canvas';

/**
 * Derivatives are WebP; a browser whose canvas cannot encode WebP (Safari returns PNG for
 * `image/webp`) gets JPEG instead (plan p05 D5.5). JPEG has no alpha, so the picture is painted on
 * white first (a transparent PNG would otherwise turn black). Derivatives carry no metadata: a
 * canvas writes none.
 */

export type DerivativeExt = 'webp' | 'jpg';
export type Encoded = { blob: Blob; type: 'image/webp' | 'image/jpeg'; ext: DerivativeExt };
export type ConvertToBlob = (canvas: Surface, options: ImageEncodeOptions) => Promise<Blob>;

const convertOffscreen: ConvertToBlob = (canvas, options) => (canvas as unknown as OffscreenCanvas).convertToBlob(options);

/**
 * Encode `canvas` at `quality` (40–95, the gallery's setting). `format: 'jpg'` skips the WebP try
 * (the thumbnail follows the display copy, so both share one `derivative_ext`).
 */
export async function encode(
  canvas: Surface,
  quality: number,
  { format = 'webp', convertToBlob = convertOffscreen, createCanvas = createOffscreenCanvas }: { format?: DerivativeExt; convertToBlob?: ConvertToBlob; createCanvas?: CreateCanvas } = {},
): Promise<Encoded> {
  const q = Math.min(1, Math.max(0, quality / 100));
  if (format === 'webp') {
    const webp = await convertToBlob(canvas, { type: 'image/webp', quality: q });
    if (webp.type === 'image/webp') return { blob: webp, type: 'image/webp', ext: 'webp' };
  }
  const flat = createCanvas(canvas.width, canvas.height);
  try {
    const ctx = painter(flat);
    ctx.fillStyle = IMAGE_MATTE.hex;
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(asSource(canvas), 0, 0, flat.width, flat.height);
    const jpeg = await convertToBlob(flat, { type: 'image/jpeg', quality: q });
    if (jpeg.type !== 'image/jpeg') throw new Error(`the browser encoded ${jpeg.type || 'nothing'} for image/jpeg`);
    return { blob: jpeg, type: 'image/jpeg', ext: 'jpg' };
  } finally {
    release(flat);
  }
}
