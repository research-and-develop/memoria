import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, batch, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { insertGalleryStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, uuid } from '@/lib/db/queries/galleries/testFixtures';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { setPublished } from '@/lib/galleries/galleries';
import { sealGalleryPassword } from '@/lib/galleries/password';
import { settingsCipher } from '@/lib/settings/secrets';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { POST } = await import('./route');
const { GET: PREVIEW } = await import('../email-preview/route');
const { GET: PASSWORD } = await import('../password/route');

/** The sharing panel's server side (plan p05, D5.11, D5.20): the client email, its preview, the password. */
const SECRET = new Uint8Array(32).fill(5);
const PASSWORD_PLAIN = 'maple-river-42';

let testDb: TestDb;
let passwordHash: string;
let cookie: string;
const db = () => ({ db: testDb.db });

function platform(siteUrl: string | null) {
  useTestPlatform({
    db: testDb.db,
    env: {
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD_HASH: passwordHash,
      HASH_SALT: 'salt',
      TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64,
      SETTINGS_ENCRYPTION_KEY: btoa(String.fromCharCode(...SECRET)),
      ...(siteUrl ? { SITE_URL: siteUrl } : {}),
    },
  });
}

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(async () => {
  platform('https://photos.example.com');
  cookie = await adminCookie(passwordHash, testDb.db);
});
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function gallery(opts: { access?: 'link' | 'password'; published?: boolean } = {}) {
  const id = uuid('9a11e7');
  const passwordSealed = opts.access === 'password' ? await sealGalleryPassword(await settingsCipher(SECRET), id, PASSWORD_PLAIN) : null;
  const g = galleryInsert({ id, access: opts.access ?? 'link', passwordSealed });
  await batch([insertGalleryStatement(g), insertSetStatement({ id: uuid('5e7'), galleryId: id, name: 'Photos', now: at(0) })], db());
  if (opts.published !== false) await setPublished(id, true, db());
  return g;
}

const send = (id: string, body: unknown, c = cookie) => POST(jsonRequest(`/api/admin/galleries/${id}/email`, body, { cookie: c }), params({ id }));
const get = (handler: typeof PREVIEW, path: string, id: string) => handler(jsonRequest(path, undefined, { cookie }), params({ id }));
const body = async (res: Response) => (await res.json()) as { data?: Record<string, unknown>; errorCode?: string; details?: { message?: string; field?: string } };
const emailJobs = () => all<{ payload: string }>(statement(`SELECT payload FROM jobs WHERE kind = 'email'`), db());

describe('POST /api/admin/galleries/[id]/email', () => {
  it('queues gallery.ready with ids only (no password, no secret) and audits it without the address', async () => {
    const g = await gallery({ access: 'password' });
    const res = await send(g.id, { to: 'maria@example.com', name: 'Maria', includePassword: true });
    expect(res.status).toBe(202);
    expect((await body(res)).data).toMatchObject({ template: 'gallery.ready', to: 'maria@example.com', status: 'queued' });
    const [job] = await emailJobs();
    expect(JSON.parse(job!.payload)).toEqual({
      template: 'gallery.ready',
      to: { email: 'maria@example.com', name: 'Maria' },
      params: { galleryId: g.id, includePassword: true },
      v: 1,
    });
    expect(job!.payload).not.toContain(PASSWORD_PLAIN);
    const audit = await all<{ details: string }>(statement(`SELECT details FROM audit_log WHERE entity = 'gallery' AND entity_id = ?`, [g.id]), db());
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).not.toContain('maria@');
  });

  it('never asks for the password of a link gallery', async () => {
    const g = await gallery();
    expect((await send(g.id, { to: 'maria@example.com', includePassword: true })).status).toBe(202);
    expect(JSON.parse((await emailJobs())[0]!.payload).params).toEqual({ galleryId: g.id, includePassword: false });
  });

  it.each([
    [{ to: 'nope' }, 'to'],
    [{ to: 'maria@example.com', name: 'Maria\r\nBcc: x@example.com' }, 'name'],
    [{ to: 'maria@example.com', name: 'x'.repeat(101) }, 'name'],
    [{ to: 'maria@example.com', includePassword: 'yes' }, 'includePassword'],
  ])('refuses %j (400 on %s)', async (input, field) => {
    const g = await gallery();
    const res = await send(g.id, input);
    expect(res.status).toBe(400);
    expect((await body(res)).details?.field).toBe(field);
    expect(await emailJobs()).toEqual([]);
  });

  it('409 NOT_PUBLISHED for a draft; 409 SITE_URL_REQUIRED without a website address; 404 for no gallery', async () => {
    const draft = await gallery({ published: false });
    const res = await send(draft.id, { to: 'maria@example.com' });
    expect(res.status).toBe(409);
    expect((await body(res)).errorCode).toBe('NOT_PUBLISHED');

    resetTestPlatform();
    platform(null);
    const live = await gallery();
    const noSite = await send(live.id, { to: 'maria@example.com' });
    expect(noSite.status).toBe(409);
    expect((await body(noSite)).errorCode).toBe('SITE_URL_REQUIRED');
    expect(await emailJobs()).toEqual([]);

    expect((await send(uuid('404'), { to: 'maria@example.com' })).status).toBe(404);
  });

  it('needs an admin', async () => {
    const g = await gallery();
    expect((await send(g.id, { to: 'maria@example.com' }, '')).status).toBe(401);
  });
});

describe('GET /api/admin/galleries/[id]/email-preview', () => {
  it('renders what the relay would send: the name, the link, the password only when asked', async () => {
    const g = await gallery({ access: 'password' });
    const withPassword = await body(await get(PREVIEW, `/api/admin/galleries/${g.id}/email-preview?include_password=1&name=Maria`, g.id));
    expect(withPassword.data).toMatchObject({ subject: 'Maria & Jonas — your photos are ready' });
    expect(withPassword.data!.text).toContain('Hello Maria,');
    expect(withPassword.data!.text).toContain(PASSWORD_PLAIN);
    expect(withPassword.data!.text).toContain(`https://photos.example.com/g/${g.slug}`);
    expect(withPassword.data!.html).toContain('Maria &amp; Jonas');
    const without = await body(await get(PREVIEW, `/api/admin/galleries/${g.id}/email-preview`, g.id));
    expect(without.data!.text).not.toContain(PASSWORD_PLAIN);
    expect(without.data!.text).toContain('Hello,');
  });

  it('answers the same 409 as the send for a draft', async () => {
    const g = await gallery({ published: false });
    const res = await get(PREVIEW, `/api/admin/galleries/${g.id}/email-preview`, g.id);
    expect(res.status).toBe(409);
    expect((await body(res)).errorCode).toBe('NOT_PUBLISHED');
  });
});

describe('GET /api/admin/galleries/[id]/password', () => {
  it('shows a password gallery its password, a link gallery null; never cached', async () => {
    const locked = await gallery({ access: 'password' });
    const res = await get(PASSWORD, `/api/admin/galleries/${locked.id}/password`, locked.id);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await body(res)).data).toEqual({ password: PASSWORD_PLAIN });
    const open = await gallery();
    expect((await body(await get(PASSWORD, `/api/admin/galleries/${open.id}/password`, open.id))).data).toEqual({ password: null });
  });
});
