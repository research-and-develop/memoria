/** Mirrors `admin_recovery_codes`. `id` is an HMAC (hex) of the normalised code. */
export type AdminRecoveryCodeRow = { id: string; created_at: string; acknowledged_at: string | null; used_at: string | null };

/** For the banner and the settings: how many are left, and whether the set was saved. */
export type RecoveryCodeStatus = { total: number; unused: number; acknowledged: boolean };
