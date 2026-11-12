import { statement, type Statement } from '@repo/db/client';

/** Tests and fixtures; the CLI writes setup codes with its own SQL (admin_two_factor_cli). */
export function insertSetupCodeStatement(id: string, expiresAt: string): Statement {
  return statement('INSERT INTO admin_setup_codes (id, expires_at) VALUES (?, ?)', [id, expiresAt]);
}

/**
 * First enrolment, the batch's first statement: spend the setup code, only
 * while it is live, no authenticator exists, and the challenge that accepted
 * it is live. The authenticator insert after it checks `changes() > 0`.
 */
export function spendSetupCodeStatement(input: { setupCodeId: string; challengeId: string; now: string }): Statement {
  return statement(
    `DELETE FROM admin_setup_codes
      WHERE id = ? AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM admin_authenticators)
        AND EXISTS (SELECT 1 FROM admin_mfa_challenges WHERE id = ? AND expires_at > ? AND setup_code_id = ?)`,
    [input.setupCodeId, input.now, input.challengeId, input.now, input.setupCodeId],
  );
}

/** Every other setup code, once the first authenticator anchored by `authenticatorId` exists. */
export function deleteSetupCodesAfterStatement(authenticatorId: string): Statement {
  return statement('DELETE FROM admin_setup_codes WHERE EXISTS (SELECT 1 FROM admin_authenticators WHERE id = ?)', [authenticatorId]);
}
