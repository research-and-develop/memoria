import { describe, expect, it } from 'vitest';

import { verifyBlobToken } from './blobToken';
import { blobUrls, MAX_DEV_READ_EXPIRY, MAX_S3_READ_EXPIRY, MAX_UPLOAD_EXPIRY } from './blobUrls';
import { parseConfig } from './config';
import { MAX_DEV_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from './media';

const NOW = 1_800_000_000;
const SECRET = 'a-local-secret-that-is-long-enough-123';
const S3_ENV = {
  MEDIA_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  MEDIA_S3_BUCKET: 'memoria-media',
  MEDIA_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  MEDIA_S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};
const SIGNING_TIME = '20270115T080000Z';

const dev = () => blobUrls(parseConfig({ NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: SECRET }), { now: () => NOW });
const s3 = () => blobUrls(parseConfig(S3_ENV), { now: () => NOW, signingTime: SIGNING_TIME });
const tokenOf = (url: string) => new URL(url, 'http://local').searchParams.get('t');

describe('blobUrls: mode', () => {
  it.each([
    ['S3 credentials (production)', S3_ENV, 's3'],
    ['S3 credentials win in development too', { ...S3_ENV, NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: SECRET }, 's3'],
    ['development with a secret', { NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: SECRET }, 'dev'],
    ['development without a secret', { NEXTJS_ENV: 'development' }, 'none'],
    ['a secret outside development', { MEDIA_DEV_SIGNING_SECRET: SECRET }, 'none'],
    ['nothing', {}, 'none'],
  ])('%s → %s', (_label, env, mode) => {
    expect(blobUrls(parseConfig(env)).mode).toBe(mode);
  });

  it('refuses to mint without a mode (production without S3)', async () => {
    const urls = blobUrls(parseConfig({ MEDIA_DEV_SIGNING_SECRET: SECRET }));
    await expect(urls.uploadUrl('dev/a.png', { contentType: 'image/png', size: 5 })).rejects.toMatchObject({ code: 'MEDIA_NOT_CONFIGURED' });
    await expect(urls.readUrl('dev/a.png')).rejects.toMatchObject({ code: 'MEDIA_NOT_CONFIGURED' });
  });
});

describe('blobUrls: dev mode', () => {
  it('mints a relative upload URL with a put token bound to key, type, size and expiry', async () => {
    const upload = await dev().uploadUrl('dev/a.png', { contentType: 'image/png', size: 5, expiresInSeconds: 60 });
    expect(upload.method).toBe('PUT');
    expect(upload.headers).toEqual({ 'content-type': 'image/png' });
    expect(upload.url).toMatch(/^\/api\/blobs\/upload\?t=[\w-]+\.[\w-]+$/);
    expect(await verifyBlobToken(tokenOf(upload.url), SECRET, NOW)).toEqual({ v: 1, op: 'put', key: 'dev/a.png', exp: NOW + 60, ct: 'image/png', size: 5 });
  });

  it('mints a relative read URL with a get token and the download name', async () => {
    const url = await dev().readUrl('galleries/x/y.jpg', { downloadName: 'IMG 1.jpg' });
    expect(url).toMatch(/^\/api\/blobs\/read\?t=/);
    expect(await verifyBlobToken(tokenOf(url), SECRET, NOW)).toEqual({ v: 1, op: 'get', key: 'galleries/x/y.jpg', exp: NOW + 300, dn: 'IMG 1.jpg' });
  });

  it('caps uploads at the dev size', async () => {
    await expect(dev().uploadUrl('dev/a.png', { contentType: 'image/png', size: MAX_DEV_UPLOAD_BYTES })).resolves.toBeTruthy();
    await expect(dev().uploadUrl('dev/a.png', { contentType: 'image/png', size: MAX_DEV_UPLOAD_BYTES + 1 })).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
  });

  it('caps read expiry at an hour', async () => {
    await expect(dev().readUrl('dev/a.png', { expiresInSeconds: MAX_DEV_READ_EXPIRY })).resolves.toBeTruthy();
    await expect(dev().readUrl('dev/a.png', { expiresInSeconds: MAX_DEV_READ_EXPIRY + 1 })).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
  });
});

describe('blobUrls: S3 mode', () => {
  it('presigns a PUT on the bucket path with the content type signed', async () => {
    const upload = await s3().uploadUrl('galleries/a/b.jpg', { contentType: 'image/jpeg', size: 1000, expiresInSeconds: 600 });
    const url = new URL(upload.url);
    expect(url.origin + url.pathname).toBe('https://acct.r2.cloudflarestorage.com/memoria-media/galleries/a/b.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20270115/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Date')).toBe(SIGNING_TIME);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    // Pinned for a fixed time and key pair: a change here means signing changed (an aws4fetch upgrade?).
    expect(url.searchParams.get('X-Amz-Signature')).toBe('a798cb124eb1da50d3afb7477dcde80bbe0653656c7156423fcc1705306cba0b');
    expect(upload.headers).toEqual({ 'content-type': 'image/jpeg' });
  });

  it('is deterministic for a fixed time, and the type is part of the signature', async () => {
    const sig = async (contentType: string) =>
      new URL((await s3().uploadUrl('galleries/a/b.jpg', { contentType, size: 1000 })).url).searchParams.get('X-Amz-Signature');
    expect(await sig('image/jpeg')).toBe(await sig('image/jpeg'));
    expect(await sig('image/jpeg')).not.toBe(await sig('image/png'));
  });

  it('presigns a GET with a sanitised download disposition', async () => {
    const url = new URL(await s3().readUrl('galleries/a/b.jpg', { expiresInSeconds: 3600, downloadName: 'a"b.jpg' }));
    expect(url.pathname).toBe('/memoria-media/galleries/a/b.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('response-content-disposition')).toBe(`attachment; filename="a_b.jpg"; filename*=UTF-8''a%22b.jpg`);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('allows the full 100 MB upload and a day-long read', async () => {
    await expect(s3().uploadUrl('dev/a.png', { contentType: 'image/png', size: MAX_UPLOAD_BYTES })).resolves.toBeTruthy();
    await expect(s3().readUrl('dev/a.png', { expiresInSeconds: MAX_S3_READ_EXPIRY })).resolves.toBeTruthy();
    await expect(s3().readUrl('dev/a.png', { expiresInSeconds: MAX_S3_READ_EXPIRY + 1 })).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
  });
});

describe('blobUrls: bounds (every mode)', () => {
  it.each([
    ['a bad key', 'galleries/../a.png', { contentType: 'image/png', size: 5 }],
    ['an unknown prefix', 'tmp/a.png', { contentType: 'image/png', size: 5 }],
    ['HTML', 'dev/a.html', { contentType: 'text/html', size: 5 }],
    ['SVG', 'dev/a.svg', { contentType: 'image/svg+xml', size: 5 }],
    ['a zero size', 'dev/a.png', { contentType: 'image/png', size: 0 }],
    ['over 100 MB', 'dev/a.png', { contentType: 'image/png', size: MAX_UPLOAD_BYTES + 1 }],
    ['a long expiry', 'dev/a.png', { contentType: 'image/png', size: 5, expiresInSeconds: MAX_UPLOAD_EXPIRY + 1 }],
    ['a zero expiry', 'dev/a.png', { contentType: 'image/png', size: 5, expiresInSeconds: 0 }],
  ])('refuses an upload with %s', async (_label, key, opts) => {
    await expect(s3().uploadUrl(key, opts)).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
    await expect(dev().uploadUrl(key, opts)).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
  });

  it('allows the longest upload expiry', async () => {
    await expect(s3().uploadUrl('dev/a.png', { contentType: 'image/png', size: 5, expiresInSeconds: MAX_UPLOAD_EXPIRY })).resolves.toBeTruthy();
  });
});

describe('blobUrls: publicUrl', () => {
  it('joins the public base and the key', () => {
    expect(blobUrls(parseConfig({ MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/' })).publicUrl('galleries/a/b.jpg')).toBe(
      'https://media.example.com/galleries/a/b.jpg',
    );
  });

  it('is null without a public domain, and refuses a bad key', () => {
    expect(dev().publicUrl('galleries/a/b.jpg')).toBeNull();
    expect(() => dev().publicUrl('../a.jpg')).toThrow();
  });
});
