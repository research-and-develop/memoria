/**
 * The upload pipeline's one colour (plan p05 D5.5): the matte under transparent pixels. A JPEG
 * derivative (the fallback where the browser cannot encode WebP) has no alpha, so a transparent PNG
 * is painted on it first; the placeholder colour composites on the same matte, so the placeholder
 * matches what the photo will show. Colours live in the theme directory (guard no-raw-colors);
 * `apps/web/src/lib/images/encode.ts` and `placeholder.ts` use it.
 */
export const IMAGE_MATTE = Object.freeze({ hex: '#FFFFFF', rgb: Object.freeze([255, 255, 255]) });
