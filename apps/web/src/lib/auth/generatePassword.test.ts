import { describe, expect, it } from 'vitest';

import { PASSWORD_ALPHABET, generatePassword } from './generatePassword';

/** A random source that replays `bytes`, cycling. */
function replay(bytes: number[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length] ?? 0);
}

describe('generatePassword', () => {
  it('makes four groups of six from the alphabet', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[a-zA-Z2-9]{6}(-[a-zA-Z2-9]{6}){3}$/);
    expect([...password.replace(/-/g, '')].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
  });

  it.each([
    ['0 maps to the first symbol', [0], 'a'],
    ['53 maps to the last symbol', [53], '9'],
    ['54 wraps to the first symbol', [54], 'a'],
  ])('%s', (_label, bytes, expected) => {
    expect(generatePassword(replay(bytes))[0]).toBe(expected);
  });

  it('draws again for a byte from the incomplete last block (no modulo bias)', () => {
    // 256 - 256 % 54 = 216: bytes 216..255 would favour the first 40 symbols.
    expect(generatePassword(replay([216, 255, 1]))).toBe('bbbbbb-bbbbbb-bbbbbb-bbbbbb');
  });
});
