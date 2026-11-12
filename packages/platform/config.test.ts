import { describe, expect, it } from 'vitest';

import { MIN_SIGNING_SECRET_LENGTH, parseConfig } from './config';

const SECRET = 'x'.repeat(MIN_SIGNING_SECRET_LENGTH);
const S3 = {
  MEDIA_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
  MEDIA_S3_BUCKET: 'memoria-media',
  MEDIA_S3_ACCESS_KEY_ID: 'AKID',
  MEDIA_S3_SECRET_ACCESS_KEY: 'shh',
};

describe('parseConfig', () => {
  it('closes every feature on an empty env', () => {
    expect(parseConfig({})).toEqual({
      appName: 'Memoria',
      siteUrl: null,
      isDevelopment: false,
      admin: { email: '', passwordHash: '' },
      turnstile: { siteKey: '', secretKey: '' },
      hashSalt: '',
      media: { devSigningSecret: null, publicBaseUrl: null, s3: null },
    });
  });

  it('reads and trims every field', () => {
    const config = parseConfig({
      APP_NAME: ' Studio ',
      SITE_URL: 'https://photos.example.com//',
      NEXTJS_ENV: 'development',
      ADMIN_EMAIL: ' Admin@Example.COM ',
      ADMIN_PASSWORD_HASH: ' pbkdf2$1 ',
      TURNSTILE_SITE_KEY: 'site',
      TURNSTILE_SECRET_KEY: 'secret',
      HASH_SALT: 'salt',
      MEDIA_DEV_SIGNING_SECRET: ` ${SECRET} `,
      MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/',
      ...S3,
    });
    expect(config).toEqual({
      appName: 'Studio',
      siteUrl: 'https://photos.example.com',
      isDevelopment: true,
      admin: { email: 'admin@example.com', passwordHash: 'pbkdf2$1' },
      turnstile: { siteKey: 'site', secretKey: 'secret' },
      hashSalt: 'salt',
      media: {
        devSigningSecret: SECRET,
        publicBaseUrl: 'https://media.example.com',
        s3: { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'memoria-media', accessKeyId: 'AKID', secretAccessKey: 'shh' },
      },
    });
  });

  it.each([
    ['production', { NEXTJS_ENV: 'production' }, false],
    ['missing', {}, false],
    ['development', { NEXTJS_ENV: 'development' }, true],
    ['padded', { NEXTJS_ENV: ' development ' }, true],
  ])('isDevelopment: %s', (_label, env, expected) => {
    expect(parseConfig(env).isDevelopment).toBe(expected);
  });

  it.each([
    ['too short', 'x'.repeat(MIN_SIGNING_SECRET_LENGTH - 1), null],
    ['only spaces', '   ', null],
    ['long enough', SECRET, SECRET],
  ])('dev signing secret: %s', (_label, value, expected) => {
    expect(parseConfig({ MEDIA_DEV_SIGNING_SECRET: value }).media.devSigningSecret).toBe(expected);
  });

  it.each(Object.keys(S3))('needs all four S3 settings (without %s → null)', (missing) => {
    const env: Record<string, string> = { ...S3 };
    env[missing] = ' ';
    expect(parseConfig(env).media.s3).toBeNull();
  });

  it.each([
    ['empty', '', null],
    ['blank', '  ', null],
    ['slashes only', '//', null],
  ])('SITE_URL %s → null', (_label, value, expected) => {
    expect(parseConfig({ SITE_URL: value }).siteUrl).toBe(expected);
  });
});
