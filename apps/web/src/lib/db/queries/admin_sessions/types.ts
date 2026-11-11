/** Mirrors `admin_sessions`. `id` is the SHA-256 (hex) of the cookie token. */
export type AdminSessionRow = {
  id: string;
  password_version: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
};

export const ADMIN_SESSION_COLUMNS = 'id, password_version, user_agent, created_at, last_seen_at, expires_at';
