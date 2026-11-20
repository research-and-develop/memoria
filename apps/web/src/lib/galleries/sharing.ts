import 'server-only';

import { AppError } from '@repo/core/error';
import { batch, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { auditStatement } from '@/lib/db/queries/audit_log';
import { getGalleryPasswordSealed, type GalleryRow } from '@/lib/db/queries/galleries';
import { emailContext } from '@/lib/email/context';
import { emailJobStatement } from '@/lib/email/job';
import { loadAndRenderEmail } from '@/lib/email/templates/registry';
import type { RenderedEmail } from '@/lib/email/types';
import { nudgeRelay } from '@/lib/jobs/enqueue';
import { readStudio } from '@/lib/settings/studio';
import { settingsCipher } from '@/lib/settings/secrets';

import { openGalleryPassword } from './password';

/**
 * The sharing panel's server side (plan p05 → Screens, D5.11, D5.20): the password shown to the
 * photographer, the "gallery ready" email and its preview. Never logs or audits a password or an
 * address.
 */

/** Why the client email cannot go out yet (409), checked before a send and a preview alike. */
export async function assertEmailable(gallery: GalleryRow, opts?: Options): Promise<void> {
  if (gallery.status !== 'published') {
    throw new AppError('Gallery not published', 'NOT_PUBLISHED', { status: 409, message: 'Publish the gallery first.' });
  }
  if (!(await readStudio(opts)).siteUrl) {
    throw new AppError('No website address', 'SITE_URL_REQUIRED', {
      status: 409,
      message: 'Set your website address in Settings → Studio first: the email links to it.',
    });
  }
}

/** The gallery's password, opened for the photographer (D5.11); null for a link gallery. */
export async function revealGalleryPassword(gallery: GalleryRow, opts?: Options): Promise<string | null> {
  if (gallery.access !== 'password') return null;
  const key = getPlatform().config().settingsKey;
  if (!key) {
    throw new AppError('Settings key missing', 'SETTINGS_KEY_MISSING', { status: 503, message: 'The server has no SETTINGS_ENCRYPTION_KEY: the installer must set it.' });
  }
  const sealed = await getGalleryPasswordSealed(gallery.id, opts);
  const plain = sealed ? await openGalleryPassword(await settingsCipher(key), gallery.id, sealed) : null;
  if (plain === null) {
    logger.error({ event: 'gallery_password_unreadable', galleryId: gallery.id });
    throw new AppError('Gallery password unreadable', 'PASSWORD_UNREADABLE', {
      status: 503,
      message: 'The saved password cannot be read (the server key changed): set a new one.',
    });
  }
  return plain;
}

/** The `gallery.ready` email as the relay would render it now, without sending. */
export async function previewGalleryEmail(
  input: { gallery: GalleryRow; name: string | null; includePassword: boolean },
  opts?: Options,
): Promise<RenderedEmail> {
  await assertEmailable(input.gallery, opts);
  const studio = await readStudio(opts);
  return loadAndRenderEmail(
    'gallery.ready',
    { galleryId: input.gallery.id, includePassword: input.includePassword },
    emailContext(studio),
    { ...(opts ? { opts } : {}), to: { email: input.gallery.client_email ?? 'client@example.com', ...(input.name ? { name: input.name } : {}) } },
  );
}

/** Queue the `gallery.ready` email and its audit row in one batch, then wake the relay. */
export async function queueGalleryEmail(
  input: { gallery: GalleryRow; to: string; name: string | null; includePassword: boolean; now: Date },
  opts?: Options,
): Promise<string> {
  const { gallery, now } = input;
  await assertEmailable(gallery, opts);
  const includePassword = input.includePassword && gallery.access === 'password';
  const job = emailJobStatement({
    template: 'gallery.ready',
    to: { email: input.to, ...(input.name ? { name: input.name } : {}) },
    params: { galleryId: gallery.id, includePassword },
    now,
  });
  await batch(
    [
      job.statement,
      auditStatement({
        action: 'update',
        entity: 'gallery',
        entityId: gallery.id,
        summary: 'Emailed the gallery to the client',
        details: { event: 'email', jobId: job.id, includePassword },
      }),
    ],
    opts,
  );
  nudgeRelay();
  logger.info({ event: 'gallery_email_queued', galleryId: gallery.id, jobId: job.id });
  return job.id;
}
