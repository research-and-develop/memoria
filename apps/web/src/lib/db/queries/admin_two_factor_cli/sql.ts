/**
 * The SQL of `npm run admin:mfa` (scripts/admin-mfa.ts, plan p02 → The CLI).
 *
 * NO IMPORTS: the command runs under tsx, outside Next, and cannot load
 * `@repo/db/client` (server-only). It sends plain SQL to
 * `wrangler d1 execute DB --command`, which takes no parameters, so every
 * value is checked by shape before it is written into a statement: a 64-hex
 * id, a UUID, an ISO-8601 UTC timestamp. Anything else throws.
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

export const hex64 = (value: string) => checked(value, HEX64, '64-hex id');
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

/** What `list` shows, one SELECT per section (in this order). */
export function listStatements(input: { now: string; dayStart: string }): string[] {
  const now = isoTime(input.now);
  return [
    'SELECT label, created_at, last_used_at FROM admin_authenticators ORDER BY created_at LIMIT 20',
    'SELECT count(*) AS total, coalesce(sum(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END), 0) AS unused FROM admin_recovery_codes',
    `SELECT second_factor, user_agent, country, created_at, last_seen_at FROM admin_sessions WHERE expires_at > ${now} ORDER BY last_seen_at DESC LIMIT 20`,
    `SELECT max(expires_at) AS expires_at FROM admin_setup_codes WHERE expires_at > ${now}`,
    `SELECT coalesce(max(count), 0) AS failures FROM rate_limits WHERE bucket = ${CODE_FAILURE_BUCKET} AND window_start = ${isoTime(input.dayStart)}`,
  ];
}
