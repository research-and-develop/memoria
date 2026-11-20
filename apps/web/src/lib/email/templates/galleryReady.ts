import { isUuid } from '@repo/core/validation';
import { getPlatform } from '@repo/platform/current';
import { MailError } from '@repo/platform/mail/error';

import { getGallery, getGalleryPasswordSealed } from '@/lib/db/queries/galleries';
import { openGalleryPassword } from '@/lib/galleries/password';
import { JobError } from '@/lib/jobs/types';
import { settingsCipher } from '@/lib/settings/secrets';

import { renderLayout } from '../layout';
import type { EmailTemplate } from '../types';

/**
 * The client's "your photos are ready" email (plan p05, D5.20). The stored parameters are only
 * `{ galleryId, includePassword }`: `load` reads the gallery at send time and, when asked, opens its
 * password then (a changed password sends the current one; a failed job's parameters hold no
 * secret). React- and Next-free: the relay runs it (guard `relay-graph`).
 */
export type GalleryReadyParams = { galleryId: string; includePassword: boolean };

export type GalleryReadyValue = {
  galleryTitle: string;
  purpose: 'selection' | 'sharing';
  clientName: string | null;
  /** `/g/<slug>`, linked through `ctx.link`. */
  path: string;
  password: string | null;
};

/** No control, format or bidi character in a subject or a heading. */
const plain = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();

export const galleryReadyTemplate: EmailTemplate<GalleryReadyParams, GalleryReadyValue> = {
  id: 'gallery.ready',
  label: 'Gallery ready',
  parse(params) {
    if (typeof params !== 'object' || params === null) return null;
    const p = params as Record<string, unknown>;
    return isUuid(p.galleryId) && typeof p.includePassword === 'boolean' ? { galleryId: p.galleryId, includePassword: p.includePassword } : null;
  },
  async load({ galleryId, includePassword }, { opts, to }) {
    const gallery = await getGallery(galleryId, opts);
    if (!gallery || gallery.deleted_at) throw new JobError('GALLERY_GONE', { permanent: true });
    if (gallery.status !== 'published') throw new JobError('GALLERY_UNPUBLISHED', { permanent: true });
    let password: string | null = null;
    if (includePassword && gallery.access === 'password') {
      const key = getPlatform().config().settingsKey;
      if (!key) throw new MailError('SETTINGS_KEY_MISSING', { configuration: true });
      const sealed = await getGalleryPasswordSealed(galleryId, opts);
      password = sealed ? await openGalleryPassword(await settingsCipher(key), galleryId, sealed) : null;
      if (password === null) throw new MailError('MAIL_SECRET_UNREADABLE', { configuration: true, detail: 'gallery.password' });
    }
    return {
      galleryTitle: gallery.title,
      purpose: gallery.purpose,
      clientName: to.name?.trim() ? to.name.trim() : null,
      path: `/g/${gallery.slug}`,
      password,
    };
  },
  render({ galleryTitle, purpose, clientName, path, password }, ctx) {
    const title = plain(galleryTitle) || 'Your gallery';
    const paragraphs = [
      clientName ? `Hello ${plain(clientName)},` : 'Hello,',
      purpose === 'selection'
        ? `Your photos from "${title}" are ready. Choose your favourites and submit your selection.`
        : `Your photos from "${title}" are ready to view and download.`,
      ...(password ? [`The gallery is protected by a password: ${password}`] : []),
      `${ctx.studioName}`,
    ];
    return {
      // The client's name never goes into the subject (D3.15's rule, kept for typed names too).
      subject: `${title} — your photos are ready`,
      ...renderLayout(ctx, { heading: title, paragraphs, action: { label: 'Open the gallery', href: ctx.link(path) } }),
    };
  },
};
