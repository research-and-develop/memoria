import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  groupSecret,
  matchTotp,
  normaliseTotpInput,
  otpauthUri,
  totpCode,
  totpStep,
} from './totp';

const encoder = new TextEncoder();
/** RFC 6238 Appendix B: the SHA-1 seed is the ASCII "12345678901234567890". */
const RFC_SECRET = encoder.encode('12345678901234567890');

describe('base32', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('RFC 4648 vector %j → %s', (plain, encoded) => {
    expect(base32Encode(encoder.encode(plain))).toBe(encoded);
    expect(new TextDecoder().decode(base32Decode(encoded) ?? undefined)).toBe(plain);
  });

  it('decodes ignoring case, spaces and padding; refuses other characters', () => {
    expect(base32Decode('mzxw 6ytb oi======')).toEqual(encoder.encode('foobar'));
    expect(base32Decode('MZXW1')).toBeNull();
    expect(base32Decode('MZ-XW')).toBeNull();
  });

  it('round-trips a generated secret of 20 bytes', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });
});

describe('totpCode (RFC 6238, SHA-1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T = %i → %s (8 digits), and its last 6 with 6 digits', async (seconds, expected) => {
    const step = totpStep(seconds * 1000);
    expect(await totpCode(RFC_SECRET, step, 8)).toBe(expected);
    expect(await totpCode(RFC_SECRET, step)).toBe(expected.slice(2));
  });
});

describe('normaliseTotpInput', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    [' 123–456 ', '123456'],
    ['１２３４５６', '123456'],
    ['12345', null],
    ['1234567', null],
    ['12a456', null],
    ['', null],
  ])('%j → %j', (input, expected) => {
    expect(normaliseTotpInput(input)).toBe(expected);
  });
});

describe('matchTotp', () => {
  const NOW = 1_800_000_000_000;
  const step = totpStep(NOW);
  const other = encoder.encode('another-secret-bytes');
  const candidates = (lastStep = 0) => [
    { id: 'a', secret: RFC_SECRET, lastStep },
    { id: 'b', secret: other, lastStep },
  ];

  it.each([
    ['the current step', 0],
    ['one step behind', -1],
    ['one step ahead', 1],
  ])('accepts %s', async (_label, drift) => {
    const code = await totpCode(RFC_SECRET, step + drift);
    expect(await matchTotp(candidates(), code, NOW)).toEqual({ kind: 'match', id: 'a', step: step + drift });
  });

  it.each([-2, 2])('refuses a drift of %i steps', async (drift) => {
    expect(await matchTotp(candidates(), await totpCode(RFC_SECRET, step + drift), NOW)).toEqual({ kind: 'none' });
  });

  it('matches the right one of two authenticators', async () => {
    expect(await matchTotp(candidates(), await totpCode(other, step), NOW)).toEqual({ kind: 'match', id: 'b', step });
  });

  it('reports a replay when the step is not after the last used one', async () => {
    const code = await totpCode(RFC_SECRET, step);
    expect(await matchTotp(candidates(step), code, NOW)).toEqual({ kind: 'replay', id: 'a' });
    expect(await matchTotp(candidates(step + 1), code, NOW)).toEqual({ kind: 'replay', id: 'a' });
    expect(await matchTotp(candidates(step - 1), code, NOW)).toEqual({ kind: 'match', id: 'a', step });
  });

  it.each(['', '12345', '1234567', 'abcdef'])('refuses malformed input %j', async (input) => {
    expect(await matchTotp(candidates(), input, NOW)).toEqual({ kind: 'none' });
  });

  it('accepts a pasted code with a space', async () => {
    const code = await totpCode(RFC_SECRET, step);
    expect(await matchTotp(candidates(), `${code.slice(0, 3)} ${code.slice(3)}`, NOW)).toMatchObject({ kind: 'match' });
  });

  it('with no authenticators matches nothing', async () => {
    expect(await matchTotp([], '123456', NOW)).toEqual({ kind: 'none' });
  });
});

describe('otpauthUri', () => {
  it('encodes the issuer and account and spells out every parameter', () => {
    expect(otpauthUri({ issuer: 'North Light & Co', account: 'me+admin@example.com', secret: 'JBSWY3DPEHPK3PXP' })).toBe(
      'otpauth://totp/North%20Light%20%26%20Co:me%2Badmin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=North%20Light%20%26%20Co&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('groups a secret in fours', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDE')).toBe('ABCD E');
  });
});
