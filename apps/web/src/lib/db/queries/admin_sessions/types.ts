/** How a session's sign-in was completed. Must match ck_admin_sessions_second_factor (0003). */
export const SECOND_FACTORS = ['authenticator', 'recovery_code'] as const;
export type SecondFactor = (typeof SECOND_FACTORS)[number];

/** Mirrors `admin_sessions`. `id` is the SHA-256 (hex) of the cookie token. */
export type AdminSessionRow = {
  id: string;
  password_version: string;
  second_factor: SecondFactor;
  /** The app that signed in; may name an app removed since. null for a recovery code. */
  authenticator_id: string | null;
  user_agent: string;
  country: string | null;
  /** Sensitive settings need a code entered before this time; null after sign-in. */
  verified_until: string | null;
  code_failures: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
};

export type AdminSessionInput = {
  id: string;
  passwordVersion: string;
  secondFactor: SecondFactor;
  authenticatorId: string | null;
  userAgent: string;
  country: string | null;
  expiresAt: string;
};

export const ADMIN_SESSION_COLUMNS =
  'id, password_version, second_factor, authenticator_id, user_agent, country, verified_until, code_failures, created_at, last_seen_at, expires_at';
