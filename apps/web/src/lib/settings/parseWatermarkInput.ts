/**
 * The studio's watermark (plan p04 D4.9): an image (PNG or WebP with transparency), a line of text,
 * or none, plus where and how strongly it is drawn. Phase 5 bakes it into the display copies of
 * selection galleries and snapshots the whole object into each gallery (D4.3). Pure: the route, the
 * form and `readWatermark` (a stored row) share it; the browser draws it (`lib/images/watermark.ts`).
 */
export const WATERMARK_ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type Anchor = (typeof WATERMARK_ANCHORS)[number];
export const WATERMARK_POSITIONS = [...WATERMARK_ANCHORS, 'tiled'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export type Placement = {
  position: WatermarkPosition;
  /** The mark's width as a percentage of the photo's long edge, 5–60. */
  size: number;
  /** 10–100 %. */
  opacity: number;
  /** From the anchored edges, as a percentage of the photo's short edge, 0–10 (ignored when tiled). */
  margin: number;
};

export const WATERMARK_IMAGE_TYPES = ['image/png', 'image/webp'] as const;
export type WatermarkImageType = (typeof WATERMARK_IMAGE_TYPES)[number];

export type ImageWatermark = { kind: 'image'; key: string; width: number; height: number; contentType: WatermarkImageType } & Placement;
export type TextWatermark = { kind: 'text'; text: string; font: 'sans' | 'serif'; ink: 'light' | 'dark' } & Placement;
export type Watermark = { kind: 'none' } | ImageWatermark | TextWatermark;

export const WATERMARK_MAX_BYTES = 2 * 1024 * 1024;
export const WATERMARK_MAX_PX = 4000;
export const WATERMARK_TEXT_MAX = 60;
export const PLACEMENT_BOUNDS = { size: [5, 60], opacity: [10, 100], margin: [0, 10] } as const;
export const DEFAULT_PLACEMENT: Placement = { position: 'bottom-right', size: 20, opacity: 60, margin: 3 };
export const NO_WATERMARK: Watermark = { kind: 'none' };

/** The only keys a watermark image may have: server-generated, under `branding/watermarks/`. */
export const WATERMARK_KEY_RE = /^branding\/watermarks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|webp)$/;
export const WATERMARK_EXTENSIONS: Record<WatermarkImageType, string> = { 'image/png': 'png', 'image/webp': 'webp' };

export type WatermarkField = 'kind' | 'key' | 'width' | 'height' | 'contentType' | 'text' | 'font' | 'ink' | keyof Placement;
export type WatermarkParse = { ok: true; value: Watermark } | { ok: false; field: WatermarkField; message: string };

/** Control, format and bidi characters: invisible, and drawn into every photo. Stripped. */
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/gu;

export function isWatermarkImageType(value: unknown): value is WatermarkImageType {
  return typeof value === 'string' && (WATERMARK_IMAGE_TYPES as readonly string[]).includes(value);
}

/** A text watermark's text as it is drawn: NFC, invisible characters removed, trimmed. */
export function cleanWatermarkText(input: string): string {
  return input.normalize('NFC').replace(INVISIBLE_RE, '').trim();
}

const isInt = (value: unknown, [min, max]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function parsePlacement(input: Record<string, unknown>): { ok: true; value: Placement } | { ok: false; field: keyof Placement; message: string } {
  const position = input.position;
  if (typeof position !== 'string' || !(WATERMARK_POSITIONS as readonly string[]).includes(position)) {
    return { ok: false, field: 'position', message: 'Choose where the watermark goes.' };
  }
  for (const field of ['size', 'opacity', 'margin'] as const) {
    const bounds = PLACEMENT_BOUNDS[field];
    if (!isInt(input[field], bounds)) return { ok: false, field, message: `The ${field} is a whole number from ${bounds[0]} to ${bounds[1]}.` };
  }
  return { ok: true, value: { position: position as WatermarkPosition, size: input.size as number, opacity: input.opacity as number, margin: input.margin as number } };
}

export function parseWatermarkInput(body: unknown): WatermarkParse {
  const input = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  if (input.kind === 'none') return { ok: true, value: NO_WATERMARK };
  if (input.kind !== 'image' && input.kind !== 'text') return { ok: false, field: 'kind', message: 'Choose an image, a text or no watermark.' };

  const placement = parsePlacement(input);
  if (!placement.ok) return placement;

  if (input.kind === 'image') {
    if (!isWatermarkImageType(input.contentType)) return { ok: false, field: 'contentType', message: 'The watermark image is a PNG or a WebP.' };
    const key = input.key;
    if (typeof key !== 'string' || !WATERMARK_KEY_RE.test(key) || !key.endsWith(`.${WATERMARK_EXTENSIONS[input.contentType]}`)) {
      return { ok: false, field: 'key', message: 'Upload the watermark image again.' };
    }
    for (const field of ['width', 'height'] as const) {
      if (!isInt(input[field], [1, WATERMARK_MAX_PX])) return { ok: false, field, message: `The image is at most ${WATERMARK_MAX_PX} px on each side.` };
    }
    return {
      ok: true,
      value: { kind: 'image', key, width: input.width as number, height: input.height as number, contentType: input.contentType, ...placement.value },
    };
  }

  const text = typeof input.text === 'string' ? cleanWatermarkText(input.text) : '';
  if (!text) return { ok: false, field: 'text', message: 'Enter the watermark text.' };
  if ([...text].length > WATERMARK_TEXT_MAX) return { ok: false, field: 'text', message: `Keep the text to ${WATERMARK_TEXT_MAX} characters.` };
  if (input.font !== 'sans' && input.font !== 'serif') return { ok: false, field: 'font', message: 'Choose a sans or a serif font.' };
  if (input.ink !== 'light' && input.ink !== 'dark') return { ok: false, field: 'ink', message: 'Choose light or dark text.' };
  return { ok: true, value: { kind: 'text', text, font: input.font, ink: input.ink, ...placement.value } };
}

/** The fields that differ between two watermarks (the audit names fields, never values). */
export function changedWatermarkFields(before: Watermark, after: Watermark): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => a[field] !== b[field]).sort();
}
