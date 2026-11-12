import { statement, type Statement } from '@repo/db/client';

/**
 * "Confirm with a code" (D2.9) and signing out other devices: the writes on
 * `admin_sessions` that the security settings make.
 */

/** Wrong confirm codes that end a session. */
export const MAX_CONFIRM_FAILURES = 5;

/**
 * Open the 5-minute window, only when the code's own write just before it in
 * the batch changed a row (a step moved forward, a recovery code was spent).
 */
export function openConfirmWindowStatement(id: string, verifiedUntil: string): Statement {
  return statement('UPDATE admin_sessions SET verified_until = ?, code_failures = 0 WHERE id = ? AND changes() > 0', [verifiedUntil, id]);
}

/** A wrong confirm code: count it, returning the new count (none once at the cap). */
export function countConfirmFailureStatement(id: string): Statement {
  return statement('UPDATE admin_sessions SET code_failures = code_failures + 1 WHERE id = ? AND code_failures < ? RETURNING code_failures', [
    id,
    MAX_CONFIRM_FAILURES,
  ]);
}

/** After the count: the fifth wrong code ends the session. */
export function deleteSessionAtFailureCapStatement(id: string): Statement {
  return statement('DELETE FROM admin_sessions WHERE id = ? AND code_failures >= ?', [id, MAX_CONFIRM_FAILURES]);
}

/** Every session but `currentId` ("sign out all other devices"). */
export function deleteOtherAdminSessionsStatement(currentId: string): Statement {
  return statement('DELETE FROM admin_sessions WHERE id <> ?', [currentId]);
}

/** The sessions a removed app signed in, but not `currentId`; only while another app remains (the removal's guard). */
export function deleteAuthenticatorSessionsStatement(authenticatorId: string, currentId: string): Statement {
  return statement(
    'DELETE FROM admin_sessions WHERE authenticator_id = ? AND id <> ? AND (SELECT count(*) FROM admin_authenticators) > 1',
    [authenticatorId, currentId],
  );
}

/** The sessions signed in with a recovery code, but not `currentId` (new codes replace the old ones). */
export function deleteRecoveryCodeSessionsStatement(currentId: string): Statement {
  return statement("DELETE FROM admin_sessions WHERE second_factor = 'recovery_code' AND id <> ?", [currentId]);
}
