import { describe, expect, it } from 'vitest';

import { MIN_SIGNING_SECRET_LENGTH, parseConfig } from './config';

const SECRET = 'x'.repeat(MIN_SIGNING_SECRET_LENGTH);
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const KEY_B64 = btoa(String.fromCharCode(...KEY));
const S3 = {
  MEDIA_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
  MEDIA_S3_BUCKET: 'memoria-media',
  MEDIA_S3_ORIGINALS_BUCKET: 'memoria-originals',
  MEDIA_S3_ACCESS_KEY_ID: 'AKID',
  MEDIA_S3_SECRET_ACCESS_KEY: 'shh',
};

describe('parseConfig', () => {
  it('closes every feature on an empty env', () => {
    expect(parseConfig({})).toEqual({
      bootstrap: { appName: 'Memoria', siteUrl: null, adminEmail: '', adminPasswordHash: '', mail: null, mailProblem: null },
      isDevelopment: false,
      admin: { totpKey: null },
      settingsKey: null,
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
      TOTP_ENCRYPTION_KEY: ` ${KEY_B64} `,
      SETTINGS_ENCRYPTION_KEY: KEY_B64,
      MAIL_FROM: ' Studio@Example.COM ',
      SMTP_HOST: ' smtp.example.com ',
      TURNSTILE_SITE_KEY: 'site',
      TURNSTILE_SECRET_KEY: 'secret',
      HASH_SALT: 'salt',
      MEDIA_DEV_SIGNING_SECRET: ` ${SECRET} `,
      MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/',
      ...S3,
    });
    expect(config).toEqual({
      bootstrap: {
        appName: 'Studio',
        siteUrl: 'https://photos.example.com',
        adminEmail: 'admin@example.com',
        adminPasswordHash: 'pbkdf2$1',
        mail: { from: 'Studio@example.com', smtp: { host: 'smtp.example.com', port: 587, security: 'starttls', username: null, password: null } },
        mailProblem: null,
      },
      isDevelopment: true,
      admin: { totpKey: KEY },
      settingsKey: KEY,
      turnstile: { siteKey: 'site', secretKey: 'secret' },
      hashSalt: 'salt',
      media: {
        devSigningSecret: SECRET,
        publicBaseUrl: 'https://media.example.com',
        s3: {
          endpoint: 'https://acct.r2.cloudflarestorage.com',
          bucket: 'memoria-media',
          originalsBucket: 'memoria-originals',
          accessKeyId: 'AKID',
          secretAccessKey: 'shh',
        },
      },
    });
  });

  it.each([
    ['32 bytes', KEY_B64, KEY],
    ['31 bytes', btoa('x'.repeat(31)), null],
    ['33 bytes', btoa('x'.repeat(33)), null],
    ['not base64', '!!!not-base64!!!', null],
    ['empty', '', null],
  ])('TOTP_ENCRYPTION_KEY and SETTINGS_ENCRYPTION_KEY: %s', (_label, value, expected) => {
    expect(parseConfig({ TOTP_ENCRYPTION_KEY: value }).admin.totpKey).toEqual(expected);
    expect(parseConfig({ SETTINGS_ENCRYPTION_KEY: value }).settingsKey).toEqual(expected);
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

  it.each(Object.keys(S3))('needs all five S3 settings (without %s → null)', (missing) => {
    const env: Record<string, string> = { ...S3 };
    env[missing] = ' ';
    expect(parseConfig(env).media.s3).toBeNull();
  });

  it.each([
    ['empty', '', null],
    ['blank', '  ', null],
    ['slashes only', '//', null],
  ])('SITE_URL %s → null', (_label, value, expected) => {
    expect(parseConfig({ SITE_URL: value }).bootstrap.siteUrl).toBe(expected);
  });

  describe('the env mail fallback (MAIL_FROM + SMTP_*)', () => {
    const DEV = { NEXTJS_ENV: 'development' };
    const BASE = { MAIL_FROM: 'studio@example.com', SMTP_HOST: 'smtp.example.com' };
    const SECRET_VALUES = ['studio-login', 'app-password', '127.0.0.1', 'smtp.example.com', 'studio@example.com', 'abc'];

    it.each([
      ['nothing set', {}, null],
      ['only MAIL_FROM', { MAIL_FROM: 'studio@example.com' }, null],
      ['the defaults (STARTTLS on 587, no AUTH)', BASE, { from: 'studio@example.com', smtp: { host: 'smtp.example.com', port: 587, security: 'starttls', username: null, password: null } }],
      ['tls defaults to 465', { ...BASE, SMTP_SECURITY: 'TLS' }, { from: 'studio@example.com', smtp: { host: 'smtp.example.com', port: 465, security: 'tls', username: null, password: null } }],
      [
        'a full set',
        { ...BASE, SMTP_PORT: '2525', SMTP_USERNAME: 'studio-login', SMTP_PASSWORD: 'app-password' },
        { from: 'studio@example.com', smtp: { host: 'smtp.example.com', port: 2525, security: 'starttls', username: 'studio-login', password: 'app-password' } },
      ],
      [
        'Mailpit in development (none, 127.0.0.1, port 1025 by default)',
        { ...DEV, MAIL_FROM: 'studio@example.com', SMTP_HOST: '127.0.0.1', SMTP_SECURITY: 'none' },
        { from: 'studio@example.com', smtp: { host: '127.0.0.1', port: 1025, security: 'none', username: null, password: null } },
      ],
    ])('%s', (_label, env, expected) => {
      const config = parseConfig(env);
      expect(config.bootstrap.mail).toEqual(expected);
      expect(config.bootstrap.mailProblem).toBeNull();
    });

    it.each([
      ['a bad From', { ...BASE, MAIL_FROM: 'abc' }, 'MAIL_FROM is not an email address'],
      ['an unknown security', { ...BASE, SMTP_SECURITY: 'ssl' }, 'SMTP_SECURITY must be starttls, tls or none'],
      ['none outside development', { ...BASE, SMTP_SECURITY: 'none' }, 'SMTP_SECURITY=none is for development only'],
      ['an IP outside development', { ...BASE, SMTP_HOST: '127.0.0.1' }, 'SMTP_HOST must be a DNS name'],
      ['localhost outside development', { ...BASE, SMTP_HOST: 'localhost' }, 'SMTP_HOST must be a DNS name'],
      ['an .internal name', { ...DEV, ...BASE, SMTP_HOST: 'mail.corp.internal' }, 'SMTP_HOST must be a DNS name'],
      ['a bad port', { ...BASE, SMTP_PORT: '70000' }, 'SMTP_PORT must be a port number'],
      ['a port that is not a number', { ...BASE, SMTP_PORT: '58x' }, 'SMTP_PORT must be a port number'],
      ['a username without a password', { ...BASE, SMTP_USERNAME: 'studio-login' }, 'SMTP_USERNAME and SMTP_PASSWORD go together'],
      ['a password without a username', { ...BASE, SMTP_PASSWORD: 'app-password' }, 'SMTP_USERNAME and SMTP_PASSWORD go together'],
    ])('%s → off, with a problem that holds no value', (_label, env, problem) => {
      const config = parseConfig(env);
      expect(config.bootstrap.mail).toBeNull();
      expect(config.bootstrap.mailProblem).toBe(problem);
      for (const value of SECRET_VALUES) expect(problem).not.toContain(value);
    });
  });
});
