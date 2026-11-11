import { describe, expect, it } from 'vitest';

import { parseInboxQuery } from './parseInboxQuery';

describe('parseInboxQuery', () => {
  it.each([
    ['', { page: 1, pageSize: 20 }],
    ['page=3', { page: 3, pageSize: 20 }],
    ['page=2&page_size=100', { page: 2, pageSize: 100 }],
  ])('%j -> %j', (query, expected) => {
    expect(parseInboxQuery(new URLSearchParams(query))).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['page_size=101', 'page_size'],
    ['page_size=0', 'page_size'],
  ])('refuses %j (%s)', (query, field) => {
    expect(parseInboxQuery(new URLSearchParams(query))).toMatchObject({ ok: false, field });
  });
});
