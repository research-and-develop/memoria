import { describe, expect, it } from 'vitest';

import { dateTimeLabel, todayInAppZone } from './dates';

describe('server dates', () => {
  it.each([
    ['2026-11-09T14:05:00.000Z', '9 Nov 2026, 14:05'],
    ['', ''],
    [null, ''],
    ['not a date', ''],
  ])('dateTimeLabel(%j) -> %j', (input, expected) => {
    expect(dateTimeLabel(input)).toBe(expected);
  });

  it('gives the calendar date in the app time zone', () => {
    expect(todayInAppZone(new Date('2026-11-09T23:59:59.000Z'))).toBe('2026-11-09');
  });
});
