/**
 * Recovery codes: 10 single-use codes, `xxxxx-xxxxx` in lower-case base32
 * (50 bits each), shown once. Pure. Only an HMAC of each normalised code is
 * stored (`twoFactorKeys.recoveryCodeId`).
 */
import { base32Encode } from './totp';

export const RECOVERY_CODE_COUNT = 10;
/** Below this many unused codes the dashboard warns (D2.8). */
export const RECOVERY_CODES_LOW = 3;

const DASHES = /[\s\-‐-―−_.]/g;

function oneCode(): string {
  const chars = base32Encode(crypto.getRandomValues(new Uint8Array(7))).toLowerCase().slice(0, 10);
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** `count` distinct new codes. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(oneCode());
  return [...codes];
}

/**
 * What the person typed, as `xxxxx-xxxxx`, or null. Accepts any case, spaces,
 * a missing dash or another dash character, full-width characters (NFKC).
 */
export function normaliseRecoveryCode(input: string): string | null {
  const chars = input.normalize('NFKC').toLowerCase().replace(DASHES, '');
  return /^[a-z2-7]{10}$/.test(chars) ? `${chars.slice(0, 5)}-${chars.slice(5)}` : null;
}
