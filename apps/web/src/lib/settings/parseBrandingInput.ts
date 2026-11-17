import { DEFAULT_ACCENT, GALLERY_THEMES, SWATCHES, type AccentId } from '@repo/ui/theme/gallery';
import { DEFAULT_PAIRING, PAIRINGS } from '@repo/ui/theme/galleryFonts';

/**
 * The studio's branding (plan p04): the look new galleries start from. Phase 5 copies it into each
 * gallery at creation (D4.3). M1 reads the built-in default; M2 adds Settings → Branding, its write
 * route and the logo. Pure: the route, the form and `readBranding` (a stored row) share it.
 */
export type GalleryThemeChoice = (typeof GALLERY_THEMES)[number];
export const GRID_STYLES = ['masonry', 'justified', 'square'] as const;
export type GridStyle = (typeof GRID_STYLES)[number];

export type Branding = {
  accent: AccentId;
  theme: GalleryThemeChoice;
  /** A pairing id (theme/galleryFonts.mjs). */
  font: string;
  grid: GridStyle;
};

export const BRANDING_DEFAULTS: Branding = { accent: DEFAULT_ACCENT, theme: 'auto', font: DEFAULT_PAIRING, grid: 'masonry' };

export type BrandingParse = { ok: true; value: Branding } | { ok: false; field: keyof Branding; message: string };

/**
 * `stored`: a saved row is being read. A swatch or pairing removed since it was saved then reads as
 * the default (a removed choice never breaks the settings); typed input naming one is refused.
 * A missing field is its default in both cases (a field added later needs no migration).
 */
export function parseBrandingInput(body: unknown, opts: { stored?: boolean } = {}): BrandingParse {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const pick = <T extends string>(field: keyof Branding, allowed: readonly T[], fallback: T, message: string, lenient: boolean) => {
    const value = input[field];
    if (value === undefined) return { ok: true as const, value: fallback };
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return { ok: true as const, value: value as T };
    if (lenient && typeof value === 'string') return { ok: true as const, value: fallback };
    return { ok: false as const, field, message };
  };
  const accent = pick(
    'accent',
    SWATCHES.map((s) => s.id),
    BRANDING_DEFAULTS.accent,
    'Choose one of the accent colours.',
    opts.stored === true,
  );
  if (!accent.ok) return accent;
  const theme = pick('theme', GALLERY_THEMES, BRANDING_DEFAULTS.theme, 'Choose light, dark or auto.', false);
  if (!theme.ok) return theme;
  const font = pick(
    'font',
    PAIRINGS.map((p) => p.id),
    BRANDING_DEFAULTS.font,
    'Choose one of the typography pairings.',
    opts.stored === true,
  );
  if (!font.ok) return font;
  const grid = pick('grid', GRID_STYLES, BRANDING_DEFAULTS.grid, 'Choose masonry, justified or square.', false);
  if (!grid.ok) return grid;
  return { ok: true, value: { accent: accent.value, theme: theme.value, font: font.value, grid: grid.value } };
}
