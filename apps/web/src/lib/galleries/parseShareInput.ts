import { parseEmailAddress } from '@repo/core/email';
import { isHeaderSafe } from '@repo/platform/mail/mime';

/**
 * The client email's input (plan p05 → Routes, D5.20): the address, an optional name (≤ 100
 * characters, nothing a header cannot carry: the job's recipient rules) and whether to include the
 * password. Pure.
 */
export type ShareEmailInput = { to: string; name: string | null; includePassword: boolean };

type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

export const CLIENT_NAME_MAX = 100;

export function parseClientName(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, field: 'name', message: 'Enter the client’s name as text.' };
  const name = value.trim();
  if (name === '') return { ok: true, value: null };
  if (name.length > CLIENT_NAME_MAX || !isHeaderSafe(name) || /[\p{Cc}\p{Cf}]/u.test(name)) {
    return { ok: false, field: 'name', message: `Enter a name of up to ${CLIENT_NAME_MAX} characters, on one line.` };
  }
  return { ok: true, value: name };
}

export function parseShareEmailInput(body: unknown): Parsed<ShareEmailInput> {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const to = parseEmailAddress(b.to);
  if (!to) return { ok: false, field: 'to', message: 'Enter the client’s email address.' };
  const name = parseClientName(b.name);
  if (!name.ok) return name;
  if (b.includePassword !== undefined && typeof b.includePassword !== 'boolean') {
    return { ok: false, field: 'includePassword', message: 'Choose whether to include the password.' };
  }
  return { ok: true, value: { to, name: name.value, includePassword: b.includePassword === true } };
}
