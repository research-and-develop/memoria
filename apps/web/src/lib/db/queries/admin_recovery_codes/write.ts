import { statement, type Statement } from '@repo/db/client';

import { liveChallengeSql } from '../admin_mfa_challenges/types';

/** Spend a recovery code at sign-in: only an unused one, only while the challenge is live. */
export function useRecoveryCodeStatement(input: { id: string; now: string; challengeId: string | null }): Statement {
  const base = 'UPDATE admin_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL';
  if (input.challengeId === null) return statement(base, [input.now, input.id]);
  return statement(`${base} AND ${liveChallengeSql}`, [input.now, input.id, input.challengeId, input.now]);
}

/** The old set goes, once the authenticator anchored by `authenticatorId` exists (first enrolment). */
export function deleteRecoveryCodesAfterStatement(authenticatorId: string): Statement {
  return statement('DELETE FROM admin_recovery_codes WHERE EXISTS (SELECT 1 FROM admin_authenticators WHERE id = ?)', [authenticatorId]);
}

/** One code of a new set, once the authenticator anchored by `authenticatorId` exists. */
export function insertRecoveryCodeAfterStatement(id: string, authenticatorId: string): Statement {
  return statement('INSERT INTO admin_recovery_codes (id) SELECT ? WHERE EXISTS (SELECT 1 FROM admin_authenticators WHERE id = ?)', [
    id,
    authenticatorId,
  ]);
}

/** "I have saved these codes". */
export function acknowledgeRecoveryCodesStatement(now: string): Statement {
  return statement('UPDATE admin_recovery_codes SET acknowledged_at = ? WHERE acknowledged_at IS NULL', [now]);
}
