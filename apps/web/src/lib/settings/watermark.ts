import 'server-only';

import { batch, type Options } from '@repo/db/client';
import { blobUrls, MAX_DEV_READ_EXPIRY, type SignedUpload } from '@repo/platform/blobUrls';
import type { Config } from '@repo/platform/ports';
import { getPlatform } from '@repo/platform/current';

import { auditStatement } from '@/lib/db/queries/audit_log';
import { upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';

import {
  NO_WATERMARK,
  parseWatermarkInput,
  WATERMARK_EXTENSIONS,
  WATERMARK_MAX_BYTES,
  type ImageWatermark,
  type Watermark,
  type WatermarkImageType,
} from './parseWatermarkInput';
import { readSettingRow } from './readSettingRow';

export type { Watermark } from './parseWatermarkInput';

/** The `site_settings` key of the watermark (plan p04 D4.2). */
export const WATERMARK_SETTING_KEY = 'watermark';

/** How long a minted watermark upload stays valid. */
const UPLOAD_EXPIRY_SECONDS = 600;

/**
 * The studio's watermark: the `watermark` row, else none. Never throws. React-free (Phase 5's
 * pipeline route reads it); server components use `getWatermark()`.
 */
export function readWatermark(opts?: Options): Promise<Watermark> {
  return readSettingRow(WATERMARK_SETTING_KEY, parseWatermarkInput, () => NO_WATERMARK, opts);
}

/**
 * Where a browser loads a watermark image from (D4.14): the public media domain when there is one
 * (production), else the development read route in development, else null. Never a presigned GET
 * (AGENTS.md → Media: those are for downloads). Phase 5 calls it for a gallery's snapshot key too.
 */
export async function watermarkImageUrl(key: string, config: Config = getPlatform().config()): Promise<string | null> {
  const urls = blobUrls(config);
  const publicUrl = urls.publicUrl(key);
  if (publicUrl) return publicUrl;
  if (urls.mode === 'dev') return urls.readUrl(key, { expiresInSeconds: MAX_DEV_READ_EXPIRY });
  return null;
}

/** An image watermark needs a URL a browser can load: in production, the public media domain. */
export function canUseImageWatermark(config: Config = getPlatform().config()): boolean {
  return config.isDevelopment || Boolean(config.media.publicBaseUrl);
}

/** A key for a new watermark image (server-generated: never from a filename). */
export function newWatermarkKey(contentType: WatermarkImageType): string {
  return `branding/watermarks/${crypto.randomUUID()}.${WATERMARK_EXTENSIONS[contentType]}`;
}

/** Mint the presigned PUT (or the development route URL) for a new watermark image. */
export async function mintWatermarkUpload(contentType: WatermarkImageType, size: number): Promise<{ key: string; upload: SignedUpload }> {
  const key = newWatermarkKey(contentType);
  const upload = await blobUrls(getPlatform().config()).uploadUrl(key, { contentType, size, expiresInSeconds: UPLOAD_EXPIRY_SECONDS });
  return { key, upload };
}

/**
 * The uploaded object behind an image watermark, checked with `head()` (a presigned PUT cannot
 * enforce the size or prove the upload happened): it must exist, with the declared type, ≤ 2 MB.
 */
export async function checkWatermarkUpload(watermark: ImageWatermark): Promise<'ok' | 'missing' | 'invalid'> {
  const meta = await getPlatform().blobs().head(watermark.key);
  if (!meta) return 'missing';
  if (meta.contentType !== watermark.contentType || meta.size > WATERMARK_MAX_BYTES) return 'invalid';
  return 'ok';
}

/**
 * Save the watermark with its audit row, in one batch (`none` is saved too: it removes the
 * watermark). `fields` names what changed; the values are not logged. Old images are kept (D4.11).
 */
export async function saveWatermark(value: Watermark, fields: readonly string[], opts?: Options): Promise<void> {
  await batch(
    [
      upsertSiteSettingStatement(WATERMARK_SETTING_KEY, value),
      auditStatement({ action: 'update', entity: 'site_settings', entityId: WATERMARK_SETTING_KEY, summary: 'Changed the watermark', details: { fields } }),
    ],
    opts,
  );
}

/** The watermark with the URL its image loads from (null for text, none, or no public domain). */
export async function watermarkView(watermark: Watermark): Promise<{ watermark: Watermark; imageUrl: string | null }> {
  return { watermark, imageUrl: watermark.kind === 'image' ? await watermarkImageUrl(watermark.key) : null };
}
