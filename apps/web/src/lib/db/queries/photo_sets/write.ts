import { statement, type SqlValue, type Statement } from '@repo/db/client';

import { MAX_SETS } from './types';

/**
 * The writes of `photo_sets` (plan p05 → Writes that must not race): pure builders for the callers'
 * batches. The 50-set cap, the never-the-last-set rule and the "no photo row left" rule are in the
 * statements' WHERE, so they hold under concurrent requests.
 */

const ids = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * A new set at the end (position = the highest + 1), only while the gallery has fewer than 50 and is
 * not deleted: 0 changes = 400 `TOO_MANY_SETS` (or a deleted gallery, which the route checked).
 */
export function insertSetStatement(input: { id: string; galleryId: string; name: string; now: string }): Statement {
  return statement(
    `INSERT INTO photo_sets (id, gallery_id, name, position, created_at, updated_at)
  SELECT ?, g.id, ?, (SELECT coalesce(max(position) + 1, 0) FROM photo_sets WHERE gallery_id = g.id), ?, ?
  FROM galleries g
  WHERE g.id = ? AND g.deleted_at IS NULL AND (SELECT count(*) FROM photo_sets WHERE gallery_id = g.id) < ${MAX_SETS}`,
    [input.id, input.name, input.now, input.now, input.galleryId],
  );
}

export function renameSetStatement(input: { id: string; galleryId: string; name: string; now: string }): Statement {
  return statement('UPDATE photo_sets SET name = ?, updated_at = ? WHERE id = ? AND gallery_id = ? AND name != ?', [
    input.name,
    input.now,
    input.id,
    input.galleryId,
    input.name,
  ]);
}

/** 3 parameters per set, ≤ 32 sets per statement (≤ 100 parameters with the rest): ≤ 2 statements for 50 sets. */
export const SETS_PER_REORDER_STATEMENT = 32;

/** Positions 0…n−1 in the given order, rewritten whole in the caller's batch. Ids of another gallery are ignored. */
export function reorderSetsStatements(input: { galleryId: string; orderedIds: readonly string[]; now: string }): Statement[] {
  const statements: Statement[] = [];
  for (let start = 0; start < input.orderedIds.length; start += SETS_PER_REORDER_STATEMENT) {
    const chunk = input.orderedIds.slice(start, start + SETS_PER_REORDER_STATEMENT);
    const cases: SqlValue[] = chunk.flatMap((id, i) => [id, start + i]);
    statements.push(
      statement(
        `UPDATE photo_sets SET position = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END, updated_at = ?
  WHERE gallery_id = ? AND id IN (${ids(chunk.length)})`,
        [...cases, input.now, input.galleryId, ...chunk],
      ),
    );
  }
  return statements;
}

/**
 * Deletes an empty set: never the last one, never one any photo row references (a `deleted` one
 * included, until the purge removes it), so the FK never turns into a 500. 0 changes = 409 `SET_NOT_EMPTY`.
 */
export function deleteSetStatement(input: { id: string; galleryId: string }): Statement {
  return statement(
    `DELETE FROM photo_sets WHERE id = ? AND gallery_id = ?
  AND NOT EXISTS (SELECT 1 FROM photos WHERE set_id = ?)
  AND (SELECT count(*) FROM photo_sets WHERE gallery_id = ?) > 1`,
    [input.id, input.galleryId, input.id, input.galleryId],
  );
}

/**
 * The complete batch (D5.13): each touched set gains the photos marked ready IN THIS BATCH (the mark
 * statements set `updated_at = batchNow`), so a repeated complete adds 0. `photoIds` ≤ 8.
 */
export function incrementSetCountsStatement(input: { galleryId: string; setIds: readonly string[]; photoIds: readonly string[]; batchNow: string }): Statement {
  return statement(
    `UPDATE photo_sets SET photo_count = photo_count + (
    SELECT count(*) FROM photos
    WHERE set_id = photo_sets.id AND id IN (${ids(input.photoIds.length)}) AND status = 'ready' AND hidden = 0 AND updated_at = ?)
  WHERE gallery_id = ? AND id IN (${ids(input.setIds.length)})`,
    [...input.photoIds, input.batchNow, input.galleryId, ...input.setIds],
  );
}

/** Recount the touched sets from their rows (bulk move/hide/delete); heals any drift. Written only when it differs. */
export function recountSetsStatement(input: { galleryId: string; setIds: readonly string[] }): Statement {
  const count = `(SELECT count(*) FROM photos WHERE set_id = photo_sets.id AND status = 'ready' AND hidden = 0)`;
  return statement(`UPDATE photo_sets SET photo_count = ${count} WHERE gallery_id = ? AND id IN (${ids(input.setIds.length)}) AND photo_count != ${count}`, [
    input.galleryId,
    ...input.setIds,
  ]);
}

/** The purge's last steps: every set of a gallery (after its photos). */
export function deleteGallerySetsStatement(galleryId: string): Statement {
  return statement('DELETE FROM photo_sets WHERE gallery_id = ?', [galleryId]);
}

/** `gallery.purge`'s last step (D5.17): the sets, only while the gallery's purge window has passed. */
export function deletePurgedGallerySetsStatement(input: { galleryId: string; purgeBefore: string }): Statement {
  return statement(
    'DELETE FROM photo_sets WHERE gallery_id = ? AND EXISTS (SELECT 1 FROM galleries WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?)',
    [input.galleryId, input.galleryId, input.purgeBefore],
  );
}
