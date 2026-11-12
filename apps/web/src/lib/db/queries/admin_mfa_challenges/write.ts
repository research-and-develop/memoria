import { first, statement, type Options, type Statement } from '@repo/db/client';

import { CHALLENGE_MAX_ATTEMPTS, type ChallengeKind } from './types';

/** A sign-in challenge ('login', or 'enroll' before its setup code). */
export function createSignInChallengeStatement(input: {
  id: string;
  kind: Extract<ChallengeKind, 'login' | 'enroll'>;
  passwordVersion: string;
  userAgent: string;
  expiresAt: string;
}): Statement {
  return statement('INSERT INTO admin_mfa_challenges (id, kind, password_version, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)', [
    input.id,
    input.kind,
    input.passwordVersion,
    input.userAgent.slice(0, 300),
    input.expiresAt,
  ]);
}

/**
 * Count one attempt, only while fewer than five were made and the challenge
 * is live. Returns the new count, or null: spent or gone.
 */
export async function countChallengeAttempt(id: string, now: string, opts?: Options): Promise<number | null> {
  const row = await first<{ attempts: number }>(
    statement('UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND expires_at > ? RETURNING attempts', [
      id,
      CHALLENGE_MAX_ATTEMPTS,
      now,
    ]),
    opts,
  );
  return row?.attempts ?? null;
}

/**
 * The setup code was right: remember it and the new app's secret on the
 * 'enroll' challenge, only if the code is still live (a CLI reset in between
 * wins) and no setup code was accepted for this challenge yet.
 */
export function acceptSetupCodeStatement(input: { challengeId: string; setupCodeId: string; pendingSecretEnc: string; now: string }): Statement {
  return statement(
    `UPDATE admin_mfa_challenges SET setup_code_id = ?, pending_secret_enc = ?
      WHERE id = ? AND kind = 'enroll' AND setup_code_id IS NULL AND expires_at > ?
        AND EXISTS (SELECT 1 FROM admin_setup_codes WHERE id = ? AND expires_at > ?)`,
    [input.setupCodeId, input.pendingSecretEnc, input.challengeId, input.now, input.setupCodeId, input.now],
  );
}

export function deleteChallengeStatement(id: string): Statement {
  return statement('DELETE FROM admin_mfa_challenges WHERE id = ?', [id]);
}

/** The challenge, once the session anchored by `sessionId` exists (the end of a sign-in batch). */
export function deleteChallengeAfterSessionStatement(id: string, sessionId: string): Statement {
  return statement('DELETE FROM admin_mfa_challenges WHERE id = ? AND EXISTS (SELECT 1 FROM admin_sessions WHERE id = ?)', [id, sessionId]);
}

/** Housekeeping, before a new challenge is inserted (cheap: indexed). */
export function deleteExpiredChallengesStatement(now: string): Statement {
  return statement('DELETE FROM admin_mfa_challenges WHERE expires_at <= ?', [now]);
}
