'use client';

import { forwardRef } from 'react';

import { FormField, Input } from '@repo/ui/input';

/**
 * The one field of a code step. `digits`: a 6-digit authenticator code
 * (`one-time-code` autofill, numeric keypad, never `type=number`); otherwise a
 * free-text code (recovery or setup code: any case, spaces, dashes).
 */
export const CodeField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    hint?: string;
    value: string;
    onChange: (value: string) => void;
    digits: boolean;
    error?: string | null;
    autoFocus?: boolean;
  }
>(({ label, hint, value, onChange, digits, error, autoFocus }, ref) => (
  <FormField label={label} hint={hint} error={error ?? null}>
    {(ids) =>
      digits ? (
        <Input
          {...ids}
          ref={ref}
          name="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={7}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          className="font-mono tracking-widest"
        />
      ) : (
        <Input
          {...ids}
          ref={ref}
          name="code"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          className="font-mono"
        />
      )
    }
  </FormField>
));
CodeField.displayName = 'CodeField';

/** Digits only, at most 6 (a pasted "123 456" or "123-456" becomes "123456"). */
export function cleanDigits(value: string): string {
  return value.normalize('NFKC').replace(/\D/g, '').slice(0, 6);
}
