import { statement, type Statement } from '@repo/db/client';

import { liveChallengeSql } from '../admin_mfa_challenges/types';

/**
 * Accept a code: move the authenticator's `last_step` forward, only if the
 * step is later than the last one used AND the challenge (or, for a confirm
 * code, nothing: pass `challengeId` null) is still live. The next statement in
 * the batch checks `changes() > 0`, so a code is used once, also under two
 * concurrent requests.
 */
export function useAuthenticatorStepStatement(input: { id: string; step: number; now: string; challengeId: string | null }): Statement {
  const base = 'UPDATE admin_authenticators SET last_step = ?, last_used_at = ? WHERE id = ? AND last_step < ?';
  const params = [input.step, input.now, input.id, input.step];
  if (input.challengeId === null) return statement(base, params);
  return statement(`${base} AND ${liveChallengeSql}`, [...params, input.challengeId, input.now]);
}

/**
 * The FIRST authenticator: inserted only when the statement before it (the
 * setup code's guarded delete) changed a row.
 */
export function insertFirstAuthenticatorStatement(input: { id: string; label: string; secretEnc: string; lastStep: number; now: string }): Statement {
  return statement('INSERT INTO admin_authenticators (id, label, secret_enc, last_step, last_used_at) SELECT ?, ?, ?, ?, ? WHERE changes() > 0', [
    input.id,
    input.label,
    input.secretEnc,
    input.lastStep,
    input.now,
  ]);
}

/** SQL that holds once `id`'s insert in the same batch succeeded (the "anchor"). */
export const authenticatorExistsSql = 'EXISTS (SELECT 1 FROM admin_authenticators WHERE id = ?)';
