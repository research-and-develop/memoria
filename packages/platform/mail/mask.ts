/**
 * A provider's text made safe to show the admin (plan p03, D3.11): what an SMTP server or an API
 * said about a failed send, stored in `jobs.last_error` and never logged.
 *
 * - every `something@something` and each value in `also` (the recipient, the SMTP username, a key
 *   id, a secret) becomes `***`, case-insensitively;
 * - a `Bearer …` token becomes `Bearer ***`;
 * - control, line-separator and bidi characters become spaces (no CR/LF reaches a page or a log);
 * - whitespace collapses; the result is at most MAX_DETAIL_LENGTH characters.
 *
 * Pure, no dependencies.
 */
export const MAX_DETAIL_LENGTH = 500;

const ADDRESS_RE = /\S+@\S+/g;
const BEARER_RE = /\bBearer\s+\S+/gi;
// C0, DEL, C1, U+2028/2029, the bidi embeddings/overrides/isolates.
const UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function maskAddresses(text: string, opts: { also?: readonly (string | null | undefined)[] } = {}): string {
  let out = text;
  // Longest first, so a value that contains another is masked whole.
  const also = [...new Set((opts.also ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length >= 3))].sort((a, b) => b.length - a.length);
  for (const value of also) out = out.replace(new RegExp(escapeRegExp(value), 'gi'), '***');
  return out
    .replace(ADDRESS_RE, '***')
    .replace(BEARER_RE, 'Bearer ***')
    .replace(UNSAFE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL_LENGTH);
}
