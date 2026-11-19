import { readJson, toBool } from '@repo/db/rows';

/** Must match the CHECKs of migration 0006. */
export const PHOTO_STATUSES = ['uploading', 'ready', 'deleted'] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];
export const DERIVATIVE_EXTS = ['webp', 'jpg'] as const;
export type DerivativeExt = (typeof DERIVATIVE_EXTS)[number];
export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Bulk writes take at most this many ids (≤ 93 parameters per statement). */
export const MAX_BULK_PHOTOS = 90;
/** A manager page of photos. */
export const MAX_PHOTO_PAGE = 200;

/** Mirrors `photos` (plan p05 → Data), JSON parsed and `hidden` a boolean. `name_key`/`taken_key` stay inside. */
export type PhotoRow = {
  id: string;
  gallery_id: string;
  set_id: string;
  filename: string;
  sort_key: string;
  content_type: PhotoContentType;
  original_bytes: number;
  bytes: number;
  width: number;
  height: number;
  taken_at: string | null;
  sha256: string | null;
  rev: string;
  derivative_ext: DerivativeExt;
  display_width: number;
  display_height: number;
  color: string;
  processing: Record<string, unknown>;
  meta: Record<string, unknown>;
  status: PhotoStatus;
  hidden: boolean;
  created_at: string;
  updated_at: string;
};

export type PhotoDbRow = Omit<PhotoRow, 'processing' | 'meta' | 'hidden'> & { processing: string; meta: string; hidden: number };

export const PHOTO_COLUMNS =
  'id, gallery_id, set_id, filename, sort_key, content_type, original_bytes, bytes, width, height, taken_at, sha256, rev, derivative_ext, display_width, display_height, color, processing, meta, status, hidden, created_at, updated_at';

const object = (json: string): Record<string, unknown> => {
  const value = readJson<unknown>(json, {});
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

export function toPhotoRow(row: PhotoDbRow): PhotoRow {
  return { ...row, processing: object(row.processing), meta: object(row.meta), hidden: toBool(row.hidden) };
}

/**
 * A registered upload (D5.8, D5.9). `nameKey`/`takenKey` come from lib/galleries/sortKey.ts; the
 * `sort_key` is composed in SQL from them, the id and the gallery's CURRENT sort (D5.23).
 */
export type PhotoUpload = {
  id: string;
  galleryId: string;
  setId: string;
  filename: string;
  nameKey: string;
  takenKey: string;
  contentType: PhotoContentType;
  originalBytes: number;
  /** Original + both derivatives. */
  bytes: number;
  width: number;
  height: number;
  takenAt: string | null;
  sha256: string;
  rev: string;
  derivativeExt: DerivativeExt;
  displayWidth: number;
  displayHeight: number;
  color: string;
  processing: Record<string, unknown>;
  meta: Record<string, unknown>;
  /** ISO time: created_at and updated_at. */
  now: string;
};

/** What a register request learns about a hash already in the gallery. */
export type KnownPhoto = { id: string; sha256: string; status: PhotoStatus; rev: string; derivative_ext: DerivativeExt };

/** What the purge needs to derive a photo's keys (lib/galleries/keys.ts). */
export type PurgeablePhoto = { id: string; gallery_id: string; content_type: PhotoContentType; rev: string; derivative_ext: DerivativeExt };
