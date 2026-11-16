import { describe, expect, it } from 'vitest';

import { nextRunAfter } from './backoff';

const T0 = new Date('2026-11-16T10:00:00.000Z');
const minutesAfter = (date: Date) => (date.getTime() - T0.getTime()) / 60_000;
const EMAIL = [1, 5, 30, 120, 480];

describe('nextRunAfter', () => {
  it.each([
    [1, 1],
    [2, 5],
    [3, 30],
    [4, 120],
    [5, 480],
    [6, 480], // the last step repeats
    [12, 480],
  ])('after attempt %i: %i minutes', (attempt, minutes) => {
    expect(minutesAfter(nextRunAfter(attempt, T0, EMAIL))).toBe(minutes);
  });

  it.each([
    ['a longer Retry-After wins', 1, 600, 10],
    ['a shorter Retry-After than the step is ignored', 3, 60, 30],
    ['Retry-After is capped at an hour', 1, 99_999, 60],
    ['zero or negative is ignored', 2, -5, 5],
  ])('%s', (_name, attempt, retryAfter, minutes) => {
    expect(minutesAfter(nextRunAfter(attempt, T0, EMAIL, retryAfter))).toBe(minutes);
  });
});
