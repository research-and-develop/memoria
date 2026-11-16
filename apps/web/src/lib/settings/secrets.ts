/**
 * The secrets saved in the studio's settings (plan p03, D3.17): the SMTP password, the Brevo key,
 * the SES secret key, the Microsoft client secret. AES-GCM under a key derived with HKDF from
 * `SETTINGS_ENCRYPTION_KEY` (both Workers; not the two-factor key, which stays on the app), stored
 * as `v1:` + base64url(IV ‖ ciphertext). The additional data names the field
 * (`mail.<provider>.<field>`), so a ciphertext moved to another field does not decrypt.
 *
 * A D1 export alone reveals no credential. Pure: Web Crypto, no env.
 */
import { fromBase64Url, toBase64Url } from '@/lib/auth/crypto';

const encoder = new TextEncoder();
const SALT = encoder.encode('memoria:settings:salt:v1');
const INFO = encoder.encode('memoria:settings:secret:v1');
const PREFIX = 'v1:';
const IV_BYTES = 12;

export type SettingsCipher = {
  encrypt(plain: string, aad: string): Promise<string>;
  /** null when the key, the field or the ciphertext does not match. */
  decrypt(stored: string, aad: string): Promise<string | null>;
};

export const mailSecretAad = (provider: string, field: string) => `mail.${provider}.${field}`;

/** A value that looks like a sealed secret (it may still not decrypt). */
export const isSealed = (value: unknown): value is string => typeof value === 'string' && value.startsWith(PREFIX) && value.length > PREFIX.length;

export async function settingsCipher(master: Uint8Array): Promise<SettingsCipher> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(master), 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return {
    async encrypt(plain, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, aes, encoder.encode(plain)));
      const out = new Uint8Array(IV_BYTES + sealed.length);
      out.set(iv);
      out.set(sealed, IV_BYTES);
      return PREFIX + toBase64Url(out);
    },
    async decrypt(stored, aad) {
      if (!isSealed(stored)) return null;
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
  };
}
