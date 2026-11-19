import { describe, expect, it } from 'vitest';

import { CURSOR_MAX, decodeCursor, encodeCursor, NAME_KEY_MAX, nameKey, sortKey, takenKey } from './sortKey';

const byName = (names: string[]) => [...names].sort((a, b) => (nameKey(a) < nameKey(b) ? -1 : nameKey(a) > nameKey(b) ? 1 : 0));

describe('nameKey', () => {
  it.each([
    [['IMG_10.jpg', 'IMG_9.jpg', 'IMG_100.jpg'], ['IMG_9.jpg', 'IMG_10.jpg', 'IMG_100.jpg']],
    [['a10', 'a2', 'a1'], ['a1', 'a2', 'a10']],
    [['B.jpg', 'a.jpg'], ['a.jpg', 'B.jpg']],
    [['é2.jpg', 'e1.jpg', 'f.jpg'], ['e1.jpg', 'é2.jpg', 'f.jpg']],
    [['Мария_2', 'Мария_10', 'Иван'], ['Иван', 'Мария_2', 'Мария_10']],
  ])('orders %j naturally', (input, expected) => {
    expect(byName(input)).toEqual(expected);
  });

  it('pads digit runs to 10 and caps at 120 characters after padding', () => {
    expect(nameKey('IMG_9.JPG')).toBe('img_0000000009.jpg');
    expect(nameKey('x'.repeat(255))).toHaveLength(NAME_KEY_MAX);
    expect(nameKey(Array.from({ length: 60 }, () => '1').join('-'))).toHaveLength(NAME_KEY_MAX);
  });
});

describe('sortKey and cursors', () => {
  const id = '9d070500-0000-4000-8000-000000000002';

  it('composes both orders; a missing capture time sorts last', () => {
    expect(sortKey('filename', 'a', takenKey(null), id)).toBe(`a|~|${id}`);
    expect(sortKey('taken', 'a', takenKey('2026-10-03T10:00:00'), id)).toBe(`2026-10-03T10:00:00|a|${id}`);
    expect('~' > '2099-12-31T23:59:59').toBe(true);
  });

  it('round-trips a cursor; the longest key (Cyrillic, 2 bytes a letter) fits under 700 characters', () => {
    const longest = sortKey('filename', 'я'.repeat(NAME_KEY_MAX), takenKey('2026-10-03T10:00:00'), id);
    const cursor = encodeCursor(longest);
    expect(cursor.length).toBeLessThanOrEqual(CURSOR_MAX);
    expect(decodeCursor(cursor)).toBe(longest);
  });

  it.each([
    ['empty', ''],
    ['with bad characters', 'a+b/c'],
    ['too long', 'a'.repeat(CURSOR_MAX + 1)],
    ['not UTF-8', '_w'],
  ])('refuses a cursor %s', (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});
