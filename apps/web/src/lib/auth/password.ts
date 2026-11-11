import { constantTimeEqual, fromBase64, toBase64 } from './crypto';

/**
 * The admin password hash: `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`,
 * stored as the Worker secret ADMIN_PASSWORD_HASH and made by
 * `npm run admin:hash-password`. PBKDF2 runs natively in Web Crypto but its
 * CPU counts against the Workers limit, so the iteration count is a measured
 * trade-off (docs/admin-auth.md); the password itself is long and generated.
 */
export const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256';
export const DEFAULT_ITERATIONS = 20_000;
/** Workers refuse PBKDF2 above 100 000 iterations. */
export const MAX_ITERATIONS = 100_000;
const KEY_BITS = 256;

export type ParsedPasswordHash = { iterations: number; salt: Uint8Array; hash: Uint8Array };

export function parsePasswordHash(stored: string | null | undefined): ParsedPasswordHash | null {
  if (!stored) return null;
  const parts = stored.trim().split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_SCHEME) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > MAX_ITERATIONS) return null;
  const salt = fromBase64(parts[2] ?? '');
  const hash = fromBase64(parts[3] ?? '');
  if (!salt || salt.length < 16 || !hash || hash.length !== KEY_BITS / 8) return null;
  return { iterations, salt, hash };
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS, salt?: Uint8Array): Promise<string> {
  if (iterations < 1_000 || iterations > MAX_ITERATIONS) throw new Error(`iterations must be 1000–${MAX_ITERATIONS}`);
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, s, iterations);
  return `${PASSWORD_HASH_SCHEME}$${iterations}$${toBase64(s)}$${toBase64(hash)}`;
}

/** True when `password` matches `stored`. A malformed `stored` never matches. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed || typeof password !== 'string' || password.length === 0 || password.length > 1024) return false;
  const candidate = await derive(password, parsed.salt, parsed.iterations);
  return constantTimeEqual(candidate, parsed.hash);
}
