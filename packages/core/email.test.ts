import { describe, expect, it } from 'vitest';

import { parseEmailAddress } from './email';

describe('parseEmailAddress', () => {
  it.each([
    ['owner@example.com', 'owner@example.com'],
    ['  first.last+tag@sub.example.co.uk ', 'first.last+tag@sub.example.co.uk'],
    ['Owner@Example.COM', 'Owner@example.com'],
    ['a_b-c@xn--bcher-kva.example', 'a_b-c@xn--bcher-kva.example'],
    ['x@example.xn--p1ai', 'x@example.xn--p1ai'],
    [`${'a'.repeat(64)}@example.com`, `${'a'.repeat(64)}@example.com`],
  ])('accepts %j', (input, expected) => {
    expect(parseEmailAddress(input)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['CR/LF', 'owner@example.com\r\nBcc: x@y.com'],
    ['angle brackets', '<owner@example.com>'],
    ['a space', 'own er@example.com'],
    ['a quote', '"owner"@example.com'],
    ['a percent', 'owner%x@example.com'],
    ['an exclamation mark', 'owner!@example.com'],
    ['non-ASCII', 'ownér@example.com'],
    ['two @', 'a@b@example.com'],
    ['no TLD', 'owner@localhost'],
    ['a numeric TLD', 'owner@127.0.0.1'],
    ['a leading dot', '.owner@example.com'],
    ['a trailing dot', 'owner.@example.com'],
    ['a double dot', 'own..er@example.com'],
    ['a label starting with -', 'owner@-example.com'],
    ['a label of 64', `owner@${'a'.repeat(64)}.com`],
    ['a local part of 65', `${'a'.repeat(65)}@example.com`],
    ['255 in all', `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(3)}.com`],
  ])('refuses %s', (_name, input) => {
    expect(parseEmailAddress(input)).toBeNull();
  });
});
