import { readJson } from '@repo/db/rows';
import { statement } from '@repo/db/statement';
import type { Statement } from '@repo/platform/ports';

import type { DerivativeExt } from '../photos/types';
import type { GalleryAccess, GalleryDelivery, GalleryPurpose, GalleryStatus } from './types';

/**
 * The public read of this table (plan p06 D6.6, D6.8): the gallery a client opens by its slug, read by
 * `worker.ts` on every view. EDGE-SAFE: only `@repo/db/statement`, `@repo/db/rows` and type imports;
 * the edge code imports it BY PATH (`…/galleries/public`), never through the `index.ts` barrel.
 * Guard: `edge-graph`.
 *
 * It never selects `password_sealed`, `client_name` or `client_email` (D6.7): what a client must not
 * see cannot leak from a row that never held it. The cover's sizes come through a join on the photo's
 * primary key (ready and visible only), so a view reads ONE gallery row. A deleted gallery is not
 * found; a draft is (a preview link opens it, D6.11): the caller decides.
 */
export type PublicCover = { id: string; w: number; h: number; color: string; rev: string; ext: DerivativeExt };

export type PublicGalleryRow = {
  id: string;
  slug: string;
  title: string;
  shoot_date: string | null;
  purpose: GalleryPurpose;
  status: GalleryStatus;
  access: GalleryAccess;
  password_version: number;
  delivery: GalleryDelivery;
  /** The stored JSON object as is: `parseGallerySettings` (lib/galleries) gives it its defaults. */
  settings: Record<string, unknown>;
  content_version: number;
  cover: PublicCover | null;
};

export type PublicGalleryDbRow = Omit<PublicGalleryRow, 'settings' | 'cover'> & {
  settings: string;
  cover_id: string | null;
  cover_w: number | null;
  cover_h: number | null;
  cover_color: string | null;
  cover_rev: string | null;
  cover_ext: DerivativeExt | null;
};

export function galleryBySlugStatement(slug: string): Statement {
  return statement(
    `SELECT g.id, g.slug, g.title, g.shoot_date, g.purpose, g.status, g.access, g.password_version, g.delivery,
       g.settings, g.content_version,
       c.id AS cover_id, c.display_width AS cover_w, c.display_height AS cover_h, c.color AS cover_color,
       c.rev AS cover_rev, c.derivative_ext AS cover_ext
     FROM galleries g
     LEFT JOIN photos c ON c.id = g.cover_photo_id AND c.gallery_id = g.id AND c.status = 'ready' AND c.hidden = 0
     WHERE g.slug = ? AND g.deleted_at IS NULL`,
    [slug],
  );
}

function readObject(json: string): Record<string, unknown> {
  const value = readJson<unknown>(json, {});
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toPublicGalleryRow(row: PublicGalleryDbRow): PublicGalleryRow {
  const { cover_id, cover_w, cover_h, cover_color, cover_rev, cover_ext, settings, ...rest } = row;
  const cover =
    cover_id !== null && cover_w !== null && cover_h !== null && cover_color !== null && cover_rev !== null && cover_ext !== null
      ? { id: cover_id, w: cover_w, h: cover_h, color: cover_color, rev: cover_rev, ext: cover_ext }
      : null;
  return { ...rest, settings: readObject(settings), cover };
}
