import { first, statement, type Options, type Statement } from '@repo/db/client';

import { ADMIN_MFA_CHALLENGE_COLUMNS, type AdminMfaChallengeRow } from './types';

/** At most this many unfinished "add an app" setups per session. */
export const MAX_LIVE_ADD_CHALLENGES = 3;

/**
 * Start adding an app from the settings: sweep expired 'add' challenges, then
 * insert this one only while the session has fewer than 3 live ones.
 */
export function createAddChallengeStatements(input: {
  id: string;
  sessionId: string;
  passwordVersion: string;
  pendingSecretEnc: string;
  userAgent: string;
  now: string;
  expiresAt: string;
}): Statement[] {
  return [
    statement("DELETE FROM admin_mfa_challenges WHERE kind = 'add' AND expires_at <= ?", [input.now]),
    statement(
      `INSERT INTO admin_mfa_challenges (id, kind, password_version, session_id, pending_secret_enc, user_agent, expires_at)
       SELECT ?, 'add', ?, ?, ?, ?, ?
        WHERE (SELECT count(*) FROM admin_mfa_challenges WHERE session_id = ? AND kind = 'add' AND expires_at > ?) < ?`,
      [
        input.id,
        input.passwordVersion,
        input.sessionId,
        input.pendingSecretEnc,
        input.userAgent.slice(0, 300),
        input.expiresAt,
        input.sessionId,
        input.now,
        MAX_LIVE_ADD_CHALLENGES,
      ],
    ),
  ];
}

/** An 'add' challenge of THIS session that has not expired. */
export function getLiveAddChallenge(id: string, sessionId: string, now: string, opts?: Options): Promise<AdminMfaChallengeRow | null> {
  return first<AdminMfaChallengeRow>(
    statement(
      `SELECT ${ADMIN_MFA_CHALLENGE_COLUMNS} FROM admin_mfa_challenges WHERE id = ? AND kind = 'add' AND session_id = ? AND expires_at > ?`,
      [id, sessionId, now],
    ),
    opts,
  );
}

/** The 'add' challenge, once the authenticator anchored by `authenticatorId` exists. */
export function deleteChallengeAfterAuthenticatorStatement(id: string, authenticatorId: string): Statement {
  return statement('DELETE FROM admin_mfa_challenges WHERE id = ? AND EXISTS (SELECT 1 FROM admin_authenticators WHERE id = ?)', [
    id,
    authenticatorId,
  ]);
}

/** A session's unfinished setups, when it is signed out. */
export function deleteSessionChallengesStatement(sessionId: string): Statement {
  return statement('DELETE FROM admin_mfa_challenges WHERE session_id = ?', [sessionId]);
}

/** Every other session's unfinished setups ("sign out all other devices"). */
export function deleteOtherSessionsChallengesStatement(currentSessionId: string): Statement {
  return statement('DELETE FROM admin_mfa_challenges WHERE session_id IS NOT NULL AND session_id <> ?', [currentSessionId]);
}
