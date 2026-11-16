import { describe, expect, it } from 'vitest';

import { MAX_DETAIL_LENGTH, maskAddresses } from './mask';

describe('maskAddresses', () => {
  it.each([
    ['an address', '550 5.1.1 <client@example.org>: Recipient address rejected', {}, '550 5.1.1 *** Recipient address rejected'],
    ['the recipient, any case', 'mailbox CLIENT@Example.org unknown', { also: ['client@example.org'] }, 'mailbox *** unknown'],
    ['the username without @', '535 user studio-login failed', { also: ['studio-login'] }, '535 user *** failed'],
    ['a secret', 'bad key xkeysib-abc123 given', { also: ['xkeysib-abc123'] }, 'bad key *** given'],
    ['a bearer token', 'Authorization: Bearer eyJhbGci.x.y refused', {}, 'Authorization: Bearer *** refused'],
    ['CR/LF and bidi', 'line one\r\nline\u202E two', {}, 'line one line two'],
    ['short values are not masked (too broad)', 'ok at 25', { also: ['ok', ''] }, 'ok at 25'],
  ])('masks %s', (_label, text, opts, expected) => {
    expect(maskAddresses(text, opts)).toBe(expected);
  });

  it('caps the length', () => {
    expect(maskAddresses('x'.repeat(2000))).toHaveLength(MAX_DETAIL_LENGTH);
  });
});
