/** Deliberately simple: one @, no spaces, a dot in the domain. Delivery is the real check. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EMAIL_MAX = 254;

export function isEmail(value: string): boolean {
  return value.length <= EMAIL_MAX && EMAIL_RE.test(value);
}

/** Trimmed and lower-cased, as stored and compared. */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
