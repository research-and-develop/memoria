import { run, statement, type Options, type SqlValue, type Statement, type WriteResult } from '@repo/db/client';

import type { Condition, GalleryAccess, GalleryInsert, GalleryPatch } from './types';

/**
 * The writes of `galleries` (plan p05 → Writes that must not race). Pure `*Statement` builders for
 * the callers' batches; each WHERE carries its own guarantee, none reads first. Every write but
 * restore and the purge's delete leaves a soft-deleted gallery alone (`deleted_at IS NULL`).
 * Timestamps are `Date#toISOString()`.
 */

export function insertGalleryStatement(input: GalleryInsert): Statement {
  return statement(
    `INSERT INTO galleries (id, slug, title, shoot_date, client_name, client_email, purpose, access, password_sealed, delivery, settings, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.slug,
      input.title,
      input.shootDate,
      input.clientName,
      input.clientEmail,
      input.purpose,
      input.access,
      input.passwordSealed,
      input.delivery,
      JSON.stringify(input.settings),
      input.now,
      input.now,
    ],
  );
}

/** Only the fields in `patch` (D5.10); settings merged with `json_patch`. A deleted gallery: 0 changes. */
export function updateGalleryStatement(input: { id: string; patch: GalleryPatch; now: string }): Statement {
  const sets: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  const { patch } = input;
  if (patch.title !== undefined) set('title', patch.title);
  if (patch.shootDate !== undefined) set('shoot_date', patch.shootDate);
  if (patch.clientName !== undefined) set('client_name', patch.clientName);
  if (patch.clientEmail !== undefined) set('client_email', patch.clientEmail);
  if (patch.slug !== undefined) set('slug', patch.slug);
  if (patch.settingsPatch !== undefined) {
    sets.push('settings = json_patch(settings, ?)');
    params.push(JSON.stringify(patch.settingsPatch));
  }
  set('updated_at', input.now);
  return statement(`UPDATE galleries SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, [...params, input.id]);
}

/** "Some photo of the gallery was written in this batch" (`updated_at = ?batchNow`, D5.12). */
export function photosChangedAt(galleryId: string, batchNow: string): Condition {
  return { sql: 'EXISTS (SELECT 1 FROM photos WHERE gallery_id = ? AND updated_at = ?)', params: [galleryId, batchNow] };
}

/**
 * `content_version + 1` (Phase 6's cache key, D5.12), only when `when` holds: `CHANGED` right after
 * the statement it is about, or `photosChangedAt(…)` at the end of a photo batch. Without `when` it
 * always bumps (a settings PATCH, which always changes something).
 */
export function bumpContentStatement(input: { id: string; now: string; when?: Condition }): Statement {
  const guard = input.when ? ` AND ${input.when.sql}` : '';
  return statement(`UPDATE galleries SET content_version = content_version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL${guard}`, [
    input.now,
    input.id,
    ...(input.when?.params ?? []),
  ]);
}

/** The gallery's count = the sum of its sets' counts (≤ 50 rows); written only when it differs. */
export function galleryCountStatement(id: string): Statement {
  const sum = '(SELECT coalesce(sum(photo_count), 0) FROM photo_sets WHERE gallery_id = ?)';
  return statement(`UPDATE galleries SET photo_count = ${sum} WHERE id = ? AND photo_count IS NOT ${sum}`, [id, id, id]);
}

/**
 * The automatic cover (D5.22): the first landscape photo by set position then `sort_key`, else the
 * first portrait; only while the gallery has none and a visible ready photo exists.
 */
export function coverDefaultStatement(id: string): Statement {
  return statement(
    `UPDATE galleries SET cover_photo_id = (
    SELECT p.id FROM photos p JOIN photo_sets s ON s.id = p.set_id
    WHERE p.gallery_id = ? AND p.status = 'ready' AND p.hidden = 0
    ORDER BY (p.width > p.height) DESC, s.position, p.sort_key LIMIT 1)
  WHERE id = ? AND cover_photo_id IS NULL
    AND EXISTS (SELECT 1 FROM photos WHERE gallery_id = ? AND status = 'ready' AND hidden = 0)`,
    [id, id, id],
  );
}

/** Clears a cover that is no longer a visible ready photo (hidden, deleted, moved out): D5.13. */
export function clearCoverStatement(id: string): Statement {
  return statement(
    `UPDATE galleries SET cover_photo_id = NULL
  WHERE id = ? AND cover_photo_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM photos WHERE id = galleries.cover_photo_id AND gallery_id = galleries.id AND status = 'ready' AND hidden = 0)`,
    [id],
  );
}

/** The photographer's *Set as cover*: only a visible ready photo of this gallery (else 0 changes). */
export function setCoverStatement(input: { galleryId: string; photoId: string; now: string }): Statement {
  return statement(
    `UPDATE galleries SET cover_photo_id = ?, updated_at = ?
  WHERE id = ? AND deleted_at IS NULL AND cover_photo_id IS NOT ?
    AND EXISTS (SELECT 1 FROM photos WHERE id = ? AND gallery_id = ? AND status = 'ready' AND hidden = 0)`,
    [input.photoId, input.now, input.galleryId, input.photoId, input.photoId, input.galleryId],
  );
}

/** Draft → published (D5.19); `first_published_at` is set once. A repeat changes nothing. */
export function publishStatement(input: { id: string; now: string }): Statement {
  return statement(
    `UPDATE galleries SET status = 'published', published_at = ?, first_published_at = coalesce(first_published_at, ?), updated_at = ?
  WHERE id = ? AND status = 'draft' AND deleted_at IS NULL`,
    [input.now, input.now, input.now, input.id],
  );
}

/** Published → draft; `published_at` cleared in the same statement (ck_galleries_published). */
export function unpublishStatement(input: { id: string; now: string }): Statement {
  return statement(
    `UPDATE galleries SET status = 'draft', published_at = NULL, updated_at = ? WHERE id = ? AND status = 'published' AND deleted_at IS NULL`,
    [input.now, input.id],
  );
}

/**
 * Access and password together (ck_galleries_password): link → no password; password → the sealed
 * value. Every change bumps `password_version`, so Phase 6's access cookies end.
 */
export function changeAccessStatement(input: { id: string; access: GalleryAccess; passwordSealed: string | null; now: string }): Statement {
  return statement(
    `UPDATE galleries SET access = ?, password_sealed = ?, password_version = password_version + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [input.access, input.access === 'password' ? input.passwordSealed : null, input.now, input.id],
  );
}

/** Soft delete (D5.17): `deleted_at = now`; a repeat changes nothing. */
export function softDeleteGalleryStatement(input: { id: string; now: string }): Statement {
  return statement('UPDATE galleries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [input.now, input.now, input.id]);
}

/**
 * Restore, only inside the window: `deleted_at > windowStart` (= now − 7 days). The purge acts only
 * while `deleted_at <= windowStart`, so a restore and a purge never both succeed (D5.17).
 */
export function restoreGalleryStatement(input: { id: string; now: string; windowStart: string }): Statement {
  return statement('UPDATE galleries SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at > ?', [input.now, input.id, input.windowStart]);
}

/** The purge's last step: the gallery row, only once its window has passed (`purgeBefore` = now − 7 days). */
export function deleteGalleryStatement(input: { id: string; purgeBefore: string }): Statement {
  return statement('DELETE FROM galleries WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?', [input.id, input.purgeBefore]);
}

export function insertGallery(input: GalleryInsert, opts?: Options): Promise<WriteResult> {
  return run(insertGalleryStatement(input), opts);
}
