import { describe, expect, it } from 'vitest';

import { MAX_TOKEN_LENGTH, signBlobToken, verifyBlobToken, type BlobTokenPayload } from './blobToken';

const SECRET = 'a-local-secret-that-is-long-enough-123';
const NOW = 1_800_000_000;
const PUT: BlobTokenPayload = { v: 1, op: 'put', key: 'dev/probe.png', exp: NOW + 60, ct: 'image/png', size: 5 };
const GET: BlobTokenPayload = { v: 1, op: 'get', key: 'galleries/a/b.jpg', exp: NOW + 60, dn: 'IMG 1.jpg' };

/** Sign without the claim checks, to build tokens the minting code would never produce. */
const sign = (payload: Record<string, unknown>) => signBlobToken(payload as unknown as BlobTokenPayload, SECRET);

describe('blob tokens', () => {
  it.each([
    ['put', PUT],
    ['get', GET],
  ])('round-trips a %s token', async (_label, payload) => {
    expect(await verifyBlobToken(await signBlobToken(payload, SECRET), SECRET, NOW)).toEqual(payload);
  });

  it('is URL-safe', async () => {
    expect(await signBlobToken(PUT, SECRET)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('refuses a token signed with another secret, or with no secret', async () => {
    const token = await signBlobToken(PUT, SECRET);
    expect(await verifyBlobToken(token, `${SECRET}-other`, NOW)).toBeNull();
    expect(await verifyBlobToken(token, null, NOW)).toBeNull();
    expect(await verifyBlobToken(token, '', NOW)).toBeNull();
  });

  it('refuses a tampered payload or MAC', async () => {
    const [body, mac] = (await signBlobToken(PUT, SECRET)).split('.') as [string, string];
    const other = (await signBlobToken({ ...PUT, key: 'dev/other.png' }, SECRET)).split('.')[0];
    expect(await verifyBlobToken(`${other}.${mac}`, SECRET, NOW)).toBeNull();
    const flipped = mac.slice(0, -1) + (mac.endsWith('A') ? 'B' : 'A');
    expect(await verifyBlobToken(`${body}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it('expires at exp', async () => {
    const token = await signBlobToken(PUT, SECRET);
    expect(await verifyBlobToken(token, SECRET, PUT.exp - 1)).not.toBeNull();
    expect(await verifyBlobToken(token, SECRET, PUT.exp)).toBeNull();
  });

  it.each([
    ['a wrong version', { ...PUT, v: 2 }],
    ['an unknown op', { ...PUT, op: 'delete' }],
    ['a bad key', { ...PUT, key: 'galleries/../x.png' }],
    ['a disallowed type', { ...PUT, ct: 'text/html' }],
    ['SVG', { ...PUT, ct: 'image/svg+xml' }],
    ['a put without size', { ...PUT, size: undefined }],
    ['a zero size', { ...PUT, size: 0 }],
    ['a fractional size', { ...PUT, size: 1.5 }],
    ['a non-numeric exp', { ...PUT, exp: String(NOW + 60) }],
    ['a non-string download name', { ...GET, dn: 42 }],
  ])('refuses a validly signed token with %s', async (_label, payload) => {
    expect(await verifyBlobToken(await sign(payload), SECRET, NOW)).toBeNull();
  });

  it('does not bound the size (the route does)', async () => {
    expect(await verifyBlobToken(await sign({ ...PUT, size: 10 ** 12 }), SECRET, NOW)).not.toBeNull();
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['no dot', 'abc'],
    ['three parts', 'a.b.c'],
    ['not base64url', 'a+b.c/d'],
    ['too long', 'a'.repeat(MAX_TOKEN_LENGTH + 1)],
  ])('refuses a malformed token: %s', async (_label, token) => {
    expect(await verifyBlobToken(token, SECRET, NOW)).toBeNull();
  });
});
