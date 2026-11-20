import { statement, type SqlValue, type Statement } from '@repo/db/client';

import { MAX_BULK_PHOTOS, type PhotoUpload } from './types';

/**
 * The writes of `photos` (plan p05 → Writes that must not race): pure builders for the callers'
 * batches. Bulk writes touch only this gallery's READY photos (`gallery_id = ? AND … status =
 * 'ready'`) and refuse more than 90 ids; each sets `updated_at = batchNow`, which the guarded bump
 * and the count increment of the same batch test (D5.12, D5.13).
 */

const ids = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function checkIds(name: string, list: readonly string[]): void {
  if (list.length === 0 || list.length > MAX_BULK_PHOTOS) throw new Error(`${name}: 1–${MAX_BULK_PHOTOS} ids`);
}

/**
 * The `sort_key` (D5.23) from BOUND keys and id (never the columns: an INSERT…SELECT has no new row to
 * read and an UPDATE's right-hand side sees the old one), in the order of `sortSql`'s current value.
 */
function composedSortKey(sortSql: string, p: { nameKey: string; takenKey: string; id: string }): { sql: string; params: SqlValue[] } {
  return {
    sql: `CASE ${sortSql} WHEN 'taken' THEN ? || '|' || ? || '|' || ? ELSE ? || '|' || ? || '|' || ? END`,
    params: [p.takenKey, p.nameKey, p.id, p.nameKey, p.takenKey, p.id],
  };
}

/**
 * Register one upload (D5.8): a row `uploading`, its `sort_key` composed from the live gallery's sort.
 * A deleted or missing gallery inserts nothing; a hash already in the gallery inserts nothing
 * (`RETURNING` is empty: read the conflict with `findPhotosByHash`); a set of another gallery fails
 * the composite FK (→ 400 `INVALID_SET`).
 */
export function insertUploadingPhotoStatement(p: PhotoUpload): Statement {
  const sort = composedSortKey(`json_extract(g.settings, '$.sort')`, p);
  return statement(
    `INSERT INTO photos (id, gallery_id, set_id, filename, name_key, taken_key, sort_key, content_type, original_bytes, bytes, width, height,
    taken_at, sha256, rev, derivative_ext, display_width, display_height, color, processing, meta, status, hidden, created_at, updated_at)
  SELECT ?, g.id, ?, ?, ?, ?, ${sort.sql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 0, ?, ?
  FROM galleries g WHERE g.id = ? AND g.deleted_at IS NULL
  ON CONFLICT (gallery_id, sha256) DO NOTHING
  RETURNING id`,
    [
      p.id,
      p.setId,
      p.filename,
      p.nameKey,
      p.takenKey,
      ...sort.params,
      p.contentType,
      p.originalBytes,
      p.bytes,
      p.width,
      p.height,
      p.takenAt,
      p.sha256,
      p.rev,
      p.derivativeExt,
      p.displayWidth,
      p.displayHeight,
      p.color,
      JSON.stringify(p.processing),
      JSON.stringify(p.meta),
      p.now,
      p.now,
      p.galleryId,
    ],
  );
}

/**
 * Resume (D5.9): an `uploading` row with this hash takes every declared field anew EXCEPT `rev` (so the
 * new PUTs overwrite any partial objects) and its set; `p.id` is the existing row's id. A row that
 * became ready meanwhile is left alone (0 changes).
 */
export function remintPhotoStatement(p: PhotoUpload): Statement {
  const sort = composedSortKey(`(SELECT json_extract(settings, '$.sort') FROM galleries WHERE id = ?)`, p);
  return statement(
    `UPDATE photos SET filename = ?, name_key = ?, taken_key = ?, sort_key = ${sort.sql}, content_type = ?, original_bytes = ?, bytes = ?,
    width = ?, height = ?, taken_at = ?, derivative_ext = ?, display_width = ?, display_height = ?, color = ?, processing = ?, meta = ?, updated_at = ?
  WHERE id = ? AND gallery_id = ? AND status = 'uploading'`,
    [
      p.filename,
      p.nameKey,
      p.takenKey,
      p.galleryId,
      ...sort.params,
      p.contentType,
      p.originalBytes,
      p.bytes,
      p.width,
      p.height,
      p.takenAt,
      p.derivativeExt,
      p.displayWidth,
      p.displayHeight,
      p.color,
      JSON.stringify(p.processing),
      JSON.stringify(p.meta),
      p.now,
      p.id,
      p.galleryId,
    ],
  );
}

/** Complete (D5.8): `uploading` → `ready`, once; `batchNow` marks it for the increment and the bump. */
export function markReadyStatement(input: { galleryId: string; id: string; batchNow: string }): Statement {
  return statement(`UPDATE photos SET status = 'ready', updated_at = ? WHERE id = ? AND gallery_id = ? AND status = 'uploading'`, [
    input.batchNow,
    input.id,
    input.galleryId,
  ]);
}

/** Move ready photos to another set of the SAME gallery (the composite FK refuses another's). */
export function bulkMoveStatement(input: { galleryId: string; ids: readonly string[]; setId: string; batchNow: string }): Statement {
  checkIds('bulkMoveStatement', input.ids);
  return statement(
    `UPDATE photos SET set_id = ?, updated_at = ? WHERE gallery_id = ? AND id IN (${ids(input.ids.length)}) AND status = 'ready' AND set_id != ?`,
    [input.setId, input.batchNow, input.galleryId, ...input.ids, input.setId],
  );
}

/** Hide or show ready photos; a photo already in that state is not written (no bump, no audit). */
export function bulkHideStatement(input: { galleryId: string; ids: readonly string[]; hidden: boolean; batchNow: string }): Statement {
  checkIds('bulkHideStatement', input.ids);
  const to = input.hidden ? 1 : 0;
  return statement(
    `UPDATE photos SET hidden = ?, updated_at = ? WHERE gallery_id = ? AND id IN (${ids(input.ids.length)}) AND status = 'ready' AND hidden = ?`,
    [to, input.batchNow, input.galleryId, ...input.ids, 1 - to],
  );
}

/** Delete ready photos: `deleted`, and the hash released (D5.9) so dropping the file again uploads it anew. */
export function bulkDeleteStatement(input: { galleryId: string; ids: readonly string[]; batchNow: string }): Statement {
  checkIds('bulkDeleteStatement', input.ids);
  return statement(
    `UPDATE photos SET status = 'deleted', sha256 = NULL, updated_at = ? WHERE gallery_id = ? AND id IN (${ids(input.ids.length)}) AND status = 'ready'`,
    [input.batchNow, input.galleryId, ...input.ids],
  );
}

/**
 * Re-sort a gallery (D5.23), in the same batch AFTER the settings write that stores the new sort: one
 * statement that reads the committed sort and rewrites every key from the columns.
 */
export function resortStatement(galleryId: string): Statement {
  return statement(
    `UPDATE photos SET sort_key = CASE (SELECT json_extract(settings, '$.sort') FROM galleries WHERE id = ?)
    WHEN 'taken' THEN taken_key || '|' || name_key || '|' || id
    ELSE name_key || '|' || taken_key || '|' || id END
  WHERE gallery_id = ?`,
    [galleryId, galleryId],
  );
}

/** Uploads left unfinished for a day: at most this many are claimed per purge run. */
export const PURGE_BATCH = 90;

/**
 * Claim stale uploads for the purge (D5.17): `uploading` and untouched since `staleBefore` (now − 24 h)
 * → `deleted`, hash released. The inner SELECT and the outer WHERE repeat ix_photos_purge's predicate
 * and the staleness, so a row completed or re-minted meanwhile is never claimed.
 */
export function claimStaleUploadsStatement(input: { now: string; staleBefore: string }): Statement {
  const stale = `status IN ('uploading', 'deleted') AND status = 'uploading' AND updated_at < ?`;
  return statement(
    `UPDATE photos SET status = 'deleted', sha256 = NULL, updated_at = ?
  WHERE id IN (SELECT id FROM photos WHERE ${stale} LIMIT ${PURGE_BATCH}) AND ${stale}`,
    [input.now, input.staleBefore, input.staleBefore],
  );
}

/** The purge's row delete, after the objects went: only rows still `deleted`. */
export function deletePhotosStatement(photoIds: readonly string[]): Statement {
  checkIds('deletePhotosStatement', photoIds);
  return statement(`DELETE FROM photos WHERE id IN (${ids(photoIds.length)}) AND status = 'deleted'`, [...photoIds]);
}

/**
 * `gallery.purge`'s row delete (D5.17): these photos of a gallery whose purge window has passed, any
 * status. The EXISTS repeats the purge condition, so a gallery restored meanwhile keeps its photos.
 */
export function deletePurgedGalleryPhotosStatement(input: { galleryId: string; ids: readonly string[]; purgeBefore: string }): Statement {
  checkIds('deletePurgedGalleryPhotosStatement', input.ids);
  return statement(
    `DELETE FROM photos WHERE gallery_id = ? AND id IN (${ids(input.ids.length)})
  AND EXISTS (SELECT 1 FROM galleries WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?)`,
    [input.galleryId, ...input.ids, input.galleryId, input.purgeBefore],
  );
}
