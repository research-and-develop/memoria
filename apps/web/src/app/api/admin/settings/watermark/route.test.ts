import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { getPlatform } from '@repo/platform/current';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getSiteSetting } from '@/lib/db/queries/site_settings';
import { readWatermark } from '@/lib/settings/watermark';
import { adminCookie, atFixedTime, jsonRequest } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { GET, PATCH } = await import('./route');
const { POST: UPLOAD } = await import('./upload/route');

let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });
const DEV = { NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: 'd'.repeat(32) };
const S3 = { MEDIA_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', MEDIA_S3_BUCKET: 'memoria-media', MEDIA_S3_ORIGINALS_BUCKET: 'memoria-originals', MEDIA_S3_ACCESS_KEY_ID: 'id', MEDIA_S3_SECRET_ACCESS_KEY: 'secret' };
const ENV = (extra: Record<string, string> = {}) => ({
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: passwordHash,
  HASH_SALT: 'salt',
  TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64,
  ...extra,
});

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(() => {
  useTestPlatform({ db: testDb.db, env: ENV(DEV) });
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const PLACEMENT = { position: 'bottom-right', size: 20, opacity: 60, margin: 3 };
const TEXT = { kind: 'text', text: 'Northlight', font: 'serif', ink: 'light', ...PLACEMENT };
const read = (cookie: string, headers?: Record<string, string>) => GET(jsonRequest('/api/admin/settings/watermark', undefined, { cookie, headers }));
const save = (cookie: string, body: unknown, headers?: Record<string, string>) =>
  PATCH(jsonRequest('/api/admin/settings/watermark', body, { method: 'PATCH', cookie, headers }));
const mint = (cookie: string, body: unknown) => UPLOAD(jsonRequest('/api/admin/settings/watermark/upload', body, { cookie }));
const audits = () => all<{ details: string }>(statement("SELECT details FROM audit_log WHERE entity_id = 'watermark'"), db());
const storeImage = (key: string, contentType: string, size = 1000) => getPlatform().blobs().put(key, new Uint8Array(size), { contentType });

describe('GET/PATCH /api/admin/settings/watermark', () => {
  it('needs a session (401) and the same origin (403), before anything is read or written', async () => {
    expect((await read('')).status).toBe(401);
    expect((await save('', TEXT)).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await save(cookie, TEXT, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await getSiteSetting('watermark', db())).toBeNull();
  });

  it('GET: none by default, no-store', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await read(cookie);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ data: { watermark: { kind: 'none' }, imageUrl: null } });
  });

  it('a text watermark: saved without a code, re-read equals the input, audited with field names only', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await save(cookie, { ...TEXT, text: ' Northlight‮ ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { watermark: TEXT, imageUrl: null } });
    expect(await readWatermark()).toEqual(TEXT);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.details).fields).toEqual(['font', 'ink', 'kind', 'margin', 'opacity', 'position', 'size', 'text']);
    expect(JSON.stringify(rows)).not.toMatch(/Northlight/);
  });

  it('saving the same watermark again writes nothing', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    await save(cookie, TEXT);
    await save(cookie, TEXT);
    expect(await audits()).toHaveLength(1);
  });

  it('none removes it', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    await save(cookie, TEXT);
    expect(await (await save(cookie, { kind: 'none' })).json()).toEqual({ data: { watermark: { kind: 'none' }, imageUrl: null } });
    expect(await readWatermark()).toEqual({ kind: 'none' });
  });

  it.each([
    [{ ...TEXT, opacity: 5 }, 'opacity'],
    [{ ...TEXT, position: 'middle' }, 'position'],
    [{ ...TEXT, text: '' }, 'text'],
    [{ kind: 'image', key: 'branding/logos/x.png', width: 10, height: 10, contentType: 'image/png', ...PLACEMENT }, 'key'],
  ])('400 on an invalid field: %j', async (body, field) => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await save(cookie, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field } });
    expect(await getSiteSetting('watermark', db())).toBeNull();
  });

  describe('an image watermark', () => {
    const KEY = 'branding/watermarks/0b6f4a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png';
    const IMAGE = { kind: 'image', key: KEY, width: 800, height: 200, contentType: 'image/png', ...PLACEMENT };

    it('missing object → 400 UPLOAD_MISSING', async () => {
      const cookie = await adminCookie(passwordHash, testDb.db);
      const res = await save(cookie, IMAGE);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ errorCode: 'UPLOAD_MISSING', details: { field: 'key' } });
    });

    it.each([
      ['another type', 'image/jpeg', 1000],
      ['over 2 MB', 'image/png', 2 * 1024 * 1024 + 1],
    ])('%s at head() → 400 UPLOAD_INVALID', async (_, contentType, size) => {
      const cookie = await adminCookie(passwordHash, testDb.db);
      await storeImage(KEY, contentType, size);
      expect(await (await save(cookie, IMAGE)).json()).toMatchObject({ errorCode: 'UPLOAD_INVALID' });
      expect(await getSiteSetting('watermark', db())).toBeNull();
    });

    it('uploaded → saved; development answers the dev read route as imageUrl', async () => {
      const cookie = await adminCookie(passwordHash, testDb.db);
      await storeImage(KEY, 'image/png');
      const body = (await (await save(cookie, IMAGE)).json()) as { data: { watermark: unknown; imageUrl: string } };
      expect(body.data.watermark).toEqual(IMAGE);
      expect(body.data.imageUrl).toMatch(/^\/api\/blobs\/read\?t=/);
      expect(await readWatermark()).toEqual(IMAGE);
    });

    it('production: the public media URL; without a public domain → 409 MEDIA_DOMAIN_REQUIRED', async () => {
      useTestPlatform({ db: testDb.db, env: ENV({ ...S3, MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' }) });
      const cookie = await adminCookie(passwordHash, testDb.db);
      await storeImage(KEY, 'image/png');
      expect(await (await save(cookie, IMAGE)).json()).toEqual({ data: { watermark: IMAGE, imageUrl: `https://media.example.com/${KEY}` } });
      expect(await (await read(cookie)).json()).toEqual({ data: { watermark: IMAGE, imageUrl: `https://media.example.com/${KEY}` } });

      useTestPlatform({ db: testDb.db, env: ENV(S3) });
      const res = await save(cookie, IMAGE);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ errorCode: 'MEDIA_DOMAIN_REQUIRED' });
      // A saved image watermark still reads back, without a URL (never a presigned GET).
      expect(await (await read(cookie)).json()).toEqual({ data: { watermark: IMAGE, imageUrl: null } });
    });
  });
});

describe('POST /api/admin/settings/watermark/upload', () => {
  it('needs a session', async () => {
    expect((await mint('', { contentType: 'image/png', size: 1000 })).status).toBe(401);
  });

  it.each([
    [{ contentType: 'image/jpeg', size: 1000 }, 'contentType'],
    [{ contentType: 'image/svg+xml', size: 1000 }, 'contentType'],
    [{ contentType: 'image/png', size: 2 * 1024 * 1024 + 1 }, 'size'],
    [{ contentType: 'image/png', size: 0 }, 'size'],
    [{ contentType: 'image/png', size: 10.5 }, 'size'],
  ])('refuses %j (400 on %s)', async (body, field) => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await mint(cookie, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { field } });
  });

  it('mints a key under branding/watermarks/ and a dev upload URL', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await mint(cookie, { contentType: 'image/webp', size: 5000 });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { key: string; upload: { url: string; method: string; headers: Record<string, string> } } };
    expect(data.key).toMatch(/^branding\/watermarks\/[0-9a-f-]{36}\.webp$/);
    expect(data.upload).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/webp' } });
    expect(data.upload.url).toMatch(/^\/api\/blobs\/upload\?t=/);
  });

  it('production: a presigned PUT with a public domain; 409 MEDIA_DOMAIN_REQUIRED without one', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ ...S3, MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' }) });
    const cookie = await adminCookie(passwordHash, testDb.db);
    const { data } = (await (await mint(cookie, { contentType: 'image/png', size: 5000 })).json()) as { data: { upload: { url: string } } };
    expect(data.upload.url).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/memoria-media\/branding\/watermarks\/.*X-Amz-Signature=/);

    useTestPlatform({ db: testDb.db, env: ENV(S3) });
    const res = await mint(cookie, { contentType: 'image/png', size: 5000 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ errorCode: 'MEDIA_DOMAIN_REQUIRED' });
  });

  it('media not configured → 503 MEDIA_NOT_CONFIGURED', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ NEXTJS_ENV: 'development' }) });
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await mint(cookie, { contentType: 'image/png', size: 5000 });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ errorCode: 'MEDIA_NOT_CONFIGURED' });
  });

  it('20 an hour: the 21st is 429', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const statuses = await atFixedTime(async () => {
      const out: number[] = [];
      for (let i = 0; i < 21; i++) out.push((await mint(cookie, { contentType: 'image/png', size: 100 })).status);
      return out;
    });
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
