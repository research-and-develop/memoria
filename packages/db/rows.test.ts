import { describe, expect, it } from 'vitest';

import type { BatchResult } from '@repo/platform/ports';

import { batchRows, fromBool, readJson, readStringArray, toBool } from './rows';

describe('row helpers', () => {
  it.each([
    [null, []],
    ['', []],
    ['["a","b"]', ['a', 'b']],
    ['["a",1,null]', ['a']],
    ['{"a":1}', []],
    ['not json', []],
  ])('readStringArray(%j) -> %j', (input, expected) => {
    expect(readStringArray(input)).toEqual(expected);
  });

  it.each([
    ['{"a":1}', { a: 1 }],
    [null, { fallback: true }],
    ['{broken', { fallback: true }],
  ])('readJson(%j) -> %j', (input, expected) => {
    expect(readJson(input, { fallback: true })).toEqual(expected);
  });

  it.each([
    [1, true],
    [0, false],
    [true, true],
    [null, false],
    [undefined, false],
  ])('toBool(%j) -> %j', (input, expected) => {
    expect(toBool(input)).toBe(expected);
  });

  it('round-trips booleans and converts a batch result', () => {
    expect([fromBool(true), fromBool(false)]).toEqual([1, 0]);
    const result: BatchResult = { rows: [{ n: 1 }, { n: 2 }], changes: 0 };
    expect(batchRows(result,(row: { n: number }) => row.n * 10)).toEqual([10, 20]);
    expect(batchRows(undefined, (row: { n: number }) => row.n)).toEqual([]);
  });
});
