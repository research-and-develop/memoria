import { describe, expect, it } from 'vitest';

import { clientCountry, isSecureRequest } from './request';

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
