import { all, allRows, first, statement, type Options } from '@repo/db/client';

import { MAX_BULK_PHOTOS, MAX_PHOTO_PAGE, PHOTO_COLUMNS, toPhotoRow, type KnownPhoto, type PhotoDbRow, type PhotoRow, type PurgeablePhoto } from './types';

const ids = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * A manager page of one set (D5.14): ready and uploading photos, hidden included, in `sort_key`
 * order through ix_photos_set_order. `after` = the last `sort_key` of the previous page (the route
 * decodes the cursor). A set of another gallery returns nothing. `limit` is clamped to 1–200.
 */
export function listSetPhotos(
  input: { galleryId: string; setId: string; after?: string | null; limit?: number },
  opts?: Options,
): Promise<PhotoRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? MAX_PHOTO_PAGE, MAX_PHOTO_PAGE));
  const after = input.after ? ' AND sort_key > ?' : '';
  return allRows<PhotoDbRow, PhotoRow>(
    statement(
      `SELECT ${PHOTO_COLUMNS} FROM photos
  WHERE set_id = ?${after} AND gallery_id = ? AND status IN ('uploading', 'ready')
  ORDER BY sort_key LIMIT ?`,
      [input.setId, ...(input.after ? [input.after] : []), input.galleryId, limit],
    ),
    toPhotoRow,
    opts,
  );
}

/** Photos of this gallery by id (the complete request's `head()` checks; ≤ 90 ids). */
export function getPhotos(input: { galleryId: string; ids: readonly string[] }, opts?: Options): Promise<PhotoRow[]> {
  if (input.ids.length === 0) return Promise.resolve([]);
  if (input.ids.length > MAX_BULK_PHOTOS) throw new Error(`getPhotos: at most ${MAX_BULK_PHOTOS} ids`);
  return allRows<PhotoDbRow, PhotoRow>(
    statement(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE gallery_id = ? AND id IN (${ids(input.ids.length)})`, [input.galleryId, ...input.ids]),
    toPhotoRow,
    opts,
  );
}

/** The rows that already hold some of these hashes (the conflicts of a register batch, D5.9). */
export function findPhotosByHash(input: { galleryId: string; hashes: readonly string[] }, opts?: Options): Promise<KnownPhoto[]> {
  if (input.hashes.length === 0) return Promise.resolve([]);
  if (input.hashes.length > MAX_BULK_PHOTOS) throw new Error(`findPhotosByHash: at most ${MAX_BULK_PHOTOS} hashes`);
  return all<KnownPhoto>(
    statement(`SELECT id, sha256, status, rev, derivative_ext FROM photos WHERE gallery_id = ? AND sha256 IN (${ids(input.hashes.length)})`, [
      input.galleryId,
      ...input.hashes,
    ]),
    opts,
  );
}

/**
 * Deleted photos waiting for their objects to go (D5.17), oldest first, through ix_photos_purge (the
 * WHERE repeats its predicate). Optionally one gallery's. `limit` ≤ 90.
 */
export function listPurgeablePhotos(input: { galleryId?: string; limit: number }, opts?: Options): Promise<PurgeablePhoto[]> {
  const limit = Math.max(1, Math.min(input.limit, MAX_BULK_PHOTOS));
  const gallery = input.galleryId ? ' AND gallery_id = ?' : '';
  return all<PurgeablePhoto>(
    statement(
      `SELECT id, gallery_id, content_type, rev, derivative_ext FROM photos
  WHERE status IN ('uploading', 'deleted') AND status = 'deleted'${gallery}
  ORDER BY updated_at LIMIT ?`,
      [...(input.galleryId ? [input.galleryId] : []), limit],
    ),
    opts,
  );
}

/** The cover photos of a page of galleries (≤ 50 ids, by primary key): what a card's thumbnail needs. */
export function getCoverPhotos(photoIds: readonly string[], opts?: Options): Promise<Pick<PhotoRow, 'id' | 'gallery_id' | 'rev' | 'derivative_ext'>[]> {
  if (photoIds.length === 0) return Promise.resolve([]);
  if (photoIds.length > MAX_BULK_PHOTOS) throw new Error(`getCoverPhotos: at most ${MAX_BULK_PHOTOS} ids`);
  return all(
    statement(`SELECT id, gallery_id, rev, derivative_ext FROM photos WHERE id IN (${ids(photoIds.length)}) AND status = 'ready'`, [...photoIds]),
    opts,
  );
}

/** The cap of `countUnfinishedUploads`: the banner says "1000+" past it. */
export const MAX_UNFINISHED_COUNT = 1000;

/**
 * How many uploads of this gallery never finished (`uploading` rows: the manager's resume banner),
 * through ix_photos_purge (the WHERE repeats its predicate), counted up to `MAX_UNFINISHED_COUNT`.
 */
export async function countUnfinishedUploads(galleryId: string, opts?: Options): Promise<number> {
  const row = await first<{ n: number }>(
    statement(
      `SELECT count(*) AS n FROM (SELECT 1 FROM photos
  WHERE status IN ('uploading', 'deleted') AND status = 'uploading' AND gallery_id = ? LIMIT ?)`,
      [galleryId, MAX_UNFINISHED_COUNT],
    ),
    opts,
  );
  return row?.n ?? 0;
}
