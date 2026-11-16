/**
 * The addresses mail accepts: the rules live in `@repo/core/email` (Phase 2b) and are tested there.
 * ASCII only, nothing that could break a header or an SMTP command (CR, LF, `<`, `>`, quotes,
 * spaces) can pass.
 */
export { MAX_EMAIL_LENGTH, parseEmailAddress } from '@repo/core/email';

/** The domain of an address that already passed `parseEmailAddress` (lower-cased by it). */
export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}
