/** Mirrors `admin_setup_codes`. `id` is the SHA-256 (hex) of the normalised code. */
export type AdminSetupCodeRow = { id: string; created_at: string; expires_at: string };
