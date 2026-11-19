import { describe, expect, it } from 'vitest';

import * as client from './client';
import { statement } from './statement';

describe('statement', () => {
  it('is plain, frozen data', () => {
    const stmt = statement('SELECT ?', ['a']);
    expect(stmt).toEqual({ sql: 'SELECT ?', params: ['a'] });
    expect(Object.isFrozen(stmt) && Object.isFrozen(stmt.params)).toBe(true);
  });

  it('defaults to no parameters', () => {
    expect(statement('SELECT 1')).toEqual({ sql: 'SELECT 1', params: [] });
  });

  it.each([
    ['undefined', [undefined], /parameter 0 is undefined/],
    ['a boolean', ['ok', true], /parameter 1 is boolean/],
    ['an object', [{}], /parameter 0 is object/],
  ])('refuses %s', (_label, params, message) => {
    expect(() => statement('SELECT ?, ?', params as never)).toThrow(message);
  });

  it('is the same function @repo/db/client exports', () => {
    expect(client.statement).toBe(statement);
  });
});
