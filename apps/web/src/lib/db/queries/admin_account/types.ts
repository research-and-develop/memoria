/** Who chose the current password. Must match ck_admin_account_set_by (0004). */
export const ACCOUNT_SET_BY = ['studio', 'cli', 'env'] as const;
export type AccountSetBy = (typeof ACCOUNT_SET_BY)[number];

/** Mirrors `admin_account` (one row, id = 1). The email is lower-case, the hash trimmed. */
export type AdminAccountRow = {
  email: string;
  password_hash: string;
  set_by: AccountSetBy;
  updated_at: string;
};

export type AdminAccountInput = {
  email: string;
  passwordHash: string;
  setBy: AccountSetBy;
  /** The hash the current password was checked against: an existing row changes only while it still holds it. */
  expectedHash: string;
  /** ISO-8601 UTC. */
  now: string;
};

export const ADMIN_ACCOUNT_COLUMNS = 'email, password_hash, set_by, updated_at';
