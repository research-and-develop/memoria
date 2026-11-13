import { describe, expect, it } from 'vitest';

import { newPasswordProblem, parseEmailChange, parsePasswordChange } from './parseAccountInput';

describe('newPasswordProblem', () => {
  it.each([
    ['12 characters', 'abcdefghijkl', null],
    ['128 characters', 'x'.repeat(128), null],
    ['11 characters', 'abcdefghijk', 'Use at least 12 characters.'],
    ['129 characters', 'x'.repeat(129), 'Use at most 128 characters.'],
    ['counted after NFKC (ﬁ is two letters)', 'ﬁﬁﬁﬁﬁﬁ', null],
    ['the email, any case and spaces', ' OWNER@example.com ', 'Your password cannot be your email address.'],
  ])('%s', (_name, password, expected) => {
    expect(newPasswordProblem(password, 'owner@example.com')).toBe(expected);
  });
});

describe('parseEmailChange', () => {
  it('lower-cases the email and needs the current password', () => {
    expect(parseEmailChange({ email: ' New@Example.COM ', currentPassword: 'x' })).toEqual({ ok: true, value: { email: 'new@example.com', currentPassword: 'x' } });
    expect(parseEmailChange({ email: 'nope', currentPassword: 'x' })).toMatchObject({ ok: false, field: 'email' });
    expect(parseEmailChange({ email: 'new@example.com' })).toMatchObject({ ok: false, field: 'currentPassword' });
    expect(parseEmailChange(null)).toMatchObject({ ok: false, field: 'email' });
  });
});

describe('parsePasswordChange', () => {
  it('needs both passwords and checks the new one', () => {
    expect(parsePasswordChange({ currentPassword: 'old', newPassword: 'a-long-new-password' }, 'owner@example.com')).toEqual({
      ok: true,
      value: { currentPassword: 'old', newPassword: 'a-long-new-password' },
    });
    expect(parsePasswordChange({ newPassword: 'a-long-new-password' }, 'owner@example.com')).toMatchObject({ field: 'currentPassword' });
    expect(parsePasswordChange({ currentPassword: 'old' }, 'owner@example.com')).toMatchObject({ field: 'newPassword' });
    expect(parsePasswordChange({ currentPassword: 'old', newPassword: 'short' }, 'owner@example.com')).toMatchObject({ field: 'newPassword' });
  });
});
