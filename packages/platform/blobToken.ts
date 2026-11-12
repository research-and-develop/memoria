import { isBlobKey, isMediaType } from './media';

/**
 * Tokens for the development-only blob routes (`/api/blobs/upload`, `/api/blobs/read`): a payload
 * signed with HMAC-SHA256, `base64url(payload).base64url(mac)`. Minted by server code (blobUrls.ts),
 * checked by the routes. Production uses presigned S3 URLs instead; these never leave a dev machine.
 *
 * The MAC key is derived from the secret with a purpose label, so the same secret could sign
 * something else later without a token of one kind passing as another.
 */

export type BlobTokenPayload = {
  v: 1;
  op: 'put' | 'get';
  key: string;
  /** Expiry, Unix seconds. */
  exp: number;
  /** put: the content type the upload must carry. */
  ct?: string;
  /** put: the exact byte size. */
  size?: number;
  /** get: a download name (sent as Content-Disposition). */
  dn?: string;
};

export const MAX_TOKEN_LENGTH = 2048;
const PURPOSE = 'memoria:blob:v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function macKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', base, encoder.encode(PURPOSE));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signBlobToken(payload: BlobTokenPayload, secret: string): Promise<string> {
  const body = encoder.encode(JSON.stringify(payload));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await macKey(secret), body));
  return `${toBase64Url(body)}.${toBase64Url(mac)}`;
}

/**
 * The payload of a valid, unexpired token, or null. Order: length cap, MAC (constant time, over the
 * raw bytes), and only then JSON and the claims. It does not bound `size`: the route does.
 * `now` is Unix seconds.
 */
export async function verifyBlobToken(token: unknown, secret: string | null, now: number): Promise<BlobTokenPayload | null> {
  if (!secret || typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const [bodyPart, macPart, extra] = token.split('.');
  if (bodyPart === undefined || macPart === undefined || extra !== undefined) return null;
  const body = fromBase64Url(bodyPart);
  const mac = fromBase64Url(macPart);
  if (!body || !mac) return null;
  if (!(await crypto.subtle.verify('HMAC', await macKey(secret), mac, body))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(body));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Partial<BlobTokenPayload>;
  if (p.v !== 1 || (p.op !== 'put' && p.op !== 'get')) return null;
  if (typeof p.exp !== 'number' || !(p.exp > now)) return null;
  if (!isBlobKey(p.key)) return null;
  if (p.op === 'put' && (!isMediaType(p.ct) || typeof p.size !== 'number' || !Number.isInteger(p.size) || p.size <= 0)) return null;
  if (p.dn !== undefined && typeof p.dn !== 'string') return null;
  return p as BlobTokenPayload;
}
