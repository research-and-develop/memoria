import 'server-only';

import { AppError } from '@repo/core/error';
import { batch, type Options, type Statement } from '@repo/db/client';
import { logger } from '@repo/logger';
import { blobUrls, type SignedUpload } from '@repo/platform/blobUrls';
import { getPlatform } from '@repo/platform/current';
import type { BlobMeta } from '@repo/platform/ports';

import { bumpContentStatement, coverDefaultStatement, galleryCountStatement, photosChangedAt } from '@/lib/db/queries/galleries';
import { incrementSetCountsStatement } from '@/lib/db/queries/photo_sets';
import {
  findPhotosByHash,
  getPhotos,
  insertUploadingPhotoStatement,
  markReadyStatement,
  remintPhotoStatement,
  type PhotoRow,
  type PhotoUpload,
} from '@/lib/db/queries/photos';

import { requireGallery } from './galleries';
import { displayKey, newRev, originalKey, photoKeys, thumbKey } from './keys';
import { MAX_DERIVATIVE_BYTES, type RegisterInput, type UploadPhotoInput } from './parseUploadInput';
import { nameKey, takenKey } from './sortKey';

/**
 * The two-phase upload (plan p05 D5.8, D5.9). Register: one `uploading` row per new hash, a re-mint for
 * an unfinished one, nothing for a finished one, and three presigned PUTs per photo (CPU only, no
 * subrequest). Complete: `head()` the three objects, then mark ready, count, cover and bump in ONE
 * batch. Nothing streams through the Worker (AGENTS.md → Media).
 */

/** A presigned PUT lives 10 minutes: purges of stale uploads start after 24 hours, so no object can be orphaned. */
export const UPLOAD_URL_SECONDS = 600;

export type RegisteredPhoto = {
  sha256: string;
  status: 'new' | 'resume' | 'duplicate';
  photoId?: string;
  uploads?: { original: SignedUpload; thumb: SignedUpload; display: SignedUpload };
};

const derivativeType = (ext: 'webp' | 'jpg') => (ext === 'webp' ? 'image/webp' : 'image/jpeg');

function invalidSet(): AppError {
  return new AppError('Set of another gallery', 'INVALID_SET', { status: 400, field: 'setId', message: 'Choose a set of this gallery.' });
}

function rowOf(galleryId: string, setId: string, p: UploadPhotoInput, id: string, rev: string, processing: Record<string, unknown>, now: string): PhotoUpload {
  return {
    id,
    galleryId,
    setId,
    filename: p.filename,
    nameKey: nameKey(p.filename),
    takenKey: takenKey(p.takenAt),
    contentType: p.contentType,
    originalBytes: p.bytes.original,
    bytes: p.bytes.original + p.bytes.thumb + p.bytes.display,
    width: p.width,
    height: p.height,
    takenAt: p.takenAt,
    sha256: p.sha256,
    rev,
    derivativeExt: p.derivativeExt,
    displayWidth: p.displayWidth,
    displayHeight: p.displayHeight,
    color: p.color,
    processing,
    meta: p.meta,
    now,
  };
}

async function signedUploads(galleryId: string, id: string, rev: string, p: UploadPhotoInput) {
  const urls = blobUrls(getPlatform().config());
  const type = derivativeType(p.derivativeExt);
  const opts = { expiresInSeconds: UPLOAD_URL_SECONDS };
  const [original, thumb, display] = await Promise.all([
    urls.uploadUrl(originalKey(galleryId, id, p.contentType), { contentType: p.contentType, size: p.bytes.original, bucket: 'originals', ...opts }),
    urls.uploadUrl(thumbKey(galleryId, id, rev, p.derivativeExt), { contentType: type, size: p.bytes.thumb, ...opts }),
    urls.uploadUrl(displayKey(galleryId, id, rev, p.derivativeExt), { contentType: type, size: p.bytes.display, ...opts }),
  ]);
  return { original, thumb, display };
}

export async function registerUploads(galleryId: string, input: RegisterInput, opts?: Options): Promise<RegisteredPhoto[]> {
  const gallery = await requireGallery(galleryId, opts);
  if (!gallery.sets.some((s) => s.id === input.setId)) throw invalidSet();
  const processing = gallery.settingsParsed.processing as unknown as Record<string, unknown>;
  const now = new Date().toISOString();
  const fresh = input.photos.map((p) => ({ p, id: crypto.randomUUID(), rev: newRev() }));

  let results;
  try {
    results = await batch<{ id: string }>(fresh.map(({ p, id, rev }) => insertUploadingPhotoStatement(rowOf(galleryId, input.setId, p, id, rev, processing, now))), opts);
  } catch (error) {
    if (error instanceof Error && /FOREIGN KEY/.test(error.message)) throw invalidSet();
    throw error;
  }
  const inserted = new Set(fresh.filter((_, i) => (results[i]?.rows.length ?? 0) > 0).map((f) => f.id));
  const conflicts = fresh.filter((f) => !inserted.has(f.id));
  const known = await findPhotosByHash({ galleryId, hashes: conflicts.map((c) => c.p.sha256) }, opts);
  if (conflicts.length > 0 && known.length < conflicts.length) {
    // A hash that neither inserted nor exists: the gallery was deleted meanwhile.
    throw new AppError('Gallery gone', 'NOT_FOUND', { status: 404, message: 'This gallery does not exist.' });
  }

  // Resume: an unfinished photo takes the new declaration, keeps its id and rev (the PUTs overwrite).
  const remints: Statement[] = [];
  const staleDerivatives: string[] = [];
  const resumed = new Map<string, { id: string; rev: string }>();
  for (const { p } of conflicts) {
    const row = known.find((k) => k.sha256 === p.sha256)!;
    if (row.status !== 'uploading') continue;
    remints.push(remintPhotoStatement(rowOf(galleryId, input.setId, p, row.id, row.rev, processing, now)));
    resumed.set(p.sha256, { id: row.id, rev: row.rev });
    if (row.derivative_ext !== p.derivativeExt) {
      staleDerivatives.push(thumbKey(galleryId, row.id, row.rev, row.derivative_ext), displayKey(galleryId, row.id, row.rev, row.derivative_ext));
    }
  }
  if (remints.length > 0) await batch(remints, opts);
  if (staleDerivatives.length > 0) await getPlatform().blobs('media').delete(staleDerivatives);

  return Promise.all(
    fresh.map(async ({ p, id, rev }): Promise<RegisteredPhoto> => {
      if (inserted.has(id)) return { sha256: p.sha256, status: 'new', photoId: id, uploads: await signedUploads(galleryId, id, rev, p) };
      const resume = resumed.get(p.sha256);
      if (resume) return { sha256: p.sha256, status: 'resume', photoId: resume.id, uploads: await signedUploads(galleryId, resume.id, resume.rev, p) };
      return { sha256: p.sha256, status: 'duplicate', photoId: known.find((k) => k.sha256 === p.sha256)?.id };
    }),
  );
}

export type CompleteResult = { ready: string[]; failed: { id: string; reason: 'UPLOAD_MISSING' | 'UPLOAD_MISMATCH' | 'NOT_FOUND' }[] };

/** The objects of one photo as stored, against what was declared. */
async function checkObjects(photo: PhotoRow): Promise<'ok' | 'UPLOAD_MISSING' | 'UPLOAD_MISMATCH'> {
  const keys = photoKeys(photo);
  const platform = getPlatform();
  const [original, thumb, display] = await Promise.all([
    platform.blobs('originals').head(keys.original),
    platform.blobs('media').head(keys.thumb),
    platform.blobs('media').head(keys.display),
  ]);
  if (!original || !thumb || !display) return 'UPLOAD_MISSING';
  const type = derivativeType(photo.derivative_ext);
  const typed = (meta: BlobMeta, want: string) => (meta.contentType ?? '').split(';')[0]!.trim().toLowerCase() === want;
  const ok =
    original.size === photo.original_bytes &&
    thumb.size + display.size === photo.bytes - photo.original_bytes &&
    thumb.size <= MAX_DERIVATIVE_BYTES &&
    display.size <= MAX_DERIVATIVE_BYTES &&
    typed(original, photo.content_type) &&
    typed(thumb, type) &&
    typed(display, type);
  return ok ? 'ok' : 'UPLOAD_MISMATCH';
}

/**
 * Complete (D5.8): checks each `uploading` photo's three objects, then ONE batch marks the good ones
 * ready, adds them to their sets' counts (only the ones marked in this batch), recounts the gallery,
 * picks a cover if it has none and bumps the content version if anything changed. A repeat marks
 * nothing, adds 0 and bumps nothing. A mismatched upload's objects are deleted (the photo stays
 * `uploading` and its PUTs can be redone by re-dropping the file).
 */
export async function completeUploads(galleryId: string, photoIds: readonly string[], opts?: Options): Promise<CompleteResult> {
  await requireGallery(galleryId, opts);
  const photos = await getPhotos({ galleryId, ids: photoIds }, opts);
  const result: CompleteResult = { ready: [], failed: [] };
  const toMark: PhotoRow[] = [];
  for (const id of photoIds) {
    const photo = photos.find((p) => p.id === id);
    if (!photo || photo.status === 'deleted') result.failed.push({ id, reason: 'NOT_FOUND' });
    else if (photo.status === 'ready') result.ready.push(id);
  }
  const checks = await Promise.all(photos.filter((p) => p.status === 'uploading').map(async (p) => ({ photo: p, check: await checkObjects(p) })));
  const mismatched: string[] = [];
  for (const { photo, check } of checks) {
    if (check === 'ok') toMark.push(photo);
    else {
      result.failed.push({ id: photo.id, reason: check });
      if (check === 'UPLOAD_MISMATCH') mismatched.push(photo.id);
    }
  }
  for (const id of mismatched) {
    const keys = photoKeys(photos.find((p) => p.id === id)!);
    await Promise.all([getPlatform().blobs('originals').delete([keys.original]), getPlatform().blobs('media').delete([keys.thumb, keys.display])]);
    logger.warn({ event: 'upload_mismatch', galleryId, photoId: id });
  }

  if (toMark.length > 0) {
    const batchNow = new Date().toISOString();
    const ids = toMark.map((p) => p.id);
    await batch(
      [
        ...ids.map((id) => markReadyStatement({ galleryId, id, batchNow })),
        incrementSetCountsStatement({ galleryId, setIds: [...new Set(toMark.map((p) => p.set_id))], photoIds: ids, batchNow }),
        galleryCountStatement(galleryId),
        coverDefaultStatement(galleryId),
        bumpContentStatement({ id: galleryId, now: batchNow, when: photosChangedAt(galleryId, batchNow) }),
      ],
      opts,
    );
    result.ready.push(...ids);
  }
  // In the request's order, whatever order the rows came back in.
  const order = (id: string) => photoIds.indexOf(id);
  result.ready.sort((a, b) => order(a) - order(b));
  result.failed.sort((a, b) => order(a.id) - order(b.id));
  return result;
}
