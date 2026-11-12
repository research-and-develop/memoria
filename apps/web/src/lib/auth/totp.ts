/**
 * TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30-second steps, one step of drift
 * either way. Pure: Web Crypto only, no env, no database.
 *
 * Every authenticator and every step is checked, with no early exit, and codes
 * are compared in constant time: the time taken does not reveal which app or
 * step matched. The caller still enforces "a step is used once" in the write
 * (`last_step < ?`), this module only reports what matched.
 */
import { constantTimeEqualStrings } from './crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted either side of the current one. */
export const TOTP_DRIFT_STEPS = 1;
/** 20 random bytes (160 bits), the size RFC 4226 recommends for SHA-1. */
export const TOTP_SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, upper case, without padding (what authenticator apps expect). */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/** Decode base32; case, spaces and `=` padding are ignored. Anything else → null. */
export function base32Decode(value: string): Uint8Array | null {
  const clean = value.replace(/[\s=]/g, '').toUpperCase();
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = BASE32.indexOf(ch);
    if (v === -1) return null;
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

/** A new secret, base32 (32 characters). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES)));
}

/** The 30-second step at `now`. */
export function totpStep(now: Date | number): number {
  return Math.floor((typeof now === 'number' ? now : now.getTime()) / 1000 / TOTP_PERIOD_SECONDS);
}

async function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new Uint8Array(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
}

async function codeWithKey(key: CryptoKey, step: number, digits: number): Promise<string> {
  const counter = new Uint8Array(8);
  const view = new DataView(counter.buffer);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code for `secret` (raw bytes) at `step`. */
export async function totpCode(secret: Uint8Array, step: number, digits = TOTP_DIGITS): Promise<string> {
  return codeWithKey(await hmacKey(secret), step, digits);
}

/** What the person typed, as 6 digits (spaces and dashes removed), or null. */
export function normaliseTotpInput(input: string): string | null {
  const digits = input.normalize('NFKC').replace(/[\s\-‐-―−]/g, '');
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits) ? digits : null;
}

export type TotpCandidate = { id: string; secret: Uint8Array; lastStep: number };

/**
 * `match`: the code is valid for a step after that authenticator's last used one.
 * `replay`: valid, but only for a step already used (just signed in, a double submit).
 * `none`: no authenticator produced it.
 */
export type TotpMatch = { kind: 'match'; id: string; step: number } | { kind: 'replay'; id: string } | { kind: 'none' };

export async function matchTotp(candidates: readonly TotpCandidate[], input: string, now: Date | number): Promise<TotpMatch> {
  const code = normaliseTotpInput(input) ?? '000000x';
  const current = totpStep(now);
  let match: TotpMatch = { kind: 'none' };
  for (const candidate of candidates) {
    const key = await hmacKey(candidate.secret);
    for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
      const step = current + d;
      const equal = constantTimeEqualStrings(await codeWithKey(key, step, TOTP_DIGITS), code);
      if (!equal) continue;
      if (step > candidate.lastStep) {
        if (match.kind !== 'match' || step > match.step) match = { kind: 'match', id: candidate.id, step };
      } else if (match.kind === 'none') {
        match = { kind: 'replay', id: candidate.id };
      }
    }
  }
  return match;
}

/**
 * The URI an authenticator app reads from the QR code (or opens from a link):
 * `otpauth://totp/<issuer>:<account>?secret=…&issuer=…`, every parameter explicit.
 */
export function otpauthUri(input: { issuer: string; account: string; secret: string }): string {
  const issuer = encodeURIComponent(input.issuer);
  const label = `${issuer}:${encodeURIComponent(input.account)}`;
  return `otpauth://totp/${label}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

/** The secret in groups of four, for typing it by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}
