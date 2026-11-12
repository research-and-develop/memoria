import { first, statement, type Options, type Statement } from '@repo/db/client';

import {
  ADMIN_AUTHENTICATOR_SUMMARY_COLUMNS,
  MAX_AUTHENTICATORS,
  type AdminAuthenticatorSummary,
} from './types';

/**
 * The security settings' writes on `admin_authenticators` (plan p02 → Writes
 * that must not race): add one more (capped at 10, only with a live 'add'
 * challenge of this session), rename, remove (never the last).
 */

export function getAdminAuthenticatorSummary(id: string, opts?: Options): Promise<AdminAuthenticatorSummary | null> {
  return first<AdminAuthenticatorSummary>(
    statement(`SELECT ${ADMIN_AUTHENTICATOR_SUMMARY_COLUMNS} FROM admin_authenticators WHERE id = ?`, [id]),
    opts,
  );
}

/** One more app: only under the cap, only while its 'add' challenge of this session is live. */
export function insertAuthenticatorStatement(input: {
  id: string;
  label: string;
  secretEnc: string;
  lastStep: number;
  now: string;
  challengeId: string;
  sessionId: string;
}): Statement {
  return statement(
    `INSERT INTO admin_authenticators (id, label, secret_enc, last_step, last_used_at)
     SELECT ?, ?, ?, ?, ?
      WHERE (SELECT count(*) FROM admin_authenticators) < ?
        AND EXISTS (SELECT 1 FROM admin_mfa_challenges WHERE id = ? AND kind = 'add' AND session_id = ? AND expires_at > ?)`,
    [input.id, input.label, input.secretEnc, input.lastStep, input.now, MAX_AUTHENTICATORS, input.challengeId, input.sessionId, input.now],
  );
}

export function renameAuthenticatorStatement(id: string, label: string): Statement {
  return statement('UPDATE admin_authenticators SET label = ? WHERE id = ?', [label, id]);
}

/** Remove one, never the last (the CLI is the way out of that). Its sessions go in the statement before. */
export function deleteAuthenticatorStatement(id: string): Statement {
  return statement('DELETE FROM admin_authenticators WHERE id = ? AND (SELECT count(*) FROM admin_authenticators) > 1', [id]);
}

export async function countAdminAuthenticators(opts?: Options): Promise<number> {
  return (await first<{ n: number }>(statement('SELECT count(*) AS n FROM admin_authenticators'), opts))?.n ?? 0;
}
