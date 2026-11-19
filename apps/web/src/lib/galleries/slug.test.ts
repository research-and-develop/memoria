import { describe, expect, it } from 'vitest';

import { isSlug, joinSlug, keepsSuffix, SLUG_BASE_MAX, slugBase, slugSuffix, suffixOf, SUFFIX_LENGTH } from './slug';

describe('slugBase', () => {
  it.each([
    ['Maria & Jonas', 'maria-jonas'],
    ['  Café Crème  ', 'cafe-creme'],
    ['Мария и Иван', 'mariya-i-ivan'],
    ['Щастие', 'shtastie'],
    ['Свадьба Ёлки', 'svadyba-yolki'],
    ['🎉🎉', 'gallery'],
    ['', 'gallery'],
    ['--Wedding--2026--', 'wedding-2026'],
  ])('%j → %j', (title, expected) => {
    expect(slugBase(title)).toBe(expected);
  });

  it('caps at 40 without a trailing hyphen', () => {
    const base = slugBase('word '.repeat(30));
    expect(base.length).toBeLessThanOrEqual(SLUG_BASE_MAX);
    expect(base.endsWith('-')).toBe(false);
  });
});

describe('slugs', () => {
  it('joins a base and a 10-character suffix into a valid slug, even at the longest', () => {
    const suffix = slugSuffix();
    expect(suffix).toMatch(new RegExp(`^[a-z2-9]{${SUFFIX_LENGTH}}$`));
    const slug = joinSlug(slugBase('x'.repeat(120)), suffix);
    expect(isSlug(slug)).toBe(true);
    expect(suffixOf(slug)).toBe(suffix);
    expect(keepsSuffix(joinSlug('new-name', suffix), suffix)).toBe(true);
    expect(keepsSuffix('new-name', suffix)).toBe(false);
  });

  it.each([
    ['ab', false],
    ['abc', true],
    ['-abc', false],
    ['abc-', false],
    ['ABC', false],
    ['a_b', false],
    ['a'.repeat(61), false],
  ])('isSlug(%j) = %s', (value, ok) => {
    expect(isSlug(value)).toBe(ok);
  });
});
