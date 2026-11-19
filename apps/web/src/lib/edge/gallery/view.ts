import { logger } from '@repo/logger';
import { accentId } from '@repo/ui/theme/gallery';
import { pairing } from '@repo/ui/theme/galleryFonts';

import type { PublicSetRow } from '../../db/queries/photo_sets/public';
import { PUBLIC_PHOTO_PAGE, type PublicPhotoRow } from '../../db/queries/photos/public';
import type { PublicCover, PublicGalleryRow } from '../../db/queries/galleries/public';
import { parseGallerySettings, type GalleryGrid, type GallerySort, type GalleryTheme } from '../../galleries/gallerySettings';
import { REV_RE } from '../../galleries/keys';
import { encodeCursor } from '../../galleries/sortKey';
import { parseStudioInput } from '../../settings/parseStudioInput';

/**
 * The view JSON (plan p06 D6.7): what the client gallery is given, injected into the shell for the
 * first page and answered by `/g/<slug>/data` for the next ones. Built from the PUBLIC rows only, so
 * no password, client field, filename or original key can be in it; `rev` and `ext` are checked (a bad
 * row is dropped and logged) because the browser builds public URLs from them (Phase 5's `thumbKey` /
 * `displayKey`). Pure apart from that log line.
 */
export const VIEW_VERSION = 1;
/** Until Phase 4 M2's T4.11 adds them to Settings → Studio. */
export const GALLERY_LOCALE = 'en-GB';
export const GALLERY_TIME_ZONE = 'UTC';

type Ext = 'webp' | 'jpg';
/** `[id, w, h, color, rev, ext]`: ~80 bytes a photo. `w`/`h` = the display copy's size. */
export type ViewPhoto = [id: string, w: number, h: number, color: string, rev: string, ext: Ext];
export type ViewPage = { setId: string; photos: ViewPhoto[]; next: string | null };
export type ViewSet = { id: string; name: string; count: number };
export type ViewStudio = { name: string; website: string | null; locale: string; timeZone: string };
export type ViewCover = { id: string; w: number; h: number; color: string; rev: string; ext: Ext };
export type ViewLook = { theme: GalleryTheme; accent: string; font: string };

export type ViewGallery = ViewLook & {
  id: string;
  slug: string;
  title: string;
  date: string | null;
  purpose: 'selection' | 'sharing';
  /** Plain text: rendered as text, never HTML. */
  welcome: string;
  cover: ViewCover | null;
  grid: GalleryGrid;
  sort: GallerySort;
  /** The right-click deterrent (D6.17): selection galleries only. */
  protect: boolean;
};

export type GalleryPageView = {
  v: typeof VIEW_VERSION;
  kind: 'gallery';
  gallery: ViewGallery;
  studio: ViewStudio;
  media: string | null;
  sets: ViewSet[];
  page: ViewPage | null;
};

/** A password gallery without a valid access cookie: the title and look only (no photo, no cover). */
export type GalleryGateView = {
  v: typeof VIEW_VERSION;
  kind: 'gate';
  gallery: ViewLook & { slug: string; title: string };
  studio: ViewStudio;
  turnstileSiteKey: string;
};

export type GalleryView = GalleryPageView | GalleryGateView;

const isExt = (v: unknown): v is Ext => v === 'webp' || v === 'jpg';
const validMedia = (rev: string, ext: unknown): ext is Ext => REV_RE.test(rev) && isExt(ext);

/** The studio row's name and website (Phase 2b's parser), else the env's `APP_NAME` and no website. */
export function viewStudio(value: unknown, appName: string): ViewStudio {
  const parsed = value === null || value === undefined ? null : parseStudioInput(value, { isDevelopment: false });
  return {
    name: parsed?.ok ? parsed.value.name : appName,
    website: parsed?.ok && parsed.value.siteUrl?.startsWith('https://') ? parsed.value.siteUrl : null,
    locale: GALLERY_LOCALE,
    timeZone: GALLERY_TIME_ZONE,
  };
}

/** The gallery's settings with registry-checked look; invalid stored fields logged, never fatal. */
export function viewSettings(row: Pick<PublicGalleryRow, 'settings'>) {
  const { value, invalid } = parseGallerySettings(row.settings);
  if (invalid.length > 0) logger.warn({ event: 'gallery_settings_invalid', fields: invalid });
  const look: ViewLook = { theme: value.theme, accent: accentId(value.accent), font: pairing(value.font).id };
  return { settings: value, look };
}

function viewCover(cover: PublicCover | null): ViewCover | null {
  if (!cover || !validMedia(cover.rev, cover.ext)) return null;
  return { id: cover.id, w: cover.w, h: cover.h, color: cover.color, rev: cover.rev, ext: cover.ext };
}

/**
 * A page from up to `PUBLIC_PHOTO_PAGE + 1` rows (the statement reads one more): the extra row only
 * says a next page exists; the cursor is the last returned photo's `sort_key`.
 */
export function viewPage(setId: string, rows: readonly PublicPhotoRow[]): ViewPage {
  const pageRows = rows.slice(0, PUBLIC_PHOTO_PAGE);
  const photos: ViewPhoto[] = [];
  let dropped = 0;
  for (const p of pageRows) {
    if (validMedia(p.rev, p.ext)) photos.push([p.id, p.w, p.h, p.color, p.rev, p.ext]);
    else dropped += 1;
  }
  if (dropped > 0) logger.warn({ event: 'gallery_photo_invalid', count: dropped });
  const last = pageRows.at(-1);
  return { setId, photos, next: rows.length > PUBLIC_PHOTO_PAGE && last ? encodeCursor(last.sort_key) : null };
}

export function viewSets(rows: readonly PublicSetRow[]): ViewSet[] {
  return rows.map((s) => ({ id: s.id, name: s.name, count: s.photo_count }));
}

export function galleryPageView(input: {
  gallery: PublicGalleryRow;
  studio: ViewStudio;
  mediaBaseUrl: string | null;
  sets: ViewSet[];
  page: ViewPage | null;
}): GalleryPageView {
  const { gallery: g } = input;
  const { settings, look } = viewSettings(g);
  return {
    v: VIEW_VERSION,
    kind: 'gallery',
    gallery: {
      id: g.id,
      slug: g.slug,
      title: g.title,
      date: g.shoot_date,
      purpose: g.purpose,
      welcome: settings.welcome,
      cover: viewCover(g.cover),
      ...look,
      grid: settings.grid,
      sort: settings.sort,
      protect: g.purpose === 'selection',
    },
    studio: input.studio,
    media: input.mediaBaseUrl,
    sets: input.sets,
    page: input.page,
  };
}

export function galleryGateView(input: { gallery: PublicGalleryRow; studio: ViewStudio; turnstileSiteKey: string }): GalleryGateView {
  const { look } = viewSettings(input.gallery);
  return {
    v: VIEW_VERSION,
    kind: 'gate',
    gallery: { slug: input.gallery.slug, title: input.gallery.title, ...look },
    studio: input.studio,
    turnstileSiteKey: input.turnstileSiteKey,
  };
}
