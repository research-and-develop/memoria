import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { batch } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { insertGalleryStatement, softDeleteGalleryStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, uuid } from '@/lib/db/queries/galleries/testFixtures';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { setPublished } from '@/lib/galleries/galleries';
import { sealGalleryPassword } from '@/lib/galleries/password';
import { settingsCipher } from '@/lib/settings/secrets';

import { emailContext } from '../context';
import { galleryReadyTemplate } from './galleryReady';
import { loadAndRenderEmail, renderEmail } from './registry';

/** `gallery.ready` (plan p05, D5.20): ids in the job, the gallery and its password read at send time. */
const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(8);
const TO = { email: 'maria@example.com', name: 'Maria' };
const CTX = emailContext({ name: 'North Light', siteUrl: 'https://photos.example.com' });

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
beforeEach(() => useTestPlatform({ db: testDb.db, env: { SETTINGS_ENCRYPTION_KEY: btoa(String.fromCharCode(...KEY)) } }));
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function gallery(over: { title?: string; password?: { plain: string; key: Uint8Array }; published?: boolean } = {}) {
  const id = uuid('9a11e7');
  const passwordSealed = over.password ? await sealGalleryPassword(await settingsCipher(over.password.key), id, over.password.plain) : null;
  const g = galleryInsert({ id, access: over.password ? 'password' : 'link', passwordSealed, ...(over.title ? { title: over.title } : {}) });
  await batch([insertGalleryStatement(g), insertSetStatement({ id: uuid('5e7'), galleryId: id, name: 'Photos', now: at(0) })], opts());
  if (over.published !== false) await setPublished(id, true, opts());
  return g;
}

const load = (galleryId: string, includePassword = true) => galleryReadyTemplate.load!({ galleryId, includePassword }, { opts: opts(), to: TO });

describe('gallery.ready', () => {
  it.each([
    [{ galleryId: uuid('1'), includePassword: false }, true],
    [{ galleryId: 'not-a-uuid', includePassword: false }, false],
    [{ galleryId: uuid('1') }, false],
    [{ galleryId: uuid('1'), includePassword: false, password: 'x' }, true],
    [null, false],
  ])('parses %j → %s (only ids reach the job)', (params, ok) => {
    const parsed = galleryReadyTemplate.parse(params);
    expect(parsed !== null).toBe(ok);
    if (parsed) expect(Object.keys(parsed).sort()).toEqual(['galleryId', 'includePassword']);
  });

  it('loads the current password at send time and renders it with the link', async () => {
    const g = await gallery({ password: { plain: 'maple-river-42', key: KEY } });
    const email = await loadAndRenderEmail('gallery.ready', { galleryId: g.id, includePassword: true }, CTX, { opts: opts(), to: TO });
    expect(email.subject).toBe('Maria & Jonas — your photos are ready');
    expect(email.text).toContain('Choose your favourites');
    expect(email.text).toContain('maple-river-42');
    expect(email.text).toContain(`https://photos.example.com/g/${g.slug}`);
  });

  it('keeps control and bidi characters out of the subject; the name never in it', async () => {
    const g = await gallery({ title: 'Maria‮ & Jonas\u0007' });
    const value = await load(g.id, false);
    const email = galleryReadyTemplate.render(value, CTX);
    expect(email.subject).toBe('Maria & Jonas — your photos are ready');
    expect(email.subject).not.toContain('Maria,');
  });

  it('fails for good when the gallery is gone or a draft', async () => {
    await expect(load(uuid('404'))).rejects.toMatchObject({ code: 'GALLERY_GONE', permanent: true });
    const draft = await gallery({ published: false });
    await expect(load(draft.id)).rejects.toMatchObject({ code: 'GALLERY_UNPUBLISHED', permanent: true });
    const deleted = await gallery();
    await batch([softDeleteGalleryStatement({ id: deleted.id, now: at(5) })], opts());
    await expect(load(deleted.id)).rejects.toMatchObject({ code: 'GALLERY_GONE', permanent: true });
  });

  it('a password that will not open is a configuration error (retried), like the mail secret', async () => {
    const g = await gallery({ password: { plain: 'maple-river-42', key: OTHER_KEY } });
    await expect(load(g.id)).rejects.toMatchObject({ code: 'MAIL_SECRET_UNREADABLE', configuration: true });
    // Without the password, the same gallery still sends.
    expect((await load(g.id, false)).password).toBeNull();
  });

  it('renderEmail refuses a template with a load step', () => {
    expect(() => renderEmail('gallery.ready', { galleryId: uuid('1'), includePassword: false }, CTX)).toThrow(/load step/);
  });
});
