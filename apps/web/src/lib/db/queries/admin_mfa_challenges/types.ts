/** Must match ck_admin_mfa_challenges_kind (0003). */
export type ChallengeKind = 'login' | 'enroll' | 'add';

/** Ten minutes and five attempts per challenge (D2.4). */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** Mirrors `admin_mfa_challenges`. */
export type AdminMfaChallengeRow = {
  id: string;
  kind: ChallengeKind;
  password_version: string;
  session_id: string | null;
  setup_code_id: string | null;
  pending_secret_enc: string | null;
  attempts: number;
  user_agent: string;
  created_at: string;
  expires_at: string;
};

export const ADMIN_MFA_CHALLENGE_COLUMNS =
  'id, kind, password_version, session_id, setup_code_id, pending_secret_enc, attempts, user_agent, created_at, expires_at';

/**
 * "The challenge is still live" inside another table's write, params `[id, now]`.
 * A CLI reset (or a spent challenge) between the read and the write wins.
 */
export const liveChallengeSql = 'EXISTS (SELECT 1 FROM admin_mfa_challenges WHERE id = ? AND expires_at > ?)';
