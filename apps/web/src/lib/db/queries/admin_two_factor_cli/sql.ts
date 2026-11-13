/**
 * The SQL of `npm run admin:mfa` (scripts/admin-mfa.ts, plan p02 → The CLI;
 * `password`: plan p02b).
 *
 * NO IMPORTS: the command runs under tsx, outside Next, and cannot load
 * `@repo/db/client` (server-only). It sends plain SQL to
 * `wrangler d1 execute DB --command`, which takes no parameters, so every
 * value is checked by shape before it is written into a statement: a 64-hex
 * id, a UUID, an ISO-8601 UTC timestamp, an email address, a password hash.
 * Anything else throws.
 *
 * Order matters where a command removes things (D2.13): what could grant a
 * new session goes first (setup codes, authenticators, recovery codes), then
 * challenges, then sessions, so a run that stops halfway leaves the safer state.
 */

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function checked(value: string, shape: RegExp, what: string): string {
  if (!shape.test(value)) throw new Error(`admin:mfa: not a valid ${what}: ${JSON.stringify(value)}`);
  return `'${value}'`;
}

/** After `parseEmailAddress` and lower-casing: no quote can reach the statement. */
const ACCOUNT_EMAIL = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{3,253}$/;
/** `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>` (lib/auth/password.ts). */
const PASSWORD_HASH = /^pbkdf2-sha256\$\d{4,6}\$[A-Za-z0-9+/=]{16,120}\$[A-Za-z0-9+/=]{16,120}$/;

export const hex64 = (value: string) => checked(value, HEX64, '64-hex id');
export const accountEmail = (value: string) => checked(value, ACCOUNT_EMAIL, 'email address');
export const passwordHash = (value: string) => checked(value, PASSWORD_HASH, 'password hash');
export const uuid = (value: string) => checked(value, UUID, 'UUID');
export const isoTime = (value: string) => checked(value, ISO, 'ISO-8601 UTC timestamp');

/** The lockout bucket and everything else the sign-in counts (lib/auth/secondFactor, app/api/admin/login). */
export const SIGN_IN_BUCKETS_LIKE = "'login:%'";
export const CODE_FAILURE_BUCKET = "'login:code:fail'";

/**
 * Store a new setup code, unless an authenticator exists. Then read it back,
 * so the command prints the code only if it was stored. Any older setup code
 * and any half-finished first sign-in ('enroll' challenge) go first.
 */
export function setupStatements(input: { setupCodeId: string; expiresAt: string }): string[] {
  const id = hex64(input.setupCodeId);
  return [
    'DELETE FROM admin_setup_codes',
    "DELETE FROM admin_mfa_challenges WHERE kind = 'enroll'",
    `INSERT INTO admin_setup_codes (id, expires_at) SELECT ${id}, ${isoTime(input.expiresAt)} WHERE NOT EXISTS (SELECT 1 FROM admin_authenticators)`,
    `SELECT count(*) AS stored FROM admin_setup_codes WHERE id = ${id}`,
  ];
}

/**
 * Remove every authenticator, recovery code, challenge and session (in that
 * order, after the setup codes), record it, then store a new setup code.
 */
export function resetStatements(input: { auditId: string; setupCodeId: string; expiresAt: string }): string[] {
  return [
    'DELETE FROM admin_setup_codes',
    'DELETE FROM admin_authenticators',
    'DELETE FROM admin_recovery_codes',
    'DELETE FROM admin_mfa_challenges',
    'DELETE FROM admin_sessions',
    `INSERT INTO audit_log (id, action, entity, summary) VALUES (${uuid(input.auditId)}, 'delete', 'two_factor', 'Two-factor reset from the command line')`,
    ...setupStatements(input).slice(2),
  ];
}

/** Clear the lockout and every sign-in rate-limit bucket. */
export function unlockStatements(): string[] {
  return [`DELETE FROM rate_limits WHERE bucket LIKE ${SIGN_IN_BUCKETS_LIKE}`];
}

/**
 * `password` (plan p02b, D2b.8): store a new password hash, set by the CLI
 * (`set_by = 'cli'`: the photographer is asked to choose their own). With an
 * email, the account is created or its email replaced; without one, only an
 * existing account changes. The developer wins: no check on the old hash. Then,
 * only if the account now holds the new hash: an audit row, every sign-in
 * challenge and session ended. The last SELECT reads the account back (no row =
 * there was no account and no email was given).
 */
export function passwordStatements(input: { email: string | null; passwordHash: string; auditId: string; now: string }): string[] {
  const hash = passwordHash(input.passwordHash);
  const now = isoTime(input.now);
  const holds = `EXISTS (SELECT 1 FROM admin_account WHERE id = 1 AND password_hash = ${hash})`;
  const save =
    input.email === null
      ? `UPDATE admin_account SET password_hash = ${hash}, set_by = 'cli', updated_at = ${now} WHERE id = 1`
      : `INSERT INTO admin_account (id, email, password_hash, set_by, updated_at) VALUES (1, ${accountEmail(input.email)}, ${hash}, 'cli', ${now}) ` +
        "ON CONFLICT (id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash, set_by = 'cli', updated_at = excluded.updated_at";
  return [
    save,
    `INSERT INTO audit_log (id, action, entity, entity_id, summary) SELECT ${uuid(input.auditId)}, 'update', 'admin_account', '1', 'Password set from the command line' WHERE ${holds}`,
    `DELETE FROM admin_mfa_challenges WHERE ${holds}`,
    `DELETE FROM admin_sessions WHERE ${holds}`,
    `SELECT email FROM admin_account WHERE id = 1 AND password_hash = ${hash}`,
  ];
}

/** What `list` shows, one SELECT per section (in this order). */
export function listStatements(input: { now: string; dayStart: string }): string[] {
  const now = isoTime(input.now);
  return [
    'SELECT label, created_at, last_used_at FROM admin_authenticators ORDER BY created_at LIMIT 20',
    'SELECT count(*) AS total, coalesce(sum(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END), 0) AS unused FROM admin_recovery_codes',
    `SELECT second_factor, user_agent, country, created_at, last_seen_at FROM admin_sessions WHERE expires_at > ${now} ORDER BY last_seen_at DESC LIMIT 20`,
    `SELECT max(expires_at) AS expires_at FROM admin_setup_codes WHERE expires_at > ${now}`,
    `SELECT coalesce(max(count), 0) AS failures FROM rate_limits WHERE bucket = ${CODE_FAILURE_BUCKET} AND window_start = ${isoTime(input.dayStart)}`,
    'SELECT email, set_by, updated_at FROM admin_account WHERE id = 1',
  ];
}
