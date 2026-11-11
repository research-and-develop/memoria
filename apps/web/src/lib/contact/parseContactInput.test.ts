import { describe, expect, it } from 'vitest';

import { parseContactInput } from './parseContactInput';

const valid = { name: '  Ada   Lovelace ', email: ' Ada@Example.COM ', message: 'Hello!\r\nAre you open on Saturdays?', consent: true };

describe('parseContactInput', () => {
  it('normalises a valid message', () => {
    expect(parseContactInput(valid)).toEqual({
      ok: true,
      value: { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello!\nAre you open on Saturdays?' },
    });
  });

  it.each([
    ['name', { name: 'A' }, 'enter your name'],
    ['name', { name: 'x'.repeat(101) }, 'too long'],
    ['email', { email: '' }, 'enter your email'],
    ['email', { email: 'ada@' }, 'valid email'],
    ['email', { email: 'ada @example.com' }, 'valid email'],
    ['message', { message: ' ' }, 'write a message'],
    ['message', { message: 'x'.repeat(2001) }, 'too long'],
    ['consent', { consent: false }, 'consent'],
    ['consent', { consent: 'true' }, 'consent'],
  ] as const)('refuses a bad %s (%j)', (field, override, fragment) => {
    const result = parseContactInput({ ...valid, ...override });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]?.toLowerCase()).toContain(fragment);
  });

  it.each([null, 'text', 42, []])('treats %j as an empty form', (raw) => {
    const result = parseContactInput(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['consent', 'email', 'message', 'name']);
  });
});
