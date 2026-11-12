import { describe, expect, it } from 'vitest';

import { parseDevVars } from './media-probe';

describe('parseDevVars', () => {
  it.each([
    ['a value', 'A=1', { A: '1' }],
    ['comments and blank lines', '# c\n\nA=1\n  # B=2', { A: '1' }],
    ['CRLF line endings', 'A=1\r\nB=2\r\n', { A: '1', B: '2' }],
    ['an empty value', 'A=', { A: '' }],
    ['an equals sign in the value', 'H=pbkdf2$1$a==$b=', { H: 'pbkdf2$1$a==$b=' }],
    ['surrounding spaces', '  A = x y  ', { A: 'x y' }],
  ])('reads %s', (_label, text, expected) => {
    expect(parseDevVars(text)).toEqual(expected);
  });
});
