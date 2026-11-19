import 'server-only';

import { AppError } from '@repo/core/error';
import { batch, type Options, type Statement } from '@repo/db/client';
import { logger } from '@repo/logger';
import { blobUrls } from '@repo/platform/blobUrls';
import { getPlatform } from '@repo/platform/current';

import { auditStatement, conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import {
  bumpContentStatement,
  CHANGED,
  changeAccessStatement,
  getGallery,
  insertGalleryStatement,
  listGalleries,
  publishStatement,
  unpublishStatement,
  updateGalleryStatement,
  type GalleryCursor,
  type GalleryRow,
} from '@/lib/db/queries/galleries';
import { insertSetStatement, listSets, type PhotoSetRow } from '@/lib/db/queries/photo_sets';
import { getCoverPhotos, resortStatement } from '@/lib/db/queries/photos';
import { readWatermark, watermarkImageUrl } from '@/lib/settings/watermark';
import { settingsCipher } from '@/lib/settings/secrets';

import { parseGallerySettings, type GallerySettings } from './gallerySettings';
import { thumbKey } from './keys';
import type { GalleryCreateInput, GalleryPatchInput } from './parseGalleryInput';
import { sealGalleryPassword } from './password';
import { joinSlug, slugBase, slugSuffix, suffixOf } from './slug';

/**
 * Galleries (plan p05 T5.3): create, read, list, edit, publish, new link. Each write is ONE batch
 * whose statements carry their own guards (no read-check-write), with its audit row; the content
 * version moves only on a real change (D5.12). Never logs or audits a password or an address.
 */

export const DEFAULT_SET_NAME = 'Photos';

export type GalleryDetail = GalleryRow & { settingsParsed: GallerySettings; sets: PhotoSetRow[] };

function notFound(): AppError {
  return new AppError('Gallery not found', 'NOT_FOUND', { status: 404, message: 'This gallery does not exist.' });
}

function slugTaken(): AppError {
  return new AppError('Slug taken', 'SLUG_TAKEN', { status: 409, field: 'slug', message: 'Another gallery already uses this address. Try another one.' });
}

const isSlugClash = (error: unknown) => error instanceof Error && /UNIQUE constraint failed: galleries\.slug/.test(error.message);

/** The settings, their defaults filled in; what was invalid is logged (by id, never a value). */
export function gallerySettingsOf(row: GalleryRow): GallerySettings {
  const { value, invalid } = parseGallerySettings(row.settings);
  if (invalid.length > 0) logger.warn({ event: 'gallery_settings_invalid', galleryId: row.id, fields: invalid });
  return value;
}

async function cipher() {
  const key = getPlatform().config().settingsKey;
  if (!key) {
    throw new AppError('No settings key', 'SETTINGS_KEY_MISSING', {
      status: 503,
      message: 'The server has no SETTINGS_ENCRYPTION_KEY yet: the person who installed Memoria must set it.',
    });
  }
  return settingsCipher(key);
}

/** A live gallery (404 for a missing or deleted one), with its parsed settings and sets. */
export async function requireGallery(id: string, opts?: Options): Promise<GalleryDetail> {
  const row = await getGallery(id, opts);
  if (!row || row.deleted_at) throw notFound();
  return { ...row, settingsParsed: gallerySettingsOf(row), sets: await listSets(id, opts) };
}

/**
 * Create (D5.3, D5.4): the gallery with its processing snapshot (sizes and the studio watermark as it
 * is now), one set, the audit row, in one batch. A slug clash retries once with a new random part.
 */
export async function createGallery(input: GalleryCreateInput, opts?: Options): Promise<{ id: string; slug: string }> {
  let watermark: Record<string, unknown> | null = null;
  if (input.watermark) {
    const current = await readWatermark(opts);
    if (current.kind === 'none') {
      throw new AppError('No watermark', 'WATERMARK_NONE', { status: 400, field: 'watermark', message: 'Set up a watermark in Settings → Watermarks first.' });
    }
    watermark = current as unknown as Record<string, unknown>;
  }
  const id = crypto.randomUUID();
  const passwordSealed = input.access === 'password' && input.password ? await sealGalleryPassword(await cipher(), id, input.password) : null;
  const settings: GallerySettings = {
    processing: { display: input.display, thumb: input.thumb, watermark, ext: 'webp' },
    theme: input.theme,
    accent: input.accent,
    font: input.font,
    grid: input.grid,
    sort: input.sort,
    welcome: input.welcome,
  };
  const base = input.slugBase ?? slugBase(input.title);
  const now = new Date().toISOString();

  for (let attempt = 0; ; attempt += 1) {
    const slug = joinSlug(base, slugSuffix());
    try {
      await batch(
        [
          insertGalleryStatement({
            id,
            slug,
            title: input.title,
            shootDate: input.shootDate,
            clientName: input.clientName,
            clientEmail: input.clientEmail,
            purpose: input.purpose,
            access: input.access,
            passwordSealed,
            delivery: 'public',
            settings,
            now,
          }),
          insertSetStatement({ id: crypto.randomUUID(), galleryId: id, name: DEFAULT_SET_NAME, now }),
          auditStatement({ action: 'create', entity: 'galleries', entityId: id, summary: 'Created a gallery', details: { purpose: input.purpose, access: input.access, watermark: watermark !== null } }),
        ],
        opts,
      );
      return { id, slug };
    } catch (error) {
      if (isSlugClash(error) && attempt === 0) continue;
      if (isSlugClash(error)) throw slugTaken();
      throw error;
    }
  }
}

/**
 * Edit (D5.10): only the fields sent, settings merged with `json_patch`; a link gallery's slug keeps
 * its random part (D5.3); a sort change re-sorts its photos in the same batch, after the settings
 * write (D5.23); an access change bumps the password version. Bumps the content version and audits
 * (field names only).
 */
export async function patchGallery(id: string, patch: GalleryPatchInput, opts?: Options): Promise<void> {
  const current = await requireGallery(id, opts);
  const access = patch.access ?? current.access;

  let slug: string | undefined;
  if (patch.slug !== undefined) {
    if (access !== 'password') {
      throw new AppError('Link slug', 'SLUG_SUFFIX_REQUIRED', { status: 400, field: 'slug', message: 'A link gallery keeps the random part of its address: change only the readable part.' });
    }
    slug = patch.slug;
  } else if (patch.slugBase !== undefined || (patch.access === 'link' && !suffixOf(current.slug))) {
    // Link galleries: the readable part changes, the random part stays (a fresh one if it had none).
    const suffix = suffixOf(current.slug) ?? slugSuffix();
    slug = joinSlug(patch.slugBase ?? current.slug.replace(/-[a-z2-9]{10}$/, ''), suffix);
  }

  const settingsPatch: Record<string, unknown> = {};
  for (const key of ['theme', 'accent', 'font', 'grid', 'sort', 'welcome'] as const) {
    if (patch[key] !== undefined) settingsPatch[key] = patch[key];
  }
  const now = new Date().toISOString();
  const statements: Statement[] = [
    updateGalleryStatement({
      id,
      now,
      patch: {
        title: patch.title,
        shootDate: patch.shootDate,
        clientName: patch.clientName,
        clientEmail: patch.clientEmail,
        slug,
        settingsPatch: Object.keys(settingsPatch).length > 0 ? settingsPatch : undefined,
      },
    }),
  ];
  if (patch.sort !== undefined && patch.sort !== current.settingsParsed.sort) statements.push(resortStatement(id));
  if (patch.access !== undefined || patch.password !== undefined) {
    const sealed = access === 'password' && patch.password ? await sealGalleryPassword(await cipher(), id, patch.password) : null;
    if (access === 'password' && !sealed) {
      throw new AppError('Password required', 'INVALID_PARAMS', { status: 400, field: 'password', message: 'Enter a password for the gallery.' });
    }
    statements.push(changeAccessStatement({ id, access, passwordSealed: sealed, now }));
  }
  const fields = Object.keys(patch).filter((k) => k !== 'password');
  statements.push(bumpContentStatement({ id, now }));
  statements.push(auditStatement({ action: 'update', entity: 'galleries', entityId: id, summary: 'Edited a gallery', details: { fields } }));
  try {
    await batch(statements, opts);
  } catch (error) {
    if (isSlugClash(error)) throw slugTaken();
    throw error;
  }
}

/**
 * Publish or unpublish (D5.19). A chain of guards: the bump only when the status changed, the audit
 * only when the bump happened, so a repeat writes nothing at all.
 */
export async function setPublished(id: string, published: boolean, opts?: Options): Promise<void> {
  await requireGallery(id, opts);
  const now = new Date().toISOString();
  await batch(
    [
      published ? publishStatement({ id, now }) : unpublishStatement({ id, now }),
      bumpContentStatement({ id, now, when: CHANGED }),
      conditionalAuditStatement(
        { action: 'update', entity: 'galleries', entityId: id, summary: published ? 'Published a gallery' : 'Unpublished a gallery', details: { event: published ? 'publish' : 'unpublish' } },
        CHANGED.sql,
        [],
      ),
    ],
    opts,
  );
}

/** New link (D5.3): a new random part; the old address stops at once. Retries once on a clash. */
export async function newLink(id: string, opts?: Options): Promise<string> {
  const current = await requireGallery(id, opts);
  const base = current.slug.replace(/-[a-z2-9]{10}$/, '');
  for (let attempt = 0; ; attempt += 1) {
    const slug = joinSlug(base, slugSuffix());
    const now = new Date().toISOString();
    try {
      await batch(
        [
          updateGalleryStatement({ id, now, patch: { slug } }),
          bumpContentStatement({ id, now, when: CHANGED }),
          auditStatement({ action: 'update', entity: 'galleries', entityId: id, summary: 'New gallery link', details: { event: 'new-link' } }),
        ],
        opts,
      );
      return slug;
    } catch (error) {
      if (isSlugClash(error) && attempt === 0) continue;
      if (isSlugClash(error)) throw slugTaken();
      throw error;
    }
  }
}

/** A card of the galleries list. */
export type GalleryCard = {
  id: string;
  slug: string;
  title: string;
  status: GalleryRow['status'];
  purpose: GalleryRow['purpose'];
  photoCount: number;
  shootDate: string | null;
  createdAt: string;
  deletedAt: string | null;
  /** The cover's thumbnail URL (public domain or the dev read route), or null. */
  coverUrl: string | null;
};

export async function listGalleryCards(input: { deleted?: boolean; cursor?: GalleryCursor | null }, opts?: Options): Promise<{ cards: GalleryCard[]; next: GalleryCursor | null }> {
  const rows = await listGalleries({ deleted: input.deleted, cursor: input.cursor }, opts);
  const covers = await getCoverPhotos(rows.map((r) => r.cover_photo_id).filter((v): v is string => v !== null), opts);
  const urls = blobUrls(getPlatform().config());
  const coverUrl = async (row: GalleryRow): Promise<string | null> => {
    const cover = covers.find((c) => c.id === row.cover_photo_id && c.gallery_id === row.id);
    if (!cover) return null;
    const key = thumbKey(row.id, cover.id, cover.rev, cover.derivative_ext);
    if (urls.mode === 'dev') return urls.readUrl(key, { expiresInSeconds: 3600 });
    return urls.publicUrl(key);
  };
  const cards = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      purpose: row.purpose,
      photoCount: row.photo_count,
      shootDate: row.shoot_date,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      coverUrl: await coverUrl(row),
    })),
  );
  const last = rows.length === 50 ? rows[rows.length - 1] : undefined;
  return { cards, next: last ? { createdAt: last.created_at, id: last.id } : null };
}

/**
 * What the manager and the upload worker read (`GET /api/admin/galleries/[id]`): the gallery without
 * its sealed password, its settings with defaults, its sets, the processing profile and, for an image
 * watermark snapshot, the URL it loads from (Phase 4's `watermarkImageUrl`; never a presigned GET).
 */
export async function galleryView(detail: GalleryDetail) {
  const { settingsParsed, sets, settings: _raw, ...gallery } = detail;
  const watermark = settingsParsed.processing.watermark;
  const imageUrl = watermark && watermark.kind === 'image' && typeof watermark.key === 'string' ? await watermarkImageUrl(watermark.key) : null;
  return {
    ...gallery,
    settings: settingsParsed,
    sets: sets.map((s) => ({ id: s.id, name: s.name, position: s.position, photoCount: s.photo_count })),
    processing: settingsParsed.processing,
    watermark,
    imageUrl,
  };
}
