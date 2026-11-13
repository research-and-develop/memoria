/**
 * Email addresses we accept: the sign-in account (Phase 2b), mail settings and
 * recipients (Phase 3). Deliberately narrower than RFC 5321: ASCII only (no
 * SMTPUTF8; an IDN domain is given as punycode), a local part of
 * `[A-Za-z0-9._+-]` without leading, trailing or double dots, domain labels of
 * `[A-Za-z0-9-]` not starting or ending with `-`, a top-level domain of two or
 * more letters (or `xn--…`). Nothing that could break a mail header (CR, LF,
 * `<`, `>`, quotes, spaces) can pass. Pure, no dependencies.
 */
export const MAX_EMAIL_LENGTH = 254;

const LOCAL_RE = /^[A-Za-z0-9+_-]+(?:\.[A-Za-z0-9+_-]+)*$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD_RE = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

/** The address trimmed with its domain lower-cased, or null when it is not one we accept. */
export function parseEmailAddress(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return null;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (local.length > 64 || !LOCAL_RE.test(local)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l)) || !TLD_RE.test(labels[labels.length - 1] ?? '')) return null;
  return `${local}@${domain}`;
}
