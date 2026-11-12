import { describe, expect, it } from 'vitest';

import { generateRecoveryCodes, normaliseRecoveryCode, RECOVERY_CODE_COUNT } from './recoveryCodes';
import { generateSetupCode, normaliseSetupCode, setupCodeId } from './setupCode';
import { authenticatorAad, pendingSecretAad, twoFactorKeys } from './twoFactorKeys';
import { defaultAuthenticatorLabel, describeUserAgent } from './userAgent';

const key = (fill: number) => new Uint8Array(32).fill(fill);

describe('recovery codes', () => {
  it('makes 10 distinct codes shaped xxxxx-xxxxx', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });

  it.each([
    ['abcde-fgh23', 'abcde-fgh23'],
    ['ABCDE-FGH23', 'abcde-fgh23'],
    ['abcdefgh23', 'abcde-fgh23'],
    [' abcde fgh23 ', 'abcde-fgh23'],
    ['abcde–fgh23', 'abcde-fgh23'],
    ['abcde—fgh23', 'abcde-fgh23'],
    ['ａｂｃｄｅ-fgh23', 'abcde-fgh23'],
    ['abcde-fgh2', null],
    ['abcde-fgh234', null],
    ['abcde-fgh18', null],
    ['', null],
  ])('normalises %j → %j', (input, expected) => {
    expect(normaliseRecoveryCode(input)).toBe(expected);
  });
});

describe('setup codes', () => {
  it('makes a 20-character code in groups of four that normalises to itself', () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^([A-Z2-7]{4}-){4}[A-Z2-7]{4}$/);
    expect(normaliseSetupCode(code)).toBe(code.replace(/-/g, ''));
    expect(generateSetupCode()).not.toBe(code);
  });

  it.each([
    ['abcd-efgh-ijkl-mnop-qrst', 'ABCDEFGHIJKLMNOPQRST'],
    ['ABCD EFGH IJKL MNOP QRST', 'ABCDEFGHIJKLMNOPQRST'],
    ['abcd–efgh–ijkl–mnop–qrst', 'ABCDEFGHIJKLMNOPQRST'],
    ['ABCDEFGHIJKLMNOPQRS', null],
    ['ABCDEFGHIJKLMNOPQRS1', null],
    ['', null],
  ])('normalises %j → %j', (input, expected) => {
    expect(normaliseSetupCode(input)).toBe(expected);
  });

  it('stores a 64-hex id that depends on the code', async () => {
    const a = await setupCodeId('ABCDEFGHIJKLMNOPQRST');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await setupCodeId('ABCDEFGHIJKLMNOPQRST')).toBe(a);
    expect(await setupCodeId('ABCDEFGHIJKLMNOPQRSU')).not.toBe(a);
  });
});

describe('twoFactorKeys', () => {
  it('round-trips a secret for its own row', async () => {
    const keys = await twoFactorKeys(key(1));
    const stored = await keys.encryptSecret('JBSWY3DPEHPK3PXP', authenticatorAad('a'));
    expect(stored).toMatch(/^v1:[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(await keys.decryptSecret(stored, authenticatorAad('a'))).toBe('JBSWY3DPEHPK3PXP');
    expect(await keys.encryptSecret('JBSWY3DPEHPK3PXP', authenticatorAad('a'))).not.toBe(stored);
  });

  it('refuses another key, another row, a tampered or unknown ciphertext', async () => {
    const keys = await twoFactorKeys(key(1));
    const stored = await keys.encryptSecret('JBSWY3DPEHPK3PXP', authenticatorAad('a'));
    expect(await (await twoFactorKeys(key(2))).decryptSecret(stored, authenticatorAad('a'))).toBeNull();
    expect(await keys.decryptSecret(stored, authenticatorAad('b'))).toBeNull();
    expect(await keys.decryptSecret(stored, pendingSecretAad('a'))).toBeNull();
    // A character in the middle (the last one may carry only padding bits).
    const swapped = stored[20] === 'A' ? 'B' : 'A';
    expect(await keys.decryptSecret(stored.slice(0, 20) + swapped + stored.slice(21), authenticatorAad('a'))).toBeNull();
    expect(await keys.decryptSecret(stored.replace('v1:', 'v2:'), authenticatorAad('a'))).toBeNull();
    expect(await keys.decryptSecret('v1:', authenticatorAad('a'))).toBeNull();
    expect(await keys.decryptSecret('v1:!!!', authenticatorAad('a'))).toBeNull();
  });

  it('derives a recovery-code id that depends on the key', async () => {
    const a = await (await twoFactorKeys(key(1))).recoveryCodeId('abcde-fgh23');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await twoFactorKeys(key(1))).recoveryCodeId('abcde-fgh23')).toBe(a);
    expect(await (await twoFactorKeys(key(2))).recoveryCodeId('abcde-fgh23')).not.toBe(a);
    expect(await (await twoFactorKeys(key(1))).recoveryCodeId('abcde-fgh24')).not.toBe(a);
  });
});

const UA = {
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('describeUserAgent', () => {
  it.each([
    [UA.macChrome, 'Chrome on macOS', 'Mac'],
    [UA.macSafari, 'Safari on macOS', 'Mac'],
    [UA.iphoneSafari, 'Safari on iPhone', 'iPhone'],
    [UA.iphoneChrome, 'Chrome on iPhone', 'iPhone'],
    [UA.ipadSafari, 'Safari on iPad', 'iPad'],
    [UA.androidChrome, 'Chrome on Android', 'Android phone'],
    [UA.androidSamsung, 'Samsung Internet on Android', 'Android phone'],
    [UA.windowsEdge, 'Edge on Windows', 'Windows PC'],
    [UA.windowsFirefox, 'Firefox on Windows', 'Windows PC'],
    [UA.linuxFirefox, 'Firefox on Linux', 'Linux computer'],
    [UA.chromeos, 'Chrome on ChromeOS', 'Chromebook'],
    [UA.opera, 'Opera on Windows', 'Windows PC'],
    ['curl/8.0', 'Unknown device', 'Authenticator app'],
    ['', 'Unknown device', 'Authenticator app'],
  ])('%s → %s, label %s', (ua, description, label) => {
    expect(describeUserAgent(ua)).toBe(description);
    expect(defaultAuthenticatorLabel(ua)).toBe(label);
  });

  it('handles a missing header', () => {
    expect(describeUserAgent(null)).toBe('Unknown device');
    expect(defaultAuthenticatorLabel(undefined)).toBe('Authenticator app');
  });
});
