import { readJson } from '@repo/db/rows';
import type { SqlValue } from '@repo/db/client';

/** Must match the CHECKs of migration 0006. */
export const GALLERY_PURPOSES = ['selection', 'sharing'] as const;
export type GalleryPurpose = (typeof GALLERY_PURPOSES)[number];
export const GALLERY_STATUSES = ['draft', 'published'] as const;
export type GalleryStatus = (typeof GALLERY_STATUSES)[number];
export const GALLERY_ACCESS = ['link', 'password'] as const;
export type GalleryAccess = (typeof GALLERY_ACCESS)[number];
export const GALLERY_DELIVERY = ['public', 'protected'] as const;
export type GalleryDelivery = (typeof GALLERY_DELIVERY)[number];

/**
 * Mirrors `galleries` (plan p05 → Data), without `password_sealed`: the sealed password leaves this
 * module only through `getGalleryPasswordSealed` (lib/galleries/password.ts, the `gallery.ready`
 * template's `load`). `settings` is the stored JSON object as is: `parseGallerySettings`
 * (lib/galleries/gallerySettings.ts) gives it its defaults, and its caller logs what was invalid.
 */
export type GalleryRow = {
  id: string;
  slug: string;
  title: string;
  shoot_date: string | null;
  client_name: string | null;
  client_email: string | null;
  purpose: GalleryPurpose;
  status: GalleryStatus;
  access: GalleryAccess;
  password_version: number;
  delivery: GalleryDelivery;
  settings: Record<string, unknown>;
  cover_photo_id: string | null;
  photo_count: number;
  content_version: number;
  published_at: string | null;
  first_published_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GalleryDbRow = Omit<GalleryRow, 'settings'> & { settings: string };

export const GALLERY_COLUMNS =
  'id, slug, title, shoot_date, client_name, client_email, purpose, status, access, password_version, delivery, settings, cover_photo_id, photo_count, content_version, published_at, first_published_at, deleted_at, created_at, updated_at';

function readObject(json: string): Record<string, unknown> {
  const value = readJson<unknown>(json, {});
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toGalleryRow(row: GalleryDbRow): GalleryRow {
  return { ...row, settings: readObject(row.settings) };
}

/** A new gallery (the create batch, D5.3/D5.4). `settings` is the JSON object of the snapshot. */
export type GalleryInsert = {
  id: string;
  slug: string;
  title: string;
  shootDate: string | null;
  clientName: string | null;
  clientEmail: string | null;
  purpose: GalleryPurpose;
  access: GalleryAccess;
  /** Required exactly when `access` is `password` (ck_galleries_password). */
  passwordSealed: string | null;
  delivery: GalleryDelivery;
  settings: Record<string, unknown>;
  /** ISO time: created_at and updated_at. */
  now: string;
};

/**
 * A PATCH (D5.10): only the fields present are written; `null` clears a nullable one.
 * `settingsPatch` is merged with `json_patch` (RFC 7396: a `null` member removes the field), so two
 * tabs editing different fields never overwrite each other. Never `processing` (the parser refuses it).
 */
export type GalleryPatch = {
  title?: string;
  shootDate?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  slug?: string;
  settingsPatch?: Record<string, unknown>;
};

/** A keyset position in the galleries list: the last row's `created_at` and `id`. */
export type GalleryCursor = { createdAt: string; id: string };

/** A condition for a guarded write, SQL for a WHERE with its parameters. */
export type Condition = { sql: string; params: readonly SqlValue[] };

/** "The statement right before this one changed something" (D1 runs a batch in order). */
export const CHANGED: Condition = { sql: 'changes() > 0', params: [] };
