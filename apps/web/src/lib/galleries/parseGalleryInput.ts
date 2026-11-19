import { parseEmailAddress } from '@repo/core/email';
import { GALLERY_THEMES, SWATCHES } from '@repo/ui/theme/gallery';
import { PAIRINGS } from '@repo/ui/theme/galleryFonts';

import { GRID_STYLES } from '@/lib/settings/parseBrandingInput';
import {
  LONG_EDGE_MAX,
  LONG_EDGE_MIN,
  QUALITY_MAX,
  QUALITY_MIN,
  type GalleryDefaults,
  type Size,
} from '@/lib/settings/parseGalleryDefaultsInput';

import { GALLERY_SORTS, WELCOME_MAX, type GalleryGrid, type GallerySort, type GalleryTheme } from './gallerySettings';
import { PASSWORD_MAX, PASSWORD_MIN } from './password';
import { isSlug, SLUG_BASE_MAX } from './slug';

/**
 * The New gallery form and the gallery PATCH (plan p05 → The gallery library). Pure: the routes and the
 * form share it. User-facing messages are the product's; `field` names the input (camelCase).
 */

export const TITLE_MAX = 120;
export const CLIENT_NAME_MAX = 80;

export type GalleryCreateInput = {
  title: string;
  shootDate: string | null;
  clientName: string | null;
  clientEmail: string | null;
  /** The readable part of the address; null = from the title. */
  slugBase: string | null;
  purpose: 'selection' | 'sharing';
  access: 'link' | 'password';
  password: string | null;
  display: Size;
  thumb: Size;
  /** Bake the studio watermark into the display copies (only if a watermark exists). */
  watermark: boolean;
  theme: GalleryTheme;
  accent: string;
  font: string;
  grid: GalleryGrid;
  sort: GallerySort;
  welcome: string;
};

export type GalleryPatchInput = Partial<
  Pick<GalleryCreateInput, 'title' | 'shootDate' | 'clientName' | 'clientEmail' | 'slugBase' | 'theme' | 'accent' | 'font' | 'grid' | 'sort' | 'welcome'>
> & {
  /** A password gallery's whole slug (link galleries change only the readable part). */
  slug?: string;
  access?: 'link' | 'password';
  password?: string | null;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

const INVISIBLE_ALL = /[\p{Cc}\p{Cf}]/gu;
const HAS_INVISIBLE = /[\p{Cc}\p{Cf}]/u;
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fail = (field: string, message: string) => ({ ok: false as const, field, message });

/** Trimmed, NFC, control/format/bidi characters removed; null when empty. */
export function cleanText(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE_ALL, '').trim();
}

type Check<T> = { ok: true; value: T } | { ok: false; message: string };

function title(v: unknown): Check<string> {
  if (typeof v !== 'string' || !cleanText(v)) return { ok: false, message: 'Name the gallery.' };
  const value = cleanText(v);
  return [...value].length > TITLE_MAX ? { ok: false, message: `Keep the name to ${TITLE_MAX} characters.` } : { ok: true, value };
}

function shootDate(v: unknown): Check<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)) return { ok: true, value: v };
  return { ok: false, message: 'Enter a date like 2026-10-03.' };
}

function clientName(v: unknown): Check<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, message: 'Enter the client’s name as text.' };
  const value = cleanText(v);
  if (!value) return { ok: true, value: null };
  return [...value].length > CLIENT_NAME_MAX ? { ok: false, message: `Keep the name to ${CLIENT_NAME_MAX} characters.` } : { ok: true, value };
}

function clientEmail(v: unknown): Check<string | null> {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return { ok: true, value: null };
  const value = parseEmailAddress(v);
  return value ? { ok: true, value } : { ok: false, message: 'Enter a valid email address.' };
}

function slugBase(v: unknown): Check<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v === 'string' && v.length <= SLUG_BASE_MAX && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v)) return { ok: true, value: v };
  return { ok: false, message: `Use lower-case letters, digits and hyphens (up to ${SLUG_BASE_MAX}).` };
}

function password(v: unknown): Check<string> {
  if (typeof v !== 'string') return { ok: false, message: `Enter a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters.` };
  const value = v.normalize('NFC');
  const length = [...value].length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX || HAS_INVISIBLE.test(value) || value !== value.trim()) {
    return { ok: false, message: `Enter a password of ${PASSWORD_MIN}–${PASSWORD_MAX} characters, without spaces at either end.` };
  }
  return { ok: true, value };
}

function size(v: unknown, fallback: Size, label: string): Check<Size> {
  if (v === undefined) return { ok: true, value: fallback };
  const s = record(v);
  const longEdge = s.longEdge ?? fallback.longEdge;
  const quality = s.quality ?? fallback.quality;
  const int = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  if (!int(longEdge, LONG_EDGE_MIN, LONG_EDGE_MAX)) return { ok: false, message: `The ${label} long edge is ${LONG_EDGE_MIN}–${LONG_EDGE_MAX} px.` };
  if (!int(quality, QUALITY_MIN, QUALITY_MAX)) return { ok: false, message: `The ${label} quality is ${QUALITY_MIN}–${QUALITY_MAX}.` };
  return { ok: true, value: { longEdge, quality } };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const ACCENTS = SWATCHES.map((s) => s.id as string);
const FONTS = PAIRINGS.map((p) => p.id as string);

/** The look fields of either form, with their messages. */
function look(input: Record<string, unknown>, fallback: { theme: GalleryTheme; accent: string; font: string; grid: GalleryGrid; sort: GallerySort; welcome: string }) {
  const value = { ...fallback };
  if (input.theme !== undefined) {
    if (!oneOf(GALLERY_THEMES as readonly GalleryTheme[], input.theme)) return fail('theme', 'Choose light, dark or auto.');
    value.theme = input.theme;
  }
  if (input.accent !== undefined) {
    if (!oneOf(ACCENTS, input.accent)) return fail('accent', 'Choose one of the accent colours.');
    value.accent = input.accent;
  }
  if (input.font !== undefined) {
    if (!oneOf(FONTS, input.font)) return fail('font', 'Choose one of the typography pairings.');
    value.font = input.font;
  }
  if (input.grid !== undefined) {
    if (!oneOf(GRID_STYLES as readonly GalleryGrid[], input.grid)) return fail('grid', 'Choose masonry, justified or square.');
    value.grid = input.grid;
  }
  if (input.sort !== undefined) {
    if (!oneOf(GALLERY_SORTS, input.sort)) return fail('sort', 'Order by filename or capture time.');
    value.sort = input.sort;
  }
  if (input.welcome !== undefined) {
    if (typeof input.welcome !== 'string') return fail('welcome', 'Enter the welcome note as text.');
    // Line breaks stay (the note is shown as text with its paragraphs); every other control or format character goes.
    const welcome = input.welcome
      .normalize('NFC')
      .replace(INVISIBLE_ALL, (ch) => (ch === '\n' ? ch : ''))
      .trim();
    if (welcome.length > WELCOME_MAX) return fail('welcome', `Keep the welcome note to ${WELCOME_MAX} characters.`);
    value.welcome = welcome;
  }
  return { ok: true as const, value };
}

/**
 * The New gallery form. Missing sizes and look fields take the studio's defaults (`defaults`,
 * `branding`): the form sends them prefilled, an API caller may omit them.
 */
export function parseGalleryInput(
  body: unknown,
  ctx: { defaults: GalleryDefaults; branding: { theme: GalleryTheme; accent: string; font: string; grid: GalleryGrid } },
): Parsed<GalleryCreateInput> {
  const input = record(body);
  const t = title(input.title);
  if (!t.ok) return fail('title', t.message);
  const date = shootDate(input.shootDate);
  if (!date.ok) return fail('shootDate', date.message);
  const name = clientName(input.clientName);
  if (!name.ok) return fail('clientName', name.message);
  const email = clientEmail(input.clientEmail);
  if (!email.ok) return fail('clientEmail', email.message);
  const base = slugBase(input.slugBase);
  if (!base.ok) return fail('slugBase', base.message);

  const purpose = input.purpose ?? ctx.defaults.purpose;
  if (purpose !== 'selection' && purpose !== 'sharing') return fail('purpose', 'Choose selection or sharing.');
  const access = input.access ?? ctx.defaults.access;
  if (access !== 'link' && access !== 'password') return fail('access', 'Choose link or password.');
  let pw: string | null = null;
  if (access === 'password') {
    const p = password(input.password);
    if (!p.ok) return fail('password', p.message);
    pw = p.value;
  }

  const display = size(input.display, ctx.defaults.display[purpose], 'preview');
  if (!display.ok) return fail('display', display.message);
  const thumb = size(input.thumb, ctx.defaults.thumb, 'thumbnail');
  if (!thumb.ok) return fail('thumb', thumb.message);
  if (display.value.longEdge <= thumb.value.longEdge) return fail('display', 'The preview must be larger than the thumbnail.');

  const watermark = input.watermark ?? (purpose === 'selection' && ctx.defaults.watermarkSelection);
  if (typeof watermark !== 'boolean') return fail('watermark', 'Choose whether to watermark the previews.');

  const lookParsed = look(input, { ...ctx.branding, sort: 'filename', welcome: '' });
  if (!lookParsed.ok) return lookParsed;

  return {
    ok: true,
    value: {
      title: t.value,
      shootDate: date.value,
      clientName: name.value,
      clientEmail: email.value,
      slugBase: base.value,
      purpose,
      access,
      password: pw,
      display: display.value,
      thumb: thumb.value,
      watermark,
      ...lookParsed.value,
    },
  };
}

const PATCHABLE = ['title', 'shootDate', 'clientName', 'clientEmail', 'slugBase', 'slug', 'theme', 'accent', 'font', 'grid', 'sort', 'welcome', 'access', 'password'];

/** The gallery PATCH: only the fields sent. Never the processing profile, purpose or sizes (D5.4). */
export function parseGalleryPatch(body: unknown): Parsed<GalleryPatchInput> {
  const input = record(body);
  for (const key of ['processing', 'purpose', 'display', 'thumb', 'watermark']) {
    if (input[key] !== undefined) return fail(key, 'The image sizes and watermark are fixed when a gallery is created.');
  }
  const value: GalleryPatchInput = {};
  if (input.title !== undefined) {
    const t = title(input.title);
    if (!t.ok) return fail('title', t.message);
    value.title = t.value;
  }
  if (input.shootDate !== undefined) {
    const d = shootDate(input.shootDate);
    if (!d.ok) return fail('shootDate', d.message);
    value.shootDate = d.value;
  }
  if (input.clientName !== undefined) {
    const n = clientName(input.clientName);
    if (!n.ok) return fail('clientName', n.message);
    value.clientName = n.value;
  }
  if (input.clientEmail !== undefined) {
    const e = clientEmail(input.clientEmail);
    if (!e.ok) return fail('clientEmail', e.message);
    value.clientEmail = e.value;
  }
  if (input.slugBase !== undefined) {
    const b = slugBase(input.slugBase);
    if (!b.ok || b.value === null) return fail('slugBase', b.ok ? 'Enter the readable part of the address.' : b.message);
    value.slugBase = b.value;
  }
  if (input.slug !== undefined) {
    if (!isSlug(input.slug)) return fail('slug', 'Use 3–60 lower-case letters, digits and hyphens, not starting or ending with a hyphen.');
    value.slug = input.slug;
  }
  const lookFields = Object.fromEntries(['theme', 'accent', 'font', 'grid', 'sort', 'welcome'].filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  const l = look(lookFields, { theme: 'auto', accent: '', font: '', grid: 'masonry', sort: 'filename', welcome: '' });
  if (!l.ok) return l;
  for (const key of Object.keys(lookFields) as (keyof typeof l.value)[]) (value as Record<string, unknown>)[key] = l.value[key];
  if (input.access !== undefined) {
    if (input.access !== 'link' && input.access !== 'password') return fail('access', 'Choose link or password.');
    value.access = input.access;
    if (input.access === 'password') {
      const p = password(input.password);
      if (!p.ok) return fail('password', p.message);
      value.password = p.value;
    } else {
      value.password = null;
    }
  } else if (input.password !== undefined) {
    const p = password(input.password);
    if (!p.ok) return fail('password', p.message);
    value.password = p.value;
  }
  if (!Object.keys(input).some((k) => PATCHABLE.includes(k))) return fail('body', 'Nothing to change.');
  return { ok: true, value };
}
