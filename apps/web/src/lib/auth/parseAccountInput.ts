import { parseEmailAddress } from '@repo/core/email';

/**
 * The Sign-in card's input (plan p02b, D2b.7). Pure: the form and the two
 * account routes share it.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

type Field = 'email' | 'currentPassword' | 'newPassword';
export type AccountParse<T> = { ok: true; value: T } | { ok: false; field: Field; message: string };

function record(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function currentPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : null;
}

/** A new password: 12–128 characters after NFKC (as `hashPassword` derives it), not the email. */
export function newPasswordProblem(password: string, email: string): string | null {
  const length = [...password.normalize('NFKC')].length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return 'Your password cannot be your email address.';
  return null;
}

export function parseEmailChange(body: unknown): AccountParse<{ email: string; currentPassword: string }> {
  const input = record(body);
  const email = parseEmailAddress(input.email);
  if (!email) return { ok: false, field: 'email', message: 'Enter a valid email address.' };
  const current = currentPassword(input.currentPassword);
  if (!current) return { ok: false, field: 'currentPassword', message: 'Enter your current password.' };
  return { ok: true, value: { email: email.toLowerCase(), currentPassword: current } };
}

export function parsePasswordChange(body: unknown, accountEmail: string): AccountParse<{ currentPassword: string; newPassword: string }> {
  const input = record(body);
  const current = currentPassword(input.currentPassword);
  if (!current) return { ok: false, field: 'currentPassword', message: 'Enter your current password.' };
  if (typeof input.newPassword !== 'string') return { ok: false, field: 'newPassword', message: 'Enter a new password.' };
  const problem = newPasswordProblem(input.newPassword, accountEmail);
  if (problem) return { ok: false, field: 'newPassword', message: problem };
  return { ok: true, value: { currentPassword: current, newPassword: input.newPassword } };
}
