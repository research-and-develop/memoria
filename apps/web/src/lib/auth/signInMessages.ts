/**
 * What the sign-in steps say (plan p02 → Messages). Pure: the routes put the
 * text in `details.message`, the forms show it. One vocabulary: sign in,
 * authenticator app, code, recovery code, setup code.
 */
export const SIGN_IN_MESSAGES = {
  CODE_ALREADY_USED: 'That code was just used. Wait for the next one.',
  CHALLENGE_EXPIRED: 'This sign-in timed out. Enter your password again.',
  SIGN_IN_LOCKED: 'Sign-in is locked after too many wrong codes. It unlocks at midnight UTC, or the developer can unlock it.',
  TWO_FACTOR_SETUP_REQUIRED: 'Two-factor sign-in is not set up yet. Ask the developer for a setup code (npm run admin:mfa -- setup).',
  TWO_FACTOR_NOT_CONFIGURED: 'Two-factor sign-in is not configured on the server.',
  ALREADY_ENROLLED: 'Two-factor was just set up from another device. Sign in again.',
  BOTH_OR_NEITHER: 'Enter a code from your authenticator app or a recovery code.',
} as const;

const CLOCK_HINT = 'Check that your phone sets its date and time automatically.';

/** A wrong code (or setup code) with `attemptsLeft` tries left on this sign-in. */
export function codeInvalidMessage(attemptsLeft: number, what: 'code' | 'setup code' = 'code'): string {
  const first = `That ${what} did not work.`;
  if (attemptsLeft <= 0) return `${first} Enter your password again.`;
  const parts = [first, attemptsLeft === 1 ? '1 try left.' : `${attemptsLeft} tries left.`];
  if (what === 'code' && attemptsLeft <= 2) parts.push(CLOCK_HINT);
  if (attemptsLeft === 1) parts.push('Last try before you need to sign in again.');
  return parts.join(' ');
}

/** Too many tries in a short time. */
export function codeRateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many tries. Wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}
