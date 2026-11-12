/**
 * The one-time setup code that allows enrolling the FIRST authenticator
 * (D2.2). `npm run admin:mfa -- setup` makes one and stores its SHA-256; the
 * sign-in page asks for it before showing a QR code. 20 base32 characters
 * (100 bits), valid for an hour. Pure: the CLI imports this file too.
 */
import { sha256Hex } from './crypto';
import { base32Encode } from './totp';

export const SETUP_CODE_TTL_MS = 60 * 60 * 1000;

/** A new code, `ABCD-EFGH-JKLM-NPQR-STUV` (the dashes are for reading; any grouping is accepted). */
export function generateSetupCode(): string {
  const chars = base32Encode(crypto.getRandomValues(new Uint8Array(13))).slice(0, 20);
  return chars.replace(/(.{4})(?=.)/g, '$1-');
}

/** What the person typed, as 20 upper-case characters, or null. */
export function normaliseSetupCode(input: string): string | null {
  const chars = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐-―−_.]/g, '');
  return /^[A-Z2-7]{20}$/.test(chars) ? chars : null;
}

/** The stored id: SHA-256 (hex) of the normalised code. */
export function setupCodeId(normalised: string): Promise<string> {
  return sha256Hex(`setup:${normalised}`);
}
