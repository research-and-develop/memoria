/**
 * The defaults of a new gallery (plan p04): purpose, generated sizes, watermarking, access and image
 * delivery. Phase 5's New gallery starts from them and copies them into the gallery (D4.3). M1 reads
 * the built-in defaults; M2 adds Settings → Galleries and its write route; Phases 7, 9 and 10 add
 * their defaults as new fields (a missing field reads as its default: no migration). Pure.
 */
export const PURPOSES = ['selection', 'sharing'] as const;
export type Purpose = (typeof PURPOSES)[number];
export const ACCESS_MODES = ['link', 'password'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];
/** `protected` joins when Phase 6 M2 builds it (D4.13): until then it is refused. */
export const DELIVERY_MODES = ['public'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export type Size = { longEdge: number; quality: number };

export type GalleryDefaults = {
  purpose: Purpose;
  /** The display copy per purpose (selection galleries never serve more). */
  display: { selection: Size; sharing: Size };
  thumb: Size;
  /** Watermark the display copies of selection galleries (read as false while the watermark is `none`). */
  watermarkSelection: boolean;
  access: AccessMode;
  delivery: DeliveryMode;
};

export const LONG_EDGE_MIN = 400;
export const LONG_EDGE_MAX = 4096;
export const QUALITY_MIN = 40;
export const QUALITY_MAX = 95;

/** Owner, 2026-11-17: selection 1600 px / q75, sharing 2048 px / q82, thumbnails 800 px / q70. */
export const GALLERY_DEFAULTS: GalleryDefaults = {
  purpose: 'selection',
  display: { selection: { longEdge: 1600, quality: 75 }, sharing: { longEdge: 2048, quality: 82 } },
  thumb: { longEdge: 800, quality: 70 },
  watermarkSelection: true,
  access: 'link',
  delivery: 'public',
};

export type GalleryDefaultsField = 'purpose' | 'display.selection' | 'display.sharing' | 'thumb' | 'watermarkSelection' | 'access' | 'delivery';
export type GalleryDefaultsParse = { ok: true; value: GalleryDefaults } | { ok: false; field: GalleryDefaultsField; message: string };

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function parseSize(input: unknown, fallback: Size, label: string): { ok: true; value: Size } | { ok: false; message: string } {
  if (input === undefined) return { ok: true, value: fallback };
  const size = record(input);
  const longEdge = size.longEdge ?? fallback.longEdge;
  const quality = size.quality ?? fallback.quality;
  if (!isInt(longEdge, LONG_EDGE_MIN, LONG_EDGE_MAX)) return { ok: false, message: `The ${label} long edge is ${LONG_EDGE_MIN}–${LONG_EDGE_MAX} px.` };
  if (!isInt(quality, QUALITY_MIN, QUALITY_MAX)) return { ok: false, message: `The ${label} quality is ${QUALITY_MIN}–${QUALITY_MAX}.` };
  return { ok: true, value: { longEdge, quality } };
}

function parseChoice<T extends string>(input: unknown, allowed: readonly T[], fallback: T): T | null {
  if (input === undefined) return fallback;
  return typeof input === 'string' && (allowed as readonly string[]).includes(input) ? (input as T) : null;
}

export function parseGalleryDefaultsInput(body: unknown): GalleryDefaultsParse {
  const input = record(body);
  const purpose = parseChoice(input.purpose, PURPOSES, GALLERY_DEFAULTS.purpose);
  if (!purpose) return { ok: false, field: 'purpose', message: 'Choose selection or sharing.' };

  const display = record(input.display);
  const selection = parseSize(display.selection, GALLERY_DEFAULTS.display.selection, 'selection preview');
  if (!selection.ok) return { ok: false, field: 'display.selection', message: selection.message };
  const sharing = parseSize(display.sharing, GALLERY_DEFAULTS.display.sharing, 'sharing photo');
  if (!sharing.ok) return { ok: false, field: 'display.sharing', message: sharing.message };
  const thumb = parseSize(input.thumb, GALLERY_DEFAULTS.thumb, 'thumbnail');
  if (!thumb.ok) return { ok: false, field: 'thumb', message: thumb.message };
  if (selection.value.longEdge <= thumb.value.longEdge) return { ok: false, field: 'display.selection', message: 'The selection preview must be larger than the thumbnail.' };
  if (sharing.value.longEdge <= thumb.value.longEdge) return { ok: false, field: 'display.sharing', message: 'The sharing photo must be larger than the thumbnail.' };

  const watermarkSelection = input.watermarkSelection ?? GALLERY_DEFAULTS.watermarkSelection;
  if (typeof watermarkSelection !== 'boolean') return { ok: false, field: 'watermarkSelection', message: 'Choose whether to watermark selection galleries.' };

  const access = parseChoice(input.access, ACCESS_MODES, GALLERY_DEFAULTS.access);
  if (!access) return { ok: false, field: 'access', message: 'Choose link or password.' };
  const delivery = parseChoice(input.delivery, DELIVERY_MODES, GALLERY_DEFAULTS.delivery);
  if (!delivery) {
    const soon = input.delivery === 'protected';
    return { ok: false, field: 'delivery', message: soon ? 'Protected delivery is not available yet.' : 'Choose how images are delivered.' };
  }

  return {
    ok: true,
    value: { purpose, display: { selection: selection.value, sharing: sharing.value }, thumb: thumb.value, watermarkSelection, access, delivery },
  };
}
