import { describe, expect, it } from 'vitest';

import { constantTimeEqualStrings, randomToken, sha256Hex } from './crypto';
import { hashPassword, parsePasswordHash, verifyPassword } from './password';

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', async () => {
    const stored = await hashPassword('a-long-generated-password-2026', 2_000);
    expect(stored).toMatch(/^pbkdf2-sha256\$2000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('a-long-generated-password-2026', stored)).toBe(true);
    expect(await verifyPassword('a-long-generated-password-2027', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    const a = await hashPassword('same', 1_000);
    const b = await hashPassword('same', 1_000);
    expect(a).not.toBe(b);
  });

  it.each([
    ['empty', ''],
    ['another scheme', 'bcrypt$10$abc$def'],
    ['too few iterations', 'pbkdf2-sha256$10$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(43) + '='],
    ['too many iterations', 'pbkdf2-sha256$200000$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(43) + '='],
    ['a short hash', 'pbkdf2-sha256$20000$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'],
    ['broken base64', 'pbkdf2-sha256$20000$!!!$!!!'],
  ])('a malformed stored hash (%s) never verifies', async (_label, stored) => {
    expect(parsePasswordHash(stored)).toBeNull();
    expect(await verifyPassword('anything', stored)).toBe(false);
  });
});

describe('crypto helpers', () => {
  it('makes 256-bit url-safe tokens and stable digests', async () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(constantTimeEqualStrings('a', 'a')).toBe(true);
    expect(constantTimeEqualStrings('a', 'ab')).toBe(false);
  });
});
