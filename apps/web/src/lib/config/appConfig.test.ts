import { afterEach, describe, expect, it } from 'vitest';

import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { getAppConfig } from './appConfig';

afterEach(() => resetTestPlatform());

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
  it('hands the client the public values', () => {
    useTestPlatform({ env: { APP_NAME: ' Studio ', TURNSTILE_SITE_KEY: 'site-key' } });
    expect(getAppConfig()).toEqual({ appName: 'Studio', turnstileSiteKey: 'site-key' });
  });

  it('defaults the name and leaves the site key empty', () => {
    expect(getAppConfig()).toEqual({ appName: 'Memoria', turnstileSiteKey: '' });
  });

  it('never carries a secret', () => {
    useTestPlatform({
      env: { ...SECRETS, ADMIN_EMAIL: 'admin@example.com', MEDIA_S3_ENDPOINT: 'https://acct.example.com', MEDIA_S3_BUCKET: 'bucket' },
    });
    const serialised = JSON.stringify(getAppConfig());
    for (const value of Object.values(SECRETS)) expect(serialised).not.toContain(value);
    expect(serialised).not.toContain('admin@example.com');
  });
});
