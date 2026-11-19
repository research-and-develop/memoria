import { beforeAll, describe, expect, it } from 'vitest';

import {
  ACCESS_TTL_SECONDS,
  PREVIEW_TTL_SECONDS,
  accessCookieName,
  deriveGalleryKeys,
  mintVisitorCookie,
  setCookieHeader,
  signAccessCookie,
  signPreviewToken,
  verifyAccessCookie,
  verifyPreviewToken,
  verifyVisitorCookie,
  type GalleryKeys,
} from './access';

const A = '9a11e700-0000-4000-8000-000000000001';
const B = '9a11e700-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-19T10:00:00.000Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

let keys: GalleryKeys;
beforeAll(async () => {
  keys = await deriveGalleryKeys(new Uint8Array(32).fill(7));
});

describe('the access cookie', () => {
  const access = (over: Partial<{ galleryId: string; passwordVersion: number; now: Date }> = {}) => ({ galleryId: A, passwordVersion: 3, now: NOW, ...over });

  it('verifies for its gallery and password version until it expires', async () => {
    const cookie = await signAccessCookie(keys.access, access());
    expect(cookie).toMatch(/^v1\.3\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyAccessCookie(keys.access, cookie, access({ now: later(ACCESS_TTL_SECONDS - 1) }))).toBe(true);
    expect(await verifyAccessCookie(keys.access, cookie, access({ now: later(ACCESS_TTL_SECONDS) }))).toBe(false);
  });

  it("refuses gallery A's cookie for gallery B (same version and expiry)", async () => {
    const cookie = await signAccessCookie(keys.access, access());
    expect(await verifyAccessCookie(keys.access, cookie, access({ galleryId: B }))).toBe(false);
  });

  it('refuses an old password version (a password change ends every cookie)', async () => {
    const cookie = await signAccessCookie(keys.access, access());
    expect(await verifyAccessCookie(keys.access, cookie, access({ passwordVersion: 4 }))).toBe(false);
  });

  it('refuses a tampered MAC, version or expiry', async () => {
    const cookie = await signAccessCookie(keys.access, access());
    const [v, version, expiry, mac] = cookie.split('.') as [string, string, string, string];
    const flipped = `${mac.slice(0, -2)}${mac.endsWith('AA') ? 'AB' : 'AA'}`;
    expect(await verifyAccessCookie(keys.access, `${v}.${version}.${expiry}.${flipped}`, access())).toBe(false);
    expect(await verifyAccessCookie(keys.access, `${v}.${version}.${Number(expiry) + 1000}.${mac}`, access())).toBe(false);
  });

  it.each([null, '', 'v1', 'v2.3.9999999999.x', 'v1.3.notanumber.x', 'v1.3.0123.x', 'v1.3.1.x', 'v1.3.9999999999', 'v1.3.9999999999.mac.extra'])(
    'refuses the malformed value %j',
    async (value) => {
      expect(await verifyAccessCookie(keys.access, value, access())).toBe(false);
    },
  );

  it('is named by the first 12 hex digits of the gallery id', () => {
    expect(accessCookieName(A)).toBe('mg_9a11e7000000');
  });
});

describe('the preview token', () => {
  it('verifies for its gallery for one hour', async () => {
    const token = await signPreviewToken(keys.preview, { galleryId: A, now: NOW });
    expect(await verifyPreviewToken(keys.preview, token, { galleryId: A, now: later(PREVIEW_TTL_SECONDS - 1) })).toBe(true);
    expect(await verifyPreviewToken(keys.preview, token, { galleryId: A, now: later(PREVIEW_TTL_SECONDS) })).toBe(false);
    expect(await verifyPreviewToken(keys.preview, token, { galleryId: B, now: NOW })).toBe(false);
  });

  it.each([null, '', '123', 'x.y', '1.a.b'])('refuses the malformed value %j', async (value) => {
    expect(await verifyPreviewToken(keys.preview, value, { galleryId: A, now: NOW })).toBe(false);
  });
});

describe('the keys are separate (HKDF infos)', () => {
  it('an access MAC is no preview token, and a preview MAC no access cookie', async () => {
    // The same expiry under the other key: the message prefix and the key both differ.
    const cookie = await signAccessCookie(keys.access, { galleryId: A, passwordVersion: 1, now: NOW });
    const [, , expiry, accessMac] = cookie.split('.');
    expect(await verifyPreviewToken(keys.preview, `${expiry}.${accessMac}`, { galleryId: A, now: NOW })).toBe(false);
    const token = await signPreviewToken(keys.preview, { galleryId: A, now: NOW });
    const [previewExpiry, previewMac] = token.split('.');
    expect(await verifyAccessCookie(keys.access, `v1.1.${previewExpiry}.${previewMac}`, { galleryId: A, passwordVersion: 1, now: NOW })).toBe(false);
  });

  it('a cookie signed with another secret does not verify', async () => {
    const other = await deriveGalleryKeys(new Uint8Array(32).fill(8));
    const cookie = await signAccessCookie(other.access, { galleryId: A, passwordVersion: 1, now: NOW });
    expect(await verifyAccessCookie(keys.access, cookie, { galleryId: A, passwordVersion: 1, now: NOW })).toBe(false);
  });

  it('the three derived keys sign differently', async () => {
    const data = new TextEncoder().encode('same message');
    const sigs = await Promise.all([keys.access, keys.preview, keys.visitor].map(async (k) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, data))))));
    expect(new Set(sigs).size).toBe(3);
  });
});

describe('the visitor cookie', () => {
  it('mints a random id that verifies', async () => {
    const one = await mintVisitorCookie(keys.visitor);
    const two = await mintVisitorCookie(keys.visitor);
    expect(one).toMatch(/^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(one).not.toBe(two);
    expect(await verifyVisitorCookie(keys.visitor, one)).toBe(one.split('.')[1]);
  });

  it.each([null, '', 'v1.abc.def', 'v2.x.y'])('refuses %j', async (value) => {
    expect(await verifyVisitorCookie(keys.visitor, value)).toBeNull();
  });

  it('refuses a tampered id', async () => {
    const [v, id, mac] = (await mintVisitorCookie(keys.visitor)).split('.') as [string, string, string];
    const other = `${id.slice(0, -1)}${id.endsWith('A') ? 'Q' : 'A'}`;
    expect(await verifyVisitorCookie(keys.visitor, `${v}.${other}.${mac}`)).toBeNull();
  });
});

describe('setCookieHeader', () => {
  it.each([
    [true, 'mv=x; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure'],
    [false, 'mv=x; Path=/; Max-Age=60; HttpOnly; SameSite=Lax'],
  ])('secure=%s → %s', (secure, header) => {
    expect(setCookieHeader('mv', 'x', { maxAge: 60, secure })).toBe(header);
  });
});
