import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { verifyBlobToken } from '@repo/platform/blobToken';
import { getPlatform } from '@repo/platform/current';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getGallery } from '@/lib/db/queries/galleries';
import { listSets } from '@/lib/db/queries/photo_sets';
import { getPhotos } from '@/lib/db/queries/photos';
import { createGallery } from '@/lib/galleries/galleries';
import { parseGalleryInput } from '@/lib/galleries/parseGalleryInput';
import { PLACEHOLDER } from '@/lib/db/queries/galleries/testFixtures';
import { photoKeys } from '@/lib/galleries/keys';
import { BRANDING_DEFAULTS } from '@/lib/settings/parseBrandingInput';
import { GALLERY_DEFAULTS } from '@/lib/settings/parseGalleryDefaultsInput';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const register = await import('./route');
const complete = await import('./complete/route');

let testDb: TestDb;
let passwordHash: string;
let cookie: string;
const db = () => ({ db: testDb.db });
const SECRET = 'test-media-dev-signing-secret-0123456789';

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(async () => {
  useTestPlatform({
    db: testDb.db,
    env: { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64, NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: SECRET },
  });
  cookie = await adminCookie(passwordHash, testDb.db);
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function newGallery() {
  const parsed = parseGalleryInput({ title: 'Shoot', watermark: false }, { defaults: GALLERY_DEFAULTS, branding: BRANDING_DEFAULTS });
  if (!parsed.ok) throw new Error(parsed.message);
  const { id } = await createGallery(parsed.value, db());
  const [set] = await listSets(id, db());
  return { id, setId: set!.id };
}

let n = 0;
const photo = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    filename: `IMG_${n}.jpg`,
    contentType: 'image/jpeg',
    sha256: n.toString(16).padStart(64, '0'),
    bytes: { original: 1000, thumb: 100, display: 400 },
    width: 6000,
    height: 4000,
    displayWidth: 1600,
    displayHeight: 1067,
    derivativeExt: 'webp',
    takenAt: '2026-10-03T10:00:00',
    color: PLACEHOLDER,
    meta: { camera: 'X-T5' },
    ...over,
  };
};

type Registered = { sha256: string; status: string; photoId?: string; uploads?: Record<'original' | 'thumb' | 'display', { url: string; headers: Record<string, string> }> };
const post = async (galleryId: string, body: unknown) => register.POST(jsonRequest(`/api/admin/galleries/${galleryId}/uploads`, body, { cookie }), params({ id: galleryId }));
const registered = async (galleryId: string, body: unknown) => ((await (await post(galleryId, body)).json()) as { data: Registered[] }).data;
const finish = async (galleryId: string, photoIds: string[]) =>
  ((await (await complete.POST(jsonRequest(`/api/admin/galleries/${galleryId}/uploads/complete`, { photoIds }, { cookie }), params({ id: galleryId }))).json()) as {
    data: { ready: string[]; failed: { id: string; reason: string }[] };
  }).data;

/** What the browser's PUTs would store, with the declared sizes unless told otherwise. */
async function store(galleryId: string, photoId: string, sizes = { original: 1000, thumb: 100, display: 400 }, type = 'image/webp') {
  const [row] = await getPhotos({ galleryId, ids: [photoId] }, db());
  const keys = photoKeys(row!);
  await getPlatform().blobs('originals').put(keys.original, new Uint8Array(sizes.original), { contentType: 'image/jpeg' });
  await getPlatform().blobs('media').put(keys.thumb, new Uint8Array(sizes.thumb), { contentType: type });
  await getPlatform().blobs('media').put(keys.display, new Uint8Array(sizes.display), { contentType: type });
  return keys;
}

const tokenOf = (url: string) => verifyBlobToken(new URL(url, 'http://x').searchParams.get('t'), SECRET, Math.floor(Date.now() / 1000));

describe('POST …/uploads (register)', () => {
  it('registers new photos with three PUTs: the original to the private bucket, the rest to media', async () => {
    const { id, setId } = await newGallery();
    const [first] = await registered(id, { setId, photos: [photo()] });
    expect(first).toMatchObject({ status: 'new' });
    const original = await tokenOf(first!.uploads!.original.url);
    const thumb = await tokenOf(first!.uploads!.thumb.url);
    expect(original).toMatchObject({ op: 'put', b: 'o', key: `galleries/${id}/${first!.photoId}/original.jpg`, size: 1000, ct: 'image/jpeg' });
    expect(thumb).toMatchObject({ b: 'm', ct: 'image/webp', size: 100 });
    expect(thumb!.key).toMatch(new RegExp(`^galleries/${id}/${first!.photoId}/[a-z2-9]{8}/thumb\\.webp$`));
    const [row] = await getPhotos({ galleryId: id, ids: [first!.photoId!] }, db());
    expect(row).toMatchObject({ status: 'uploading', bytes: 1500, original_bytes: 1000, processing: { display: { longEdge: 1600 } } });
  });

  it('a finished hash is a duplicate; an unfinished one resumes with the same id and rev', async () => {
    const { id, setId } = await newGallery();
    const a = photo();
    const b = photo();
    const [ra, rb] = await registered(id, { setId, photos: [a, b] });
    await store(id, ra!.photoId!);
    await finish(id, [ra!.photoId!]);
    const again = await registered(id, { setId, photos: [a, b] });
    expect(again.map((r) => r.status)).toEqual(['duplicate', 'resume']);
    expect(again[1]!.photoId).toBe(rb!.photoId);
    expect((await tokenOf(again[1]!.uploads!.thumb.url))!.key).toBe((await tokenOf(rb!.uploads!.thumb.url))!.key);
  });

  it('a resume in another derivative format deletes the old-format derivatives', async () => {
    const { id, setId } = await newGallery();
    const a = photo();
    const [ra] = await registered(id, { setId, photos: [a] });
    const keys = await store(id, ra!.photoId!);
    const [rb] = await registered(id, { setId, photos: [{ ...a, derivativeExt: 'jpg' }] });
    expect(rb!.status).toBe('resume');
    expect(await getPlatform().blobs('media').head(keys.thumb)).toBeNull();
    expect(await getPlatform().blobs('originals').head(keys.original)).not.toBeNull();
  });

  it.each([
    ['more than 10 photos', () => ({ photos: Array.from({ length: 11 }, () => photo()) })],
    ['a GIF', () => ({ photos: [photo({ contentType: 'image/gif' })] })],
    ['an original over 100 MB', () => ({ photos: [photo({ bytes: { original: 100 * 1024 * 1024 + 1, thumb: 1, display: 1 } })] })],
    ['a derivative over 10 MB', () => ({ photos: [photo({ bytes: { original: 1, thumb: 1, display: 10 * 1024 * 1024 + 1 } })] })],
    ['the same file twice', () => {
      const p = photo();
      return { photos: [p, p] };
    }],
  ])('refuses %s (400)', async (_label, body) => {
    const { id, setId } = await newGallery();
    expect((await post(id, { setId, ...body() })).status).toBe(400);
  });

  it('a set of another gallery: 400 INVALID_SET; a deleted gallery: 404', async () => {
    const a = await newGallery();
    const b = await newGallery();
    const res = await post(a.id, { setId: b.setId, photos: [photo()] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe('INVALID_SET');
    await run(statement('UPDATE galleries SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), a.id]), db());
    expect((await post(a.id, { setId: a.setId, photos: [photo()] })).status).toBe(404);
  });
});

describe('POST …/uploads/complete', () => {
  it('marks stored photos ready: set and gallery counts, a cover, one content bump; a repeat changes nothing', async () => {
    const { id, setId } = await newGallery();
    const regs = await registered(id, { setId, photos: [photo(), photo({ width: 3000, height: 4000 })] });
    for (const r of regs) await store(id, r.photoId!);
    const ids = regs.map((r) => r.photoId!);
    expect(await finish(id, ids)).toEqual({ ready: ids, failed: [] });
    const gallery = (await getGallery(id, db()))!;
    expect(gallery).toMatchObject({ photo_count: 2, content_version: 2, cover_photo_id: ids[0] });
    expect((await listSets(id, db()))[0]!.photo_count).toBe(2);
    expect(await finish(id, ids)).toEqual({ ready: ids, failed: [] });
    expect(await getGallery(id, db())).toMatchObject({ photo_count: 2, content_version: 2 });
  });

  it('a missing object fails UPLOAD_MISSING; a wrong size or type fails UPLOAD_MISMATCH and its objects are removed', async () => {
    const { id, setId } = await newGallery();
    const [missing, wrongSize, wrongType] = await registered(id, { setId, photos: [photo(), photo(), photo()] });
    await store(id, wrongSize!.photoId!, { original: 999, thumb: 100, display: 400 });
    const keys = await store(id, wrongType!.photoId!, { original: 1000, thumb: 100, display: 400 }, 'image/png');
    const result = await finish(id, [missing!.photoId!, wrongSize!.photoId!, wrongType!.photoId!]);
    expect(result.ready).toEqual([]);
    expect(result.failed).toEqual([
      { id: missing!.photoId, reason: 'UPLOAD_MISSING' },
      { id: wrongSize!.photoId, reason: 'UPLOAD_MISMATCH' },
      { id: wrongType!.photoId, reason: 'UPLOAD_MISMATCH' },
    ]);
    expect(await getPlatform().blobs('media').head(keys.thumb)).toBeNull();
    expect(await getGallery(id, db())).toMatchObject({ photo_count: 0, content_version: 1 });
  });

  it('refuses more than 8 ids or a non-UUID (400); an unknown id fails NOT_FOUND', async () => {
    const { id } = await newGallery();
    const nine = Array.from({ length: 9 }, () => crypto.randomUUID());
    expect((await complete.POST(jsonRequest(`/api/admin/galleries/${id}/uploads/complete`, { photoIds: nine }, { cookie }), params({ id }))).status).toBe(400);
    const unknown = crypto.randomUUID();
    expect(await finish(id, [unknown])).toEqual({ ready: [], failed: [{ id: unknown, reason: 'NOT_FOUND' }] });
  });
});
