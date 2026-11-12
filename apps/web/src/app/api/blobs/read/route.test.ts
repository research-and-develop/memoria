import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPlatform } from '@repo/platform/current';
import { signBlobToken } from '@repo/platform/blobToken';
import { blobUrls } from '@repo/platform/blobUrls';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { ORIGIN } from '@/lib/testing/routeHarness';

import { GET } from './route';

const SECRET = 'test-media-dev-signing-secret-0123456789';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
let env: Record<string, string>;

beforeEach(async () => {
  env = { NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: SECRET };
  useTestPlatform({ env });
  await getPlatform().blobs().put('dev/photo.png', PNG, { contentType: 'image/png' });
});
afterEach(() => resetTestPlatform());

const readUrl = (key: string, opts?: { expiresInSeconds?: number; downloadName?: string }) => blobUrls(getPlatform().config()).readUrl(key, opts);
const get = (url: string, headers: Record<string, string> = {}) => new NextRequest(`${ORIGIN}${url}`, { headers });
const errorCode = async (res: Response) => ((await res.json()) as { errorCode?: string }).errorCode;

describe('GET /api/blobs/read', () => {
  it('serves the bytes with inert, private, cacheable headers', async () => {
    const res = await GET(get(await readUrl('dev/photo.png', { expiresInSeconds: 120 })));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    const meta = await getPlatform().blobs().head('dev/photo.png');
    const expected = {
      'content-type': 'image/png',
      'content-length': String(PNG.byteLength),
      etag: meta!.etag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
    };
    for (const [name, value] of Object.entries(expected)) expect(res.headers.get(name), name).toBe(value);
    expect(res.headers.get('cache-control')).toMatch(/^private, max-age=(119|120)$/);
    expect(res.headers.get('content-disposition')).toBeNull();
  });

  it('names the download when the link carries a name', async () => {
    const res = await GET(get(await readUrl('dev/photo.png', { downloadName: 'Wedding "final".png' })));
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="Wedding _final_.png"; filename*=UTF-8''Wedding%20%22final%22.png`);
  });

  it('serves a stored type outside the allowlist as an attachment, never as itself', async () => {
    await getPlatform().blobs().put('dev/page.png', new TextEncoder().encode('<script>'), { contentType: 'text/html' });
    const res = await GET(get(await readUrl('dev/page.png')));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="page\.png"/);
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const meta = await getPlatform().blobs().head('dev/photo.png');
    const res = await GET(get(await readUrl('dev/photo.png'), { 'if-none-match': meta!.etag }));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(meta!.etag);
    expect(await res.text()).toBe('');
  });

  it('answers 404 for a valid link to a missing file', async () => {
    const res = await GET(get(await readUrl('dev/missing.png')));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each([
    ['a missing key', 'dev/missing.png'],
    ['an existing key', 'dev/photo.png'],
  ])('answers 403, never 404, to a bad token for %s', async (_label, key) => {
    const token = await signBlobToken({ v: 1, op: 'get', key, exp: Math.floor(Date.now() / 1000) + 60 }, `${SECRET}-other`);
    const res = await GET(get(`/api/blobs/read?t=${token}`));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('BLOB_TOKEN_INVALID');
  });

  it('refuses an upload token (403)', async () => {
    const { url } = await blobUrls(getPlatform().config()).uploadUrl('dev/photo.png', { contentType: 'image/png', size: 7 });
    const res = await GET(get(url.replace('/upload?', '/read?')));
    expect(res.status).toBe(403);
  });

  it('does not exist outside development (404)', async () => {
    const url = await readUrl('dev/photo.png');
    delete env.NEXTJS_ENV;
    const res = await GET(get(url));
    expect(res.status).toBe(404);
  });
});
