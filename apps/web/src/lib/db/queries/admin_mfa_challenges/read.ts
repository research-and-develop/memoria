import { first, statement, type Options } from '@repo/db/client';

import { ADMIN_MFA_CHALLENGE_COLUMNS, type AdminMfaChallengeRow } from './types';

/** A challenge that has not expired at `now` (ISO). */
export function getLiveChallenge(id: string, now: string, opts?: Options): Promise<AdminMfaChallengeRow | null> {
  return first<AdminMfaChallengeRow>(
    statement(`SELECT ${ADMIN_MFA_CHALLENGE_COLUMNS} FROM admin_mfa_challenges WHERE id = ? AND expires_at > ?`, [id, now]),
    opts,
  );
}
