import { describe, expect, it } from 'vitest';

import { clientCountry, ipPrefix, isSecureRequest } from './request';

const h = (values: Record<string, string>) => new Headers(values);

describe('clientCountry', () => {
  it.each([
    [{ 'cf-ipcountry': 'US' }, 'US'],
    [{ 'cf-ipcountry': ' BG ' }, 'BG'],
    [{ 'cf-ipcountry': 'XX' }, null],
    [{ 'cf-ipcountry': 'T1' }, null],
    [{ 'cf-ipcountry': 'us' }, null],
    [{ 'cf-ipcountry': 'USA' }, null],
    [{}, null],
  ])('%j → %j', (headers, expected) => {
    expect(clientCountry(h(headers))).toBe(expected);
  });
});

describe('isSecureRequest', () => {
  it.each([
    ['x-forwarded-proto https', { 'x-forwarded-proto': 'https' }, 'http://example.com/', true],
    ['x-forwarded-proto http beats an https URL', { 'x-forwarded-proto': 'http' }, 'https://example.com/', false],
    ['a list of protos: the first', { 'x-forwarded-proto': 'https, http' }, undefined, true],
    ['no header, https URL', {}, 'https://example.com/', true],
    ['no header, http URL', {}, 'http://example.com/', false],
    ['no header, no URL, a public host', { host: 'photos.example.com' }, undefined, true],
    ['no header, no URL, no host', {}, undefined, true],
    ['localhost with a port', { host: 'localhost:3210' }, undefined, false],
    ['127.0.0.1', { host: '127.0.0.1:8787' }, undefined, false],
    ['a LAN address', { host: '192.168.1.5:3210' }, undefined, false],
    ['10.x', { host: '10.0.0.2' }, undefined, false],
    ['172.20.x', { host: '172.20.1.1' }, undefined, false],
    ['172.40.x is public', { host: '172.40.1.1' }, undefined, true],
    ['IPv6 loopback', { host: '[::1]:3210' }, undefined, false],
  ])('%s', (_label, headers, url, expected) => {
    expect(isSecureRequest(h(headers), url)).toBe(expected);
  });
});

describe('ipPrefix (rate-limit keys: IPv4 /32, IPv6 /64)', () => {
  it.each([
    ['IPv4', '203.0.113.7', '203.0.113.7'],
    ['IPv4 with spaces', ' 203.0.113.7 ', '203.0.113.7'],
    ['IPv6 expanded', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', '2001:0db8:85a3:0000::/64'],
    ['IPv6 compressed', '2001:db8:85a3::8a2e:370:7334', '2001:0db8:85a3:0000::/64'],
    ['IPv6 upper case', '2001:DB8:85A3::1', '2001:0db8:85a3:0000::/64'],
    ['IPv6 short prefix', '2001:db8::1', '2001:0db8:0000:0000::/64'],
    ['IPv6 trailing ::', 'fe80::', 'fe80:0000:0000:0000::/64'],
    ['IPv6 loopback', '::1', '0000:0000:0000:0000::/64'],
    ['IPv6 with a zone', 'fe80::1%eth0', 'fe80:0000:0000:0000::/64'],
    ['IPv4-mapped', '::ffff:198.51.100.4', '198.51.100.4'],
    ['IPv4-mapped expanded', '0:0:0:0:0:ffff:198.51.100.4', '198.51.100.4'],
    ['garbage', 'not-an-ip', 'not-an-ip'],
    ['two ::', '1::2::3', '1::2::3'],
    ['too many groups', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9'],
  ])('%s: %s → %s', (_label, ip, expected) => {
    expect(ipPrefix(ip)).toBe(expected);
  });

  it('two addresses of one /64 share a prefix, two /64s do not', () => {
    expect(ipPrefix('2001:db8:1:2::a')).toBe(ipPrefix('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(ipPrefix('2001:db8:1:2::a')).not.toBe(ipPrefix('2001:db8:1:3::a'));
  });
});
