import { describe, expect, it } from 'vitest';

import { GATE_PASSWORD_MAX, parseGateInput } from './parseGateInput';

describe('parseGateInput', () => {
  it.each([
    ['a password and a token', { password: 'maple-river-42', turnstileToken: 't' }, { password: 'maple-river-42', turnstileToken: 't' }],
    ['spaces and a line break trimmed', { password: '  maple-river-42\n' }, { password: 'maple-river-42', turnstileToken: '' }],
    ['the longest accepted', { password: 'x'.repeat(GATE_PASSWORD_MAX) }, { password: 'x'.repeat(GATE_PASSWORD_MAX), turnstileToken: '' }],
  ])('accepts %s', (_label, body, value) => {
    expect(parseGateInput(body)).toEqual({ ok: true, value });
  });

  it.each([
    ['nothing', null],
    ['no password', {}],
    ['only spaces', { password: '   ' }],
    ['a number', { password: 42 }],
    ['too long', { password: 'x'.repeat(GATE_PASSWORD_MAX + 1) }],
  ])('refuses %s', (_label, body) => {
    expect(parseGateInput(body)).toEqual({ ok: false, field: 'password', message: 'Enter the gallery password.' });
  });
});
