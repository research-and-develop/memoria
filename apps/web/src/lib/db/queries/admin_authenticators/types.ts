/** At most this many authenticator apps (D2.3). */
export const MAX_AUTHENTICATORS = 10;
export const AUTHENTICATOR_LABEL_MAX = 60;

/** Mirrors `admin_authenticators`. `secret_enc` never leaves the server. */
export type AdminAuthenticatorRow = {
  id: string;
  label: string;
  secret_enc: string;
  /** The last accepted 30-second step; a code must be for a later one. */
  last_step: number;
  created_at: string;
  last_used_at: string | null;
};

/** What a page may show: everything but the secret. */
export type AdminAuthenticatorSummary = Omit<AdminAuthenticatorRow, 'secret_enc' | 'last_step'>;

export const ADMIN_AUTHENTICATOR_COLUMNS = 'id, label, secret_enc, last_step, created_at, last_used_at';
export const ADMIN_AUTHENTICATOR_SUMMARY_COLUMNS = 'id, label, created_at, last_used_at';
