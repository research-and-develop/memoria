import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPlatform } from '@repo/platform/current';
import { signBlobToken, type BlobTokenPayload } from '@repo/platform/blobToken';
import { blobUrls } from '@repo/platform/blobUrls';
import { MAX_DEV_UPLOAD_BYTES } from '@repo/platform/media';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { ORIGIN } from '@/lib/testing/routeHarness';

import { PUT } from './route';

const SECRET = 'test-media-dev-signing-secret-0123456789';
const PNG: Uint8Array<ArrayBuffer> = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
let env: Record<string, string>;

beforeEach(() => {
  env = { NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: SECRET };
  useTestPlatform({ env });
});
afterEach(() => resetTestPlatform());

const now = () => Math.floor(Date.now() / 1000);
const mint = (key: string, size = PNG.byteLength, contentType = 'image/png') =>
  blobUrls(getPlatform().config()).uploadUrl(key, { contentType, size });
const handMint = async (payload: Partial<BlobTokenPayload>) =>
  `/api/blobs/upload?t=${await signBlobToken({ v: 1, op: 'put', key: 'dev/x.png', exp: now() + 60, ct: 'image/png', size: PNG.byteLength, ...payload } as BlobTokenPayload, SECRET)}`;

/** A header value meaning "leave this header out". */
const DROP = '<drop>';

function put(url: string, init: { body?: Uint8Array<ArrayBuffer> | null; headers?: Record<string, string> } = {}): NextRequest {
  const body = init.body === undefined ? PNG : init.body;
  const headers: Record<string, string> = {
    'sec-fetch-site': 'same-origin',
    'content-type': 'image/png',
    ...(body ? { 'content-length': String(body.byteLength) } : {}),
    ...(init.headers ?? {}),
  };
  for (const [k, v] of Object.entries(headers)) if (v === DROP) delete headers[k];
  return new NextRequest(`${ORIGIN}${url}`, { method: 'PUT', headers, body: body ?? undefined });
}

const errorCode = async (res: Response) => ((await res.json()) as { errorCode?: string }).errorCode;

describe('PUT /api/blobs/upload', () => {
  it('stores the upload, readable through the blob store', async () => {
    const { url, headers } = await mint('dev/happy.png');
    const res = await PUT(put(url, { headers }));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { key: string; size: number; etag: string } };
    expect(data).toMatchObject({ key: 'dev/happy.png', size: PNG.byteLength });
    expect(data.etag).toMatch(/^"[^"]+"$/);
    const stored = await getPlatform().blobs().get('dev/happy.png');
    expect(stored?.contentType).toBe('image/png');
    expect(new Uint8Array(await new Response(stored!.body).arrayBuffer())).toEqual(PNG);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('does not exist outside development (404), even with a valid token', async () => {
    const { url } = await mint('dev/prod.png');
    env.NEXTJS_ENV = 'production';
    const res = await PUT(put(url));
    expect(res.status).toBe(404);
    expect(await getPlatform().blobs().head('dev/prod.png')).toBeNull();
  });

  it.each([
    ['another site', { 'sec-fetch-site': 'cross-site' }],
    ['no Origin and no Sec-Fetch-Site', { 'sec-fetch-site': '' }],
    ['a foreign Origin', { 'sec-fetch-site': '', origin: 'https://evil.example' }],
  ])('refuses a cross-origin upload: %s (403)', async (_label, headers) => {
    const { url } = await mint('dev/cross.png');
    const res = await PUT(put(url, { headers }));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each([
    ['no token', async () => '/api/blobs/upload'],
    ['a garbage token', async () => '/api/blobs/upload?t=abc.def'],
    ['an expired token', () => handMint({ exp: now() - 1 })],
    ['a read token', async () => blobUrls(getPlatform().config()).readUrl('dev/x.png').then((u) => u.replace('/read?', '/upload?'))],
    ['a token signed with another secret', async () => {
      const token = await signBlobToken({ v: 1, op: 'put', key: 'dev/x.png', exp: now() + 60, ct: 'image/png', size: PNG.byteLength }, `${SECRET}-other`);
      return `/api/blobs/upload?t=${token}`;
    }],
  ])('refuses %s (403 BLOB_TOKEN_INVALID)', async (_label, url) => {
    const res = await PUT(put(await url()));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('BLOB_TOKEN_INVALID');
  });

  it.each(['text/html', 'image/svg+xml'])('never stores %s: blobUrls refuses to mint it, and a hand-minted token is refused', async (type) => {
    await expect(mint('dev/evil.png', PNG.byteLength, type)).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
    const res = await PUT(put(await handMint({ ct: type }), { headers: { 'content-type': type } }));
    expect(res.status).toBe(403);
    expect(await getPlatform().blobs().head('dev/x.png')).toBeNull();
  });

  it('refuses a Content-Type other than the token’s (400)', async () => {
    const { url } = await mint('dev/type.png');
    const res = await PUT(put(url, { headers: { 'content-type': 'image/jpeg' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field: 'content-type' } });
  });

  it.each([
    ['missing', { 'content-length': DROP }],
    ['wrong', { 'content-length': String(PNG.byteLength + 1) }],
  ])('refuses a %s Content-Length (400)', async (_label, headers) => {
    const { url } = await mint('dev/length.png');
    const res = await PUT(put(url, { headers }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field: 'content-length' } });
  });

  it('refuses more than MAX_DEV_UPLOAD_BYTES before reading a byte (413)', async () => {
    const size = MAX_DEV_UPLOAD_BYTES + 1;
    // blobUrls will not mint this in dev mode; a hand-minted token tests the route's own bound.
    await expect(mint('dev/big.png', size)).rejects.toMatchObject({ code: 'INVALID_BLOB_REQUEST' });
    const res = await PUT(put(await handMint({ key: 'dev/big.png', size }), { body: null, headers: { 'content-length': String(size) } }));
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('keeps an existing file (409 BLOB_EXISTS)', async () => {
    await getPlatform().blobs().put('dev/taken.png', new Uint8Array([1]), { contentType: 'image/png' });
    const { url } = await mint('dev/taken.png');
    const res = await PUT(put(url));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('BLOB_EXISTS');
    expect((await getPlatform().blobs().head('dev/taken.png'))?.size).toBe(1);
  });
});
