import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { getAppConfig } from './appConfig';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

/** Every secret the env can hold, each with a value that is easy to spot. */
const SECRETS = {
  ADMIN_PASSWORD_HASH: 'secret-admin-password-hash',
  TURNSTILE_SECRET_KEY: 'secret-turnstile-key',
  HASH_SALT: 'secret-hash-salt',
  TOTP_ENCRYPTION_KEY: 'c2VjcmV0LXRvdHAta2V5LXNlY3JldC10b3RwLWtleSE=',
  MEDIA_DEV_SIGNING_SECRET: 'secret-media-dev-signing-secret-0123456789',
  MEDIA_S3_ACCESS_KEY_ID: 'secret-s3-access-key-id',
  MEDIA_S3_SECRET_ACCESS_KEY: 'secret-s3-secret-access-key',
};

describe('getAppConfig', () => {
  it('hands the client the public values', async () => {
    useTestPlatform({ db: testDb.db, env: { APP_NAME: ' Studio ', TURNSTILE_SITE_KEY: 'site-key' } });
    expect(await getAppConfig()).toEqual({ appName: 'Studio', turnstileSiteKey: 'site-key' });
  });

  it('defaults the name and leaves the site key empty', async () => {
    useTestPlatform({ db: testDb.db });
    expect(await getAppConfig()).toEqual({ appName: 'Memoria', turnstileSiteKey: '' });
  });

  it('takes the studio name from Settings → Studio', async () => {
    useTestPlatform({ db: testDb.db, env: { APP_NAME: 'Env' } });
    await run(statement("INSERT INTO site_settings (key, value) VALUES ('studio', ?)", [JSON.stringify({ name: 'North Light', siteUrl: null })]), {
      db: testDb.db,
    });
    expect((await getAppConfig()).appName).toBe('North Light');
  });

  it('never carries a secret', async () => {
    useTestPlatform({
      db: testDb.db,
      env: { ...SECRETS, ADMIN_EMAIL: 'admin@example.com', MEDIA_S3_ENDPOINT: 'https://acct.example.com', MEDIA_S3_BUCKET: 'bucket' },
    });
    const serialised = JSON.stringify(await getAppConfig());
    for (const value of Object.values(SECRETS)) expect(serialised).not.toContain(value);
    expect(serialised).not.toContain('admin@example.com');
  });
});
