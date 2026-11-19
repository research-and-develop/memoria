/**
 * A gallery's `settings` JSON (plan p05, D5.10): its processing profile (D5.4), look and order.
 *
 * IMPORT-FREE (no import at all, not even a type): `worker.ts` reaches it on the gallery path (plan
 * p06 D6.6, guard `edge-graph`), the relay through the purge, the browser through the manager. So the
 * registries it would check against (accent swatches, font pairings) are NOT imported: ids are checked
 * by shape here and resolved by the registry where they are used (an unknown one falls back to the
 * default there). gallerySettings.test.ts pins the defaults to Phase 4's.
 *
 * `parseGallerySettings` never throws: an invalid or missing field reads as its default and is named
 * in `invalid`, for the caller to log (a stored setting never breaks a gallery).
 */

export type GalleryTheme = 'light' | 'dark' | 'auto';
export type GalleryGrid = 'masonry' | 'justified' | 'square';
export type GallerySort = 'filename' | 'taken';
export type ProcessingSize = { longEdge: number; quality: number };

/**
 * The processing profile (D5.4): what each upload produces. `watermark` is the WHOLE Phase 4
 * `Watermark` object (image or text, with its placement) as it was at creation, or null for none;
 * this module keeps any object with a `kind` of `image` or `text` and leaves the full check to
 * `parseWatermarkInput` where it is used. `ext` is the derivatives' preferred encoding (the browser
 * falls back to JPEG when it cannot encode WebP).
 */
export type Processing = {
  display: ProcessingSize;
  thumb: ProcessingSize;
  watermark: Record<string, unknown> | null;
  ext: 'webp';
};

export type GallerySettings = {
  processing: Processing;
  theme: GalleryTheme;
  /** A swatch id (packages/ui/theme/gallery.mjs `SWATCHES`). */
  accent: string;
  /** A pairing id (packages/ui/theme/galleryFonts.mjs `PAIRINGS`). */
  font: string;
  grid: GalleryGrid;
  sort: GallerySort;
  /** Plain text shown under the cover (never HTML). */
  welcome: string;
};

export const GALLERY_THEME_IDS: readonly GalleryTheme[] = ['light', 'dark', 'auto'];
export const GALLERY_GRIDS: readonly GalleryGrid[] = ['masonry', 'justified', 'square'];
export const GALLERY_SORTS: readonly GallerySort[] = ['filename', 'taken'];
export const WELCOME_MAX = 1000;
/** Phase 4's bounds of a generated size (LONG_EDGE_MIN/MAX, QUALITY_MIN/MAX): pinned by the test. */
export const SIZE_BOUNDS = { longEdge: [400, 4096], quality: [40, 95] } as const;

/** The defaults (= Phase 4's built-in branding and the selection sizes; pinned by the test). */
export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  processing: { display: { longEdge: 1600, quality: 75 }, thumb: { longEdge: 800, quality: 70 }, watermark: null, ext: 'webp' },
  theme: 'auto',
  accent: 'pine',
  font: 'classic',
  grid: 'masonry',
  sort: 'filename',
  welcome: '',
};

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIntIn = (value: unknown, [min, max]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function parseSize(value: unknown): ProcessingSize | null {
  if (!isRecord(value)) return null;
  const { longEdge, quality } = value;
  return isIntIn(longEdge, SIZE_BOUNDS.longEdge) && isIntIn(quality, SIZE_BOUNDS.quality) ? { longEdge, quality } : null;
}

function parseProcessing(value: unknown): Processing | null {
  if (!isRecord(value)) return null;
  const display = parseSize(value.display);
  const thumb = parseSize(value.thumb);
  if (!display || !thumb) return null;
  const wm = value.watermark;
  const watermark = isRecord(wm) && (wm.kind === 'image' || wm.kind === 'text') ? wm : null;
  if (wm !== null && wm !== undefined && !watermark) return null;
  return { display, thumb, watermark, ext: 'webp' };
}

export function parseGallerySettings(json: unknown): { value: GallerySettings; invalid: string[] } {
  let input: unknown = json;
  if (typeof json === 'string') {
    try {
      input = JSON.parse(json);
    } catch {
      input = null;
    }
  }
  const invalid: string[] = [];
  const source = isRecord(input) ? input : {};
  if (!isRecord(input)) invalid.push('settings');
  const d = DEFAULT_GALLERY_SETTINGS;

  const pick = <T>(field: keyof GallerySettings, ok: (v: unknown) => v is T, fallback: T): T => {
    const value = source[field];
    if (value === undefined) return fallback;
    if (ok(value)) return value;
    invalid.push(field);
    return fallback;
  };
  const oneOf =
    <T extends string>(list: readonly T[]) =>
    (v: unknown): v is T =>
      typeof v === 'string' && (list as readonly string[]).includes(v);
  const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
  const isWelcome = (v: unknown): v is string => typeof v === 'string' && v.length <= WELCOME_MAX;

  let processing = d.processing;
  if (source.processing !== undefined) {
    const parsed = parseProcessing(source.processing);
    if (parsed) processing = parsed;
    else invalid.push('processing');
  }
  return {
    value: {
      processing,
      theme: pick('theme', oneOf(GALLERY_THEME_IDS), d.theme),
      accent: pick('accent', isId, d.accent),
      font: pick('font', isId, d.font),
      grid: pick('grid', oneOf(GALLERY_GRIDS), d.grid),
      sort: pick('sort', oneOf(GALLERY_SORTS), d.sort),
      welcome: pick('welcome', isWelcome, d.welcome),
    },
    invalid,
  };
}
