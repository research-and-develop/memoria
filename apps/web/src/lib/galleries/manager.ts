import 'server-only';

import { AppError } from '@repo/core/error';
import { batch, type Options, type Statement } from '@repo/db/client';
import { blobUrls } from '@repo/platform/blobUrls';
import { getPlatform } from '@repo/platform/current';

import { conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import { bumpContentStatement, CHANGED, clearCoverStatement, coverDefaultStatement, galleryCountStatement, photosChangedAt, setCoverStatement } from '@/lib/db/queries/galleries';
import { deleteSetStatement, insertSetStatement, recountSetsStatement, renameSetStatement, reorderSetsStatements } from '@/lib/db/queries/photo_sets';
import { bulkDeleteStatement, bulkHideStatement, bulkMoveStatement, getPhotos, listSetPhotos, type PhotoRow } from '@/lib/db/queries/photos';
import { nudgeRelay } from '@/lib/jobs/enqueue';

import { requireGallery } from './galleries';
import { thumbKey } from './keys';
import { photoChangeGuard, type PhotoChange } from './photoDependents';
import { mediaPurgeJobStatement } from './purge';
import { encodeCursor } from './sortKey';

/**
 * The gallery manager's writes and reads (plan p05 T5.6): sets, the photo pages, bulk actions and the
 * cover. Each write is one batch with its own guards; the content version moves only when something
 * changed (D5.12); audits carry ids and counts only.
 */

const audit = (galleryId: string, summary: string, details: Record<string, unknown>) =>
  conditionalAuditStatement({ action: 'update', entity: 'galleries', entityId: galleryId, summary, details }, CHANGED.sql, []);

function refused(code: string, status: number, message: string): AppError {
  return new AppError(code, code, { status, message });
}

// ── sets ─────────────────────────────────────────────────────────────────────

export async function addSet(galleryId: string, name: string, opts?: Options): Promise<string> {
  await requireGallery(galleryId, opts);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const [insert] = await batch([insertSetStatement({ id, galleryId, name, now }), bumpContentStatement({ id: galleryId, now, when: CHANGED })], opts);
  if ((insert?.changes ?? 0) === 0) throw refused('TOO_MANY_SETS', 400, 'A gallery can have up to 50 sets.');
  return id;
}

export async function renameSet(galleryId: string, setId: string, name: string, opts?: Options): Promise<void> {
  const gallery = await requireGallery(galleryId, opts);
  if (!gallery.sets.some((s) => s.id === setId)) throw refused('NOT_FOUND', 404, 'This set does not exist.');
  const now = new Date().toISOString();
  await batch([renameSetStatement({ id: setId, galleryId, name, now }), bumpContentStatement({ id: galleryId, now, when: CHANGED })], opts);
}

export async function removeSet(galleryId: string, setId: string, opts?: Options): Promise<void> {
  const gallery = await requireGallery(galleryId, opts);
  if (!gallery.sets.some((s) => s.id === setId)) throw refused('NOT_FOUND', 404, 'This set does not exist.');
  const now = new Date().toISOString();
  const [deleted] = await batch([deleteSetStatement({ id: setId, galleryId }), bumpContentStatement({ id: galleryId, now, when: CHANGED })], opts);
  if ((deleted?.changes ?? 0) === 0) {
    throw refused('SET_NOT_EMPTY', 409, gallery.sets.length <= 1 ? 'A gallery keeps at least one set.' : 'Photos are still in this set, or being removed: try again in a few minutes.');
  }
}

/** The whole order (every set id of the gallery, once). */
export async function reorderSets(galleryId: string, orderedIds: readonly string[], opts?: Options): Promise<void> {
  const gallery = await requireGallery(galleryId, opts);
  const known = new Set(gallery.sets.map((s) => s.id));
  if (orderedIds.length !== known.size || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => known.has(id))) {
    throw new AppError('Bad order', 'INVALID_PARAMS', { status: 400, field: 'ids', message: 'Send every set of the gallery once, in the new order.' });
  }
  const now = new Date().toISOString();
  await batch([...reorderSetsStatements({ galleryId, orderedIds, now }), bumpContentStatement({ id: galleryId, now })], opts);
}

// ── photos ───────────────────────────────────────────────────────────────────

export type ManagerPhoto = {
  id: string;
  filename: string;
  width: number;
  height: number;
  color: string;
  hidden: boolean;
  status: PhotoRow['status'];
  /** The thumbnail URL (public media domain, or the dev read route), or null without either. */
  thumbUrl: string | null;
};

export async function listManagerPhotos(
  galleryId: string,
  input: { setId: string; after: string | null },
  opts?: Options,
): Promise<{ photos: ManagerPhoto[]; next: string | null }> {
  const gallery = await requireGallery(galleryId, opts);
  if (!gallery.sets.some((s) => s.id === input.setId)) throw refused('NOT_FOUND', 404, 'This set does not exist.');
  const rows = await listSetPhotos({ galleryId, setId: input.setId, after: input.after }, opts);
  const urls = blobUrls(getPlatform().config());
  const thumbUrl = async (p: PhotoRow) => {
    if (p.status !== 'ready') return null;
    const key = thumbKey(galleryId, p.id, p.rev, p.derivative_ext);
    return urls.mode === 'dev' ? urls.readUrl(key, { expiresInSeconds: 3600 }) : urls.publicUrl(key);
  };
  const photos = await Promise.all(
    rows.map(async (p) => ({ id: p.id, filename: p.filename, width: p.width, height: p.height, color: p.color, hidden: p.hidden, status: p.status, thumbUrl: await thumbUrl(p) })),
  );
  const last = rows.length === 200 ? rows[rows.length - 1] : undefined;
  return { photos, next: last ? encodeCursor(last.sort_key) : null };
}

export type BulkAction = { action: 'move'; setId: string } | { action: 'hide' } | { action: 'show' } | { action: 'delete' };

/**
 * A bulk action on ≤ 90 of this gallery's ready photos (D5.13, D5.24): the guard hook first, then one
 * batch — the change, its audit only if it changed something, the cover cleared if it is no longer
 * visible, the touched sets recounted, the gallery recounted, the cover default, the guarded bump and,
 * for a delete, the `media.purge` job (at most one pending). Returns how many photos changed.
 */
export async function bulkPhotos(galleryId: string, ids: readonly string[], bulk: BulkAction, opts?: Options): Promise<number> {
  const gallery = await requireGallery(galleryId, opts);
  if (bulk.action === 'move' && !gallery.sets.some((s) => s.id === bulk.setId)) {
    throw new AppError('Set of another gallery', 'INVALID_SET', { status: 400, field: 'setId', message: 'Choose a set of this gallery.' });
  }
  await photoChangeGuard(galleryId, ids, bulk.action as PhotoChange);
  const before = await getPhotos({ galleryId, ids }, opts);
  const touchedSets = [...new Set([...before.map((p) => p.set_id), ...(bulk.action === 'move' ? [bulk.setId] : [])])];
  const batchNow = new Date().toISOString();
  const change: Statement =
    bulk.action === 'move'
      ? bulkMoveStatement({ galleryId, ids, setId: bulk.setId, batchNow })
      : bulk.action === 'delete'
        ? bulkDeleteStatement({ galleryId, ids, batchNow })
        : bulkHideStatement({ galleryId, ids, hidden: bulk.action === 'hide', batchNow });
  const statements: Statement[] = [
    change,
    audit(galleryId, `Photos: ${bulk.action}`, { event: `photos.${bulk.action}`, count: ids.length }),
    clearCoverStatement(galleryId),
    ...(touchedSets.length > 0 ? [recountSetsStatement({ galleryId, setIds: touchedSets })] : []),
    galleryCountStatement(galleryId),
    coverDefaultStatement(galleryId),
    bumpContentStatement({ id: galleryId, now: batchNow, when: photosChangedAt(galleryId, batchNow) }),
    ...(bulk.action === 'delete' ? [mediaPurgeJobStatement(new Date(batchNow))] : []),
  ];
  const [result] = await batch(statements, opts);
  const changed = result?.changes ?? 0;
  if (bulk.action === 'delete' && changed > 0) nudgeRelay();
  return changed;
}

/** *Set as cover*: a visible ready photo of this gallery (else 400 `INVALID_COVER`). */
export async function setCover(galleryId: string, photoId: string, opts?: Options): Promise<void> {
  const gallery = await requireGallery(galleryId, opts);
  if (gallery.cover_photo_id === photoId) return;
  const now = new Date().toISOString();
  const [result] = await batch(
    [setCoverStatement({ galleryId, photoId, now }), bumpContentStatement({ id: galleryId, now, when: CHANGED }), audit(galleryId, 'Changed the cover', { event: 'cover' })],
    opts,
  );
  if ((result?.changes ?? 0) === 0) throw refused('INVALID_COVER', 400, 'Choose a visible photo of this gallery as the cover.');
}
