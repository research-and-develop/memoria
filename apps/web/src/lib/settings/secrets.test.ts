import { describe, expect, it } from 'vitest';

import { isSealed, mailSecretAad, settingsCipher } from './secrets';

const key = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (i + seed) % 256);
const AAD = mailSecretAad('smtp', 'password');

describe('settingsCipher', () => {
  it('round-trips, with a fresh IV each time', async () => {
    const cipher = await settingsCipher(key(1));
    const a = await cipher.encrypt('app-password', AAD);
    const b = await cipher.encrypt('app-password', AAD);
    expect(a).toMatch(/^v1:[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('app-password');
    expect(await cipher.decrypt(a, AAD)).toBe('app-password');
    expect(isSealed(a)).toBe(true);
  });

  it.each([
    ['another key', async (sealed: string) => (await settingsCipher(key(2))).decrypt(sealed, AAD)],
    ['another field (AAD)', async (sealed: string) => (await settingsCipher(key(1))).decrypt(sealed, mailSecretAad('brevo', 'apiKey'))],
    ['a tampered ciphertext', async (sealed: string) => (await settingsCipher(key(1))).decrypt(`${sealed.slice(0, -2)}AA`, AAD)],
    ['no prefix', async (sealed: string) => (await settingsCipher(key(1))).decrypt(sealed.slice(3), AAD)],
    ['too short', async () => (await settingsCipher(key(1))).decrypt('v1:AAAA', AAD)],
  ])('%s → null', async (_label, attempt) => {
    const sealed = await (await settingsCipher(key(1))).encrypt('app-password', AAD);
    expect(await attempt(sealed)).toBeNull();
  });
});
