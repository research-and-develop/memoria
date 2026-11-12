/**
 * The keys that protect two-factor data at rest (D2.7), derived with HKDF from
 * the `TOTP_ENCRYPTION_KEY` secret (32 random bytes):
 *
 * - authenticator secrets: AES-GCM, stored as `v1:` + base64url(IV ‖ ciphertext).
 *   The additional data names the row (`authenticator:<id>`, `pending:<challenge id>`),
 *   so a ciphertext copied to another row does not decrypt.
 * - recovery codes: HMAC-SHA256 (hex) of the normalised code, the row id.
 *
 * A D1 export alone reveals nothing usable. Pure: Web Crypto, no env.
 */
import { fromBase64Url, toBase64Url, toHex } from './crypto';

const encoder = new TextEncoder();
const SALT = encoder.encode('memoria:totp:salt:v1');
const PREFIX = 'v1:';
const IV_BYTES = 12;

export type TwoFactorKeys = {
  encryptSecret(plain: string, aad: string): Promise<string>;
  /** null when the key, the row or the ciphertext does not match. */
  decryptSecret(stored: string, aad: string): Promise<string | null>;
  recoveryCodeId(normalisedCode: string): Promise<string>;
};

export const authenticatorAad = (id: string) => `authenticator:${id}`;
export const pendingSecretAad = (challengeId: string) => `pending:${challengeId}`;

export async function twoFactorKeys(master: Uint8Array): Promise<TwoFactorKeys> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(master), 'HKDF', false, ['deriveKey']);
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: encoder.encode(info) });
  const aes = await crypto.subtle.deriveKey(hkdf('memoria:totp:enc:v1'), base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const mac = await crypto.subtle.deriveKey(hkdf('memoria:totp:recovery:v1'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, [
    'sign',
  ]);

  return {
    async encryptSecret(plain, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, aes, encoder.encode(plain)),
      );
      const out = new Uint8Array(IV_BYTES + sealed.length);
      out.set(iv);
      out.set(sealed, IV_BYTES);
      return PREFIX + toBase64Url(out);
    },
    async decryptSecret(stored, aad) {
      if (!stored.startsWith(PREFIX)) return null;
      const bytes = fromBase64Url(stored.slice(PREFIX.length));
      if (!bytes || bytes.length <= IV_BYTES + 16) return null;
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(bytes.subarray(0, IV_BYTES)), additionalData: encoder.encode(aad) },
          aes,
          new Uint8Array(bytes.subarray(IV_BYTES)),
        );
        return new TextDecoder().decode(plain);
      } catch {
        return null;
      }
    },
    async recoveryCodeId(normalisedCode) {
      return toHex(await crypto.subtle.sign('HMAC', mac, encoder.encode(normalisedCode)));
    },
  };
}
