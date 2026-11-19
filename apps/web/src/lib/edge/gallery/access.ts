/**
 * The gallery's three signed tokens (plan p06 D6.9–D6.12), on Web Crypto only (workerd and Node):
 * - **access cookie** `mg_<first 12 hex of the gallery id>` = `v1.<password_version>.<expiry>.<MAC>`,
 *   MAC = HMAC(access key, `access|v1|<full gallery id>|<password_version>|<expiry>`): set by the
 *   password gate (Phase 6 commit 4); a password change (`password_version + 1`) ends every cookie;
 * - **preview token** `<expiry>.<MAC>`, MAC = HMAC(preview key, `preview|v1|<full gallery id>|<expiry>`):
 *   opens a DRAFT for an hour (*View as client*);
 * - **visitor cookie** `mv` = `v1.<128-bit id>.<MAC>`, MAC = HMAC(visitor key, `visitor|v1|<id>`): one
 *   anonymous id per browser for Phases 7 and 11, set without a D1 write.
 * Three keys from one secret (`SETTINGS_ENCRYPTION_KEY`, HKDF-SHA256, salt `memoria:gallery:salt:v1`,
 * one info each): a MAC of one kind never verifies as another. Expiries are Unix SECONDS. MACs are
 * base64url. Verification is `crypto.subtle.verify` (constant time), after the cheap shape and expiry
 * checks. Import-free.
 */

export type GalleryKeys = { access: CryptoKey; preview: CryptoKey; visitor: CryptoKey };

export const GALLERY_KEY_SALT = 'memoria:gallery:salt:v1';
export const GALLERY_KEY_INFO = {
  access: 'memoria:gallery-access:v1',
  preview: 'memoria:gallery-preview:v1',
  visitor: 'memoria:gallery-visitor:v1',
} as const;

/** 30 days: the access cookie's lifetime (D6.10). */
export const ACCESS_TTL_SECONDS = 30 * 24 * 3600;
/** 1 hour: a preview link's lifetime (D6.11). */
export const PREVIEW_TTL_SECONDS = 3600;
/** 1 year: the visitor cookie's lifetime (D6.12). */
export const VISITOR_TTL_SECONDS = 365 * 24 * 3600;
export const VISITOR_COOKIE = 'mv';

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The three HMAC keys of one 32-byte secret (D6.9). */
export async function deriveGalleryKeys(secret: Uint8Array): Promise<GalleryKeys> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(secret), 'HKDF', false, ['deriveKey']);
  const derive = (info: string) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(GALLERY_KEY_SALT), info: encoder.encode(info) },
      base,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    );
  const [access, preview, visitor] = await Promise.all([derive(GALLERY_KEY_INFO.access), derive(GALLERY_KEY_INFO.preview), derive(GALLERY_KEY_INFO.visitor)]);
  return { access, preview, visitor };
}

async function mac(key: CryptoKey, message: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

async function macValid(key: CryptoKey, message: string, signature: string): Promise<boolean> {
  const bytes = fromBase64Url(signature);
  if (!bytes || bytes.length !== 32) return false;
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(message));
}

/** A decimal expiry in seconds, strictly in the future, or null. */
function liveExpiry(text: string | undefined, nowSeconds: number): number | null {
  if (!text || !/^[1-9]\d{0,11}$/.test(text)) return null;
  const expiry = Number(text);
  return expiry > nowSeconds ? expiry : null;
}

const seconds = (now: Date) => Math.floor(now.getTime() / 1000);

// ── access cookie ────────────────────────────────────────────────────────────

/** `mg_` + the first 12 hex digits of the gallery id: cookies of different galleries never collide. */
export function accessCookieName(galleryId: string): string {
  return `mg_${galleryId.replace(/-/g, '').slice(0, 12).toLowerCase()}`;
}

const accessMessage = (galleryId: string, version: number, expiry: number) => `access|v1|${galleryId}|${version}|${expiry}`;

export async function signAccessCookie(key: CryptoKey, input: { galleryId: string; passwordVersion: number; now: Date }): Promise<string> {
  const expiry = seconds(input.now) + ACCESS_TTL_SECONDS;
  return `v1.${input.passwordVersion}.${expiry}.${await mac(key, accessMessage(input.galleryId, input.passwordVersion, expiry))}`;
}

/** Does this cookie open this gallery at its current password version? */
export async function verifyAccessCookie(
  key: CryptoKey,
  value: string | null,
  input: { galleryId: string; passwordVersion: number; now: Date },
): Promise<boolean> {
  if (!value) return false;
  const [v, version, expiryText, signature, ...rest] = value.split('.');
  if (v !== 'v1' || rest.length > 0 || !signature || version !== String(input.passwordVersion)) return false;
  const expiry = liveExpiry(expiryText, seconds(input.now));
  if (expiry === null) return false;
  return macValid(key, accessMessage(input.galleryId, input.passwordVersion, expiry), signature);
}

// ── preview token ────────────────────────────────────────────────────────────

const previewMessage = (galleryId: string, expiry: number) => `preview|v1|${galleryId}|${expiry}`;

export async function signPreviewToken(key: CryptoKey, input: { galleryId: string; now: Date }): Promise<string> {
  const expiry = seconds(input.now) + PREVIEW_TTL_SECONDS;
  return `${expiry}.${await mac(key, previewMessage(input.galleryId, expiry))}`;
}

export async function verifyPreviewToken(key: CryptoKey, value: string | null, input: { galleryId: string; now: Date }): Promise<boolean> {
  if (!value || value.length > 100) return false;
  const [expiryText, signature, ...rest] = value.split('.');
  if (rest.length > 0 || !signature) return false;
  const expiry = liveExpiry(expiryText, seconds(input.now));
  if (expiry === null) return false;
  return macValid(key, previewMessage(input.galleryId, expiry), signature);
}

// ── visitor cookie ───────────────────────────────────────────────────────────

const visitorMessage = (id: string) => `visitor|v1|${id}`;

export async function mintVisitorCookie(key: CryptoKey): Promise<string> {
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  return `v1.${id}.${await mac(key, visitorMessage(id))}`;
}

/** The visitor id of a valid `mv` cookie, or null (absent, malformed or tampered → mint a new one). */
export async function verifyVisitorCookie(key: CryptoKey, value: string | null): Promise<string | null> {
  if (!value || value.length > 100) return null;
  const [v, id, signature, ...rest] = value.split('.');
  if (v !== 'v1' || rest.length > 0 || !id || !signature || fromBase64Url(id)?.length !== 16) return null;
  return (await macValid(key, visitorMessage(id), signature)) ? id : null;
}

// ── Set-Cookie ───────────────────────────────────────────────────────────────

/** `Path=/` (Phases 7 and 11 post to `/api/g/<slug>/…`), `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS. */
export function setCookieHeader(name: string, value: string, opts: { maxAge: number; secure: boolean }): string {
  return `${name}=${value}; Path=/; Max-Age=${opts.maxAge}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
}
