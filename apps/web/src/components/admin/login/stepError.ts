import type { RequestError } from '@repo/ui/hooks/useApi';

/**
 * What a sign-in step does with a refused request (pure): stay and show the
 * message, or go back to the password (the challenge is gone) with the
 * message as a note there. The server writes every message (lib/auth/signInMessages).
 */
export type StepErrorOutcome = { kind: 'ignore' } | { kind: 'show'; message: string } | { kind: 'restart'; note: string };

const RESTART = new Set(['CHALLENGE_EXPIRED', 'ALREADY_ENROLLED']);

export function stepErrorOutcome(error: RequestError): StepErrorOutcome {
  if (error.errorCode === 'ABORT_ERROR') return { kind: 'ignore' };
  const message = typeof error.details?.message === 'string' ? error.details.message : 'Something went wrong. Please try again.';
  if (RESTART.has(error.errorCode) || error.details?.attemptsLeft === 0) return { kind: 'restart', note: message };
  return { kind: 'show', message };
}
