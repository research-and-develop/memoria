import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { readWatermark, watermarkImageUrl } from './watermark';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const KEY = 'branding/watermarks/0b6f4a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png';
const TEXT = { kind: 'text', text: 'Northlight', font: 'sans', ink: 'dark', position: 'tiled', size: 15, opacity: 40, margin: 0 };
const save = (value: unknown) => run(statement("INSERT INTO site_settings (key, value) VALUES ('watermark', ?)", [JSON.stringify(value)]), { db: testDb.db });

describe('readWatermark', () => {
  it('no row → none', async () => {
    useTestPlatform({ db: testDb.db });
    expect(await readWatermark()).toEqual({ kind: 'none' });
  });

  it('a valid row wins', async () => {
    useTestPlatform({ db: testDb.db });
    await save(TEXT);
    expect(await readWatermark()).toEqual(TEXT);
  });

  it('an invalid row → none and one log line naming the field', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    useTestPlatform({ db: testDb.db });
    await save({ ...TEXT, opacity: 500 });
    expect(await readWatermark()).toEqual({ kind: 'none' });
    expect(warn).toHaveBeenCalledWith({ event: 'watermark_settings_invalid', field: 'opacity' });
  });
});

describe('watermarkImageUrl (never a presigned URL)', () => {
  const S3 = {
    MEDIA_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    MEDIA_S3_BUCKET: 'memoria-media',
    MEDIA_S3_ORIGINALS_BUCKET: 'memoria-originals',
    MEDIA_S3_ACCESS_KEY_ID: 'id',
    MEDIA_S3_SECRET_ACCESS_KEY: 'secret',
  };

  it('production with a public domain: the public URL', async () => {
    useTestPlatform({ env: { ...S3, MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' } });
    expect(await watermarkImageUrl(KEY, getPlatform().config())).toBe(`https://media.example.com/${KEY}`);
  });

  it('production without one: null, even though presigned GETs could be minted', async () => {
    useTestPlatform({ env: S3 });
    expect(await watermarkImageUrl(KEY, getPlatform().config())).toBeNull();
  });

  it('development: the development read route', async () => {
    useTestPlatform({ env: { NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: 'x'.repeat(32) } });
    expect(await watermarkImageUrl(KEY, getPlatform().config())).toMatch(/^\/api\/blobs\/read\?t=/);
  });

  it('nothing configured: null', async () => {
    useTestPlatform({ env: {} });
    expect(await watermarkImageUrl(KEY, getPlatform().config())).toBeNull();
  });
});
