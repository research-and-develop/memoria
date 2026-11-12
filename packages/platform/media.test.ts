import { describe, expect, it } from 'vitest';

import { contentDisposition, isBlobKey, isMediaType } from './media';

describe('isBlobKey', () => {
  it.each(['galleries/abc/def.jpg', 'branding/logo-dark.png', 'dev/probe-1.png', 'galleries/a_b/c.d.e', `dev/${'a'.repeat(508)}`])('accepts %s', (key) => {
    expect(isBlobKey(key)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['a prefix alone', 'galleries'],
    ['a trailing slash', 'galleries/'],
    ['an unknown prefix', 'exports/a.jpg'],
    ['a leading slash', '/galleries/a.jpg'],
    ['a double slash', 'galleries//a.jpg'],
    ['a dot segment', 'galleries/./a.jpg'],
    ['a dot-dot segment', 'galleries/../branding/a.jpg'],
    ['upper case', 'galleries/A.jpg'],
    ['a space', 'galleries/a b.jpg'],
    ['a percent', 'galleries/a%2e.jpg'],
    ['a backslash', 'galleries\\a.jpg'],
    ['a NUL byte', 'galleries/a\u0000.jpg'],
    ['513 characters', `dev/${'a'.repeat(509)}`],
    ['a number', 42],
  ])('rejects %s', (_label, key) => {
    expect(isBlobKey(key)).toBe(false);
  });
});

describe('isMediaType', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('allows %s', (type) => expect(isMediaType(type)).toBe(true));
  it.each(['text/html', 'image/svg+xml', 'application/xml', 'image/avif', 'IMAGE/PNG', 'image/png; charset=x', ''])('refuses %s', (type) =>
    expect(isMediaType(type)).toBe(false),
  );
});

describe('contentDisposition', () => {
  it.each([
    ['a plain name', 'IMG_2048.jpg', `attachment; filename="IMG_2048.jpg"; filename*=UTF-8''IMG_2048.jpg`],
    ['Unicode', 'Мария.jpg', `attachment; filename="_____.jpg"; filename*=UTF-8''%D0%9C%D0%B0%D1%80%D0%B8%D1%8F.jpg`],
    ['quotes and backslashes', 'a"b\\c.jpg', `attachment; filename="a_b_c.jpg"; filename*=UTF-8''a%22b_c.jpg`],
    ['slashes', '../../etc/passwd', `attachment; filename=".._.._etc_passwd"; filename*=UTF-8''.._.._etc_passwd`],
    ['header injection', 'a.jpg\r\nSet-Cookie: x=1', `attachment; filename="a.jpgSet-Cookie: x=1"; filename*=UTF-8''a.jpgSet-Cookie%3A%20x%3D1`],
    ['an empty name', '\r\n', `attachment; filename="download"; filename*=UTF-8''download`],
  ])('%s', (_label, name, expected) => {
    expect(contentDisposition(name)).toBe(expected);
  });

  it('caps the name at 150 characters', () => {
    const header = contentDisposition('a'.repeat(200));
    expect(header).toContain(`filename="${'a'.repeat(150)}"`);
    expect(header).not.toMatch(/[\r\n]/);
  });
});
