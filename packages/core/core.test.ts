import { describe, expect, it } from 'vitest';

import { AppError } from './error';
import { objectToUrlSearchParams } from './url';
import { isUuid } from './validation';

describe('objectToUrlSearchParams', () => {
  it.each([
    [{}, ''],
    [{ page: 2 }, '?page=2'],
    [{ status: ['a', 'b'] }, '?status=a&status=b'],
    [{ q: null, r: undefined, s: false }, '?s=false'],
    [{ q: 'a b&c' }, '?q=a+b%26c'],
  ])('%j -> %s', (input, expected) => {
    expect(objectToUrlSearchParams(input)).toBe(expected);
  });
});

describe('isUuid', () => {
  it.each([
    ['00000000-0000-4000-8000-000000000000', true],
    ['not-a-uuid', false],
    ['', false],
    [42, false],
    [null, false],
  ])('%j -> %s', (input, expected) => {
    expect(isUuid(input)).toBe(expected);
  });
});

describe('AppError', () => {
  it('is an Error that keeps its code and details', () => {
    const err = new AppError('Nope', 'CONFLICT', { field: 'name' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CONFLICT');
    expect(err.details).toEqual({ field: 'name' });
  });
});
