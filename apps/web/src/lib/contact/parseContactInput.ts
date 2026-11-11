import { isEmail, normalizeEmail } from '@/lib/validation/email';

/**
 * The contact form's input — pure, shared by the form (instant feedback) and
 * POST /api/contact (the real check). One definition, so the two never drift.
 */
export const CONTACT_LIMITS = { nameMin: 2, nameMax: 100, emailMax: 254, messageMin: 2, messageMax: 2000 } as const;

export type ContactInput = { name: string; email: string; message: string };
export type ContactField = keyof ContactInput | 'consent';

export type ParseContactResult = { ok: true; value: ContactInput } | { ok: false; errors: Partial<Record<ContactField, string>> };

/** Collapse runs of whitespace, trim; keep the message's line breaks (CRLF → LF). */
const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const multiLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');

export function parseContactInput(raw: unknown): ParseContactResult {
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: Partial<Record<ContactField, string>> = {};

  const name = oneLine(body.name);
  if (name.length < CONTACT_LIMITS.nameMin) errors.name = 'Please enter your name.';
  else if (name.length > CONTACT_LIMITS.nameMax) errors.name = `The name is too long (max ${CONTACT_LIMITS.nameMax} characters).`;

  const email = normalizeEmail(body.email);
  if (!email) errors.email = 'Please enter your email.';
  else if (!isEmail(email)) errors.email = 'Please enter a valid email.';

  const message = multiLine(body.message);
  if (message.length < CONTACT_LIMITS.messageMin) errors.message = 'Please write a message.';
  else if (message.length > CONTACT_LIMITS.messageMax) errors.message = `The message is too long (max ${CONTACT_LIMITS.messageMax} characters).`;

  if (body.consent !== true) errors.consent = 'We need your consent to store and answer your message.';

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, email, message } };
}
