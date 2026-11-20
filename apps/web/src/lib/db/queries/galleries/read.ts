import { all, allRows, first, firstRow, statement, type Options } from '@repo/db/client';

import { GALLERY_COLUMNS, toGalleryRow, type GalleryCursor, type GalleryDbRow, type GalleryRow } from './types';

/** A gallery by id, deleted or not (the caller decides: most routes answer 404 for a deleted one). */
export function getGallery(id: string, opts?: Options): Promise<GalleryRow | null> {
  return firstRow<GalleryDbRow, GalleryRow>(statement(`SELECT ${GALLERY_COLUMNS} FROM galleries WHERE id = ?`, [id]), toGalleryRow, opts);
}

/** A live gallery by slug (uq_galleries_slug); a deleted one reads as missing. */
export function getGalleryBySlug(slug: string, opts?: Options): Promise<GalleryRow | null> {
  return firstRow<GalleryDbRow, GalleryRow>(
    statement(`SELECT ${GALLERY_COLUMNS} FROM galleries WHERE slug = ? AND deleted_at IS NULL`, [slug]),
    toGalleryRow,
    opts,
  );
}

export const MAX_GALLERY_PAGE = 50;

/**
 * The galleries list, newest first, through ix_galleries_list (`deleted_at`, `created_at`): live
 * galleries, or with `deleted` the soft-deleted ones (the Deleted filter). Keyset paging by
 * (`created_at`, `id`); `limit` is clamped to 1–50.
 */
export function listGalleries(
  input: { deleted?: boolean; cursor?: GalleryCursor | null; limit?: number } = {},
  opts?: Options,
): Promise<GalleryRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? MAX_GALLERY_PAGE, MAX_GALLERY_PAGE));
  const where = [input.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (input.cursor) {
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    params.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
  }
  return allRows<GalleryDbRow, GalleryRow>(
    statement(`SELECT ${GALLERY_COLUMNS} FROM galleries WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, limit]),
    toGalleryRow,
    opts,
  );
}

/**
 * The sealed password (D5.11), or null for a link gallery or a missing one. Only
 * lib/galleries/password.ts and the `gallery.ready` template's `load` call this.
 */
export async function getGalleryPasswordSealed(id: string, opts?: Options): Promise<string | null> {
  const row = await first<{ password_sealed: string | null }>(statement('SELECT password_sealed FROM galleries WHERE id = ?', [id]), opts);
  return row?.password_sealed ?? null;
}

/**
 * Soft-deleted galleries whose purge window has passed (housekeeping's sweep, D5.17), oldest first,
 * through ix_galleries_list (`deleted_at` first). Ids only; `limit` ≤ 50.
 */
export async function listPurgeDueGalleries(input: { purgeBefore: string; limit: number }, opts?: Options): Promise<string[]> {
  const limit = Math.max(1, Math.min(input.limit, MAX_GALLERY_PAGE));
  const rows = await all<{ id: string }>(
    statement('SELECT id FROM galleries WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY deleted_at LIMIT ?', [input.purgeBefore, limit]),
    opts,
  );
  return rows.map((r) => r.id);
}
