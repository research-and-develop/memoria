---
title: "Phase 2: Admin shell and two-factor sign-in"
type: plan
status: done
updated: 2026-11-12
related: [plan_202611_mvp.md, plan_202611_p01_core_adapters.md, ../../architecture.md, ../../../AGENTS.md]
---

# Phase 2: Admin shell and two-factor sign-in

## Goal

The studio admin gets its real layout from the mockups, and signing in needs the password **and** a
6-digit code from an authenticator app (TOTP). The first authenticator is enrolled with a one-time
setup code printed by a command on the developer's machine; more can be added later; recovery codes
cover a lost phone; the same command resets everything when locked out.

**Done when:**

- Signing in takes the password (with Turnstile, as today), then a code from any registered
  authenticator or a one-time recovery code. No session exists before the second step succeeds.
- With no authenticator registered, sign-in needs a setup code from `npm run admin:mfa -- setup`
  (local or `--remote`), then a scan, a confirming code, and 10 recovery codes shown once.
- Settings → Security lists authenticators (add, rename, remove; never the last), recovery codes
  (regenerate) and live sessions (sign out one, or all others). Those actions need a code entered in
  the last 5 minutes.
- `npm run admin:mfa -- reset [--remote]` removes every authenticator, recovery code, challenge and
  session and prints a new setup code; `unlock` clears the sign-in lockout.
- Every admin page sits in the studio shell: the sidebar from `Main.dc.html` on desktop, a top bar
  with a slide-in menu below 1024 px. Screens that later phases build are listed and marked *Soon*.

- **Depends on:** Phase 1. **Unblocks:** Phases 4 and 5 (every admin screen sits in this shell).
- **Mockups:** `Main.dc.html` (sidebar, header), `Settings.dc.html` (settings layout, "Your sign-in").
- **Scope (feature IDs):** A1, A3 (TOTP only, several authenticators), A4.

## Starting point (verified 2026-11-12)

- Login: `app/api/admin/login/route.ts` (same-origin → parse → rate limit → Turnstile → email and
  password → `createSession`); `lib/auth/session.ts` (256-bit token, SHA-256 in `admin_sessions`,
  14-day sliding expiry refreshed at most hourly, `password_version` ends sessions on a password
  change); `requireAdmin` / `getAdminSession` gate API routes and pages, and read the cookie under
  both names (`__Host-memoria_admin`, `memoria_admin`) whatever the scheme; logout (`{ everywhere }`).
- **The session cookie's max-age is 14 days and is never re-issued**, so today a session ends 14 days
  after sign-in however active it is (the D1 expiry slides, the browser's does not). `requireAdmin`
  decides HTTPS with `isSecureRequest` (header, then URL); `getAdminSession` with `x-forwarded-proto`
  alone.
- No production D1 exists yet (`database_id` all zeros): `0002` has never reached a remote database.
  The developer's local D1 has applied `0002`.
- Admin UI: `app/admin/(panel)/layout.tsx` is a plain header with the app name and a sign-out button;
  `/admin` is a placeholder; `/admin/design` shows the tokens. `LoginForm` posts to the login API.
- `@repo/ui`: `Button`, `Input`, `FormField`, `Checkbox`, `Toggle`, `Segmented`, `Card`, `Pill`,
  typography. No dialog, drawer or icons. jsdom (components project) has `HTMLDialogElement` but no
  `showModal`/`close`.
- `useApi` sends a DELETE's body as a query string, and a new `execute()` aborts the previous one on
  the same hook.
- `@repo/db/client` imports `server-only`, so a `tsx` script cannot import a query module.
- Guard `admin-routes-require-admin`: `EXEMPT = /[\\/]admin[\\/](login|logout)[\\/]route\.ts$/` and a
  self-test that extracts one path segment.
- `audit_log.action` CHECK allows `create`, `update`, `delete`, `login`, `logout`.
- `login/route.test.ts` signs in through the route and reads the session cookie from step 1.
- **Verified by running it on a test D1** (2026-11-12): in a batch, `changes()` sees the previous
  statement; `INSERT … SELECT … WHERE changes() > 0`, `WHERE NOT EXISTS (same table)`,
  `WHERE (SELECT count(*) …) < 10` and `DELETE … AND (SELECT count(*) …) > 1` behave as the write
  table below needs; the CHECKs as written accept and refuse the right rows. `uqr@0.1.3` (MIT, no
  dependencies) exports `encode(text)` → `{ size, data: boolean[][] }`. `wrangler d1 execute DB
  --local` writes the same state `npm run dev` reads.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D2.1 | **TOTP is required.** No admin session exists without a second factor; the migration rebuilds `admin_sessions`, dropping the password-only sessions. | Index decision (A3). |
| D2.2 | **First enrolment needs a setup code** (user, 2026-11-12, after the security review). `npm run admin:mfa -- setup` makes a one-time code (20 base32 characters, 100 bits; SHA-256 stored, valid 1 hour) and prints it; `reset` does too. With no authenticator, sign-in goes password → setup code → scan → code. Without a live setup code the sign-in page says two-factor is not set up and names the command. | The password alone never grants the admin, also not right after a reset. |
| D2.3 | **Several authenticators** (user, 2026-11-12), each named; a code from any of them signs in. At most 10; the last cannot be removed (the CLI is the way out). | A backup device. |
| D2.4 | **The step between password and code is a D1 row** (`admin_mfa_challenges`) behind its own httpOnly cookie (random 256-bit token, SHA-256 as the row id, 10 minutes, 5 attempts). The session token is minted only after the code. | Counts attempts, single use; no session fixation, no half-signed-in session. |
| D2.5 | **Replay protection per authenticator**: the last accepted 30 s step is stored; a code is accepted only for a later step, enforced in the write. The code that confirms a new authenticator is recorded too, so it cannot sign in afterwards. | Two concurrent requests with one code create one session. |
| D2.6 | TOTP: **RFC 6238, SHA-1, 6 digits, 30 s, ±1 step**, `crypto.subtle`. Secrets: 20 random bytes, base32. Every authenticator and step is checked (no early exit), codes compared in constant time. | Every authenticator app supports it. |
| D2.7 | **Secrets encrypted at rest**: AES-GCM under keys derived by HKDF (fixed salt, `info` `memoria:totp:enc:v1` and `memoria:totp:recovery:v1`) from a new secret `TOTP_ENCRYPTION_KEY` (32 random bytes, base64). Ciphertext `v1:` + base64url(12-byte IV ‖ ciphertext); **AAD = purpose + row id** (`authenticator:<id>`, `pending:<challenge id>`), so a ciphertext cannot be moved to another row. Recovery codes: HMAC-SHA256 under the second key. If no stored secret decrypts, sign-in answers 503 `TWO_FACTOR_NOT_CONFIGURED` and logs `admin_totp_key_mismatch`. Rotating or losing the key = CLI reset. | A D1 export or backup alone reveals nothing usable. |
| D2.8 | **10 recovery codes**, `xxxxx-xxxxx` (base32, 50 bits), shown once at enrolment and on regeneration (which replaces the set), single use, accepted wherever a code is. Unacknowledged or ≤ 3 left → a banner on the dashboard and Security. | Standard; the banner covers a closed tab. |
| D2.9 | **Confirm with a code** (a 5-minute window on the session, `admin_sessions.verified_until`, **NULL after sign-in**): adding, renaming and removing an authenticator, regenerating recovery codes, and signing out *other* sessions. The API answers `403 SECOND_FACTOR_REQUIRED`; the UI asks for a code (or a recovery code) and retries. Five wrong codes on one session end that session. Signing out the current session and "sign out everywhere" need no code. | A stolen cookie cannot plant an authenticator, hide one under a familiar name, or sign the owner out while staying in. |
| D2.10 | **No "remember this device"** (user, 2026-11-12). Sessions: 14 days idle and **at most 90 days after sign-in** (user, 2026-11-12), then a code again. The cookie is set once with max-age 90 days; the server enforces both limits (`expires_at` = the earlier of last activity + 14 days and sign-in + 90 days). | A stolen cookie does not live for ever; fixes today's cookie that ends every session at 14 days. |
| D2.11 | **Lockout**: 20 failed codes in a UTC day lock sign-in for the rest of that day. Failures that count: a wrong sign-in code or recovery code, a wrong setup code, a wrong confirm code (D2.9); not a wrong code for a *new* app being enrolled (that only uses the challenge's attempts), and not a replayed code. Checked (`count >= 20`) at step 1 right after the password rate limit (before the password is verified, so it reveals nothing) and at the start of `login/setup`, `login/verify` and `second-factor`. Logged on every refusal; audited once, when a failure reaches the limit. `admin:mfa -- unlock` clears it. | Every guess needs the password, but a leaked password must not allow unlimited tries. |
| D2.12 | **Removing an authenticator ends the sessions it signed in** (except the current one); **regenerating recovery codes ends the sessions signed in with a recovery code** (except the current one); a CLI reset ends all. | "My phone was stolen" actually locks the phone out. |
| D2.13 | **CLI** (user, 2026-11-12): `npm run admin:mfa -- <list\|setup\|reset\|unlock\|key> [--remote] [--yes]` from the repo root, local by default, through `wrangler d1 execute DB --file <temp.sql>`. `--remote` shows what it will do and asks to type the command name (unless `--yes`), and refuses while `database_id` is all zeros. Statements are ordered so a partial failure leaves the safer state: what grants a new session goes first (setup codes, authenticators, recovery codes), then challenges, then sessions. | The developer is in charge; anyone who can run it already controls the account. |
| D2.14 | **QR in the browser** from the `otpauth://` URI (`uqr@0.1.3` `encode()` → `<svg>` of `<rect>`s in theme colours), loaded only on enrolment screens, **plus** an *Open in authenticator app* link (the same URI, for enrolling on the phone that shows it) and the secret as grouped text with Copy. | No Worker CPU, no `dangerouslySetInnerHTML`; works on one phone. |
| D2.15 | **Sidebar = one registry** (`components/admin/nav.ts`). Items for later phases are shown, not linked, labelled *Soon* (user, 2026-11-12). **Store & orders and Clients never appear** (no sales features; clients are seen per gallery). | The full shape of the app without dead links. |
| D2.16 | **Mobile** (user, 2026-11-12): below `lg` (1024 px) a top bar with the studio name and a Menu button opening the navigation in a native `<dialog>` drawer. | No library; same items as desktop. |
| D2.17 | **Settings shell**: `/admin/settings/<section>` with a section list from a registry (same *Soon* rule). Phase 2 builds **Security**; Branding, Watermarks and Emails are listed for Phase 4; the design-system page is linked from it. The mockup's Domain, Storage, Backups, Store, Team, Integrations and Privacy sections are out of scope and not listed. | Phase 4 adds sections without touching the shell. |
| D2.18 | The header's search box, notification bell, nav count badges and the sidebar storage meter (mockup) wait for the phases with something to show (5, 8, 11) or are out of scope (storage). `PageHeader` has an `actions` slot. | No dead controls. |
| D2.19 | On HTTPS **only the `__Host-` cookie names are read** (session and challenge); the plain names only on plain http. One helper decides the scheme for routes and pages alike: `isSecureRequest(headers, url?)` in `lib/security/request.ts` → `x-forwarded-proto` when present, else the URL's scheme when known, else https unless the host is `localhost`, `127.0.0.1` or a private IPv4 address. `requireAdmin`, `getAdminSession` and the login page use it. | Stops cookie tossing from a sibling subdomain without locking out a page that lacks the header. |
| D2.20 | **A replayed code is not a failure**: a code whose step was already used (just signed in, double submit) answers `CODE_ALREADY_USED` ("That code was just used. Wait for the next one."), counts the challenge attempt, but not the lockout or the session's confirm failures. | Typing the sign-in code again in Security seconds later must not count against the owner. |

## Design

### Data: `migrations/0003_admin_two_factor.sql`

Rebuilding `admin_sessions` is allowed: the migration has never reached a remote D1 (AGENTS.md →
Migrations). CI applies migrations before deploying: between the two, the old code's session insert
fails the new `NOT NULL` column and sign-in answers 500 (fails closed; minutes, and no production
exists yet).

```sql
-- Password-only sessions end: from now on a session exists only after a second factor.
DROP TABLE admin_sessions;
CREATE TABLE admin_sessions (
  id               TEXT NOT NULL,
  password_version TEXT NOT NULL,
  second_factor    TEXT NOT NULL,                -- 'authenticator' | 'recovery_code'
  authenticator_id TEXT,                         -- which app signed in; no FK: kept after the app is removed
  user_agent       TEXT NOT NULL DEFAULT '',
  country          TEXT,                         -- CF-IPCountry at sign-in when it is two letters A–Z
  verified_until   TEXT,                         -- D2.9; NULL after sign-in
  code_failures    INTEGER NOT NULL DEFAULT 0,   -- D2.9: wrong confirm codes; 5 end the session
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at       TEXT NOT NULL,
  CONSTRAINT pk_admin_sessions PRIMARY KEY (id),
  CONSTRAINT ck_admin_sessions_id CHECK (length(id) = 64),
  CONSTRAINT ck_admin_sessions_second_factor CHECK (second_factor IN ('authenticator', 'recovery_code')),
  CONSTRAINT ck_admin_sessions_authenticator CHECK ((second_factor = 'authenticator') = (authenticator_id IS NOT NULL)),
  CONSTRAINT ck_admin_sessions_user_agent CHECK (length(user_agent) <= 300),
  CONSTRAINT ck_admin_sessions_country CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]'),
  CONSTRAINT ck_admin_sessions_code_failures CHECK (code_failures BETWEEN 0 AND 5)
);
CREATE INDEX ix_admin_sessions_expires_at ON admin_sessions (expires_at);

CREATE TABLE admin_authenticators (
  id           TEXT NOT NULL,                    -- crypto.randomUUID()
  label        TEXT NOT NULL,
  secret_enc   TEXT NOT NULL,                    -- D2.7, AAD 'authenticator:<id>'
  last_step    INTEGER NOT NULL,                 -- D2.5: the last accepted 30 s step
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  CONSTRAINT pk_admin_authenticators PRIMARY KEY (id),
  CONSTRAINT ck_admin_authenticators_label CHECK (length(label) BETWEEN 1 AND 60),
  CONSTRAINT ck_admin_authenticators_secret CHECK (secret_enc LIKE 'v1:%'),
  CONSTRAINT ck_admin_authenticators_last_step CHECK (last_step >= 0)
);

CREATE TABLE admin_recovery_codes (
  id              TEXT NOT NULL,                 -- HMAC-SHA256 (hex) of the normalised code
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  acknowledged_at TEXT,                          -- "I have saved these codes" (D2.8 banner)
  used_at         TEXT,
  CONSTRAINT pk_admin_recovery_codes PRIMARY KEY (id),
  CONSTRAINT ck_admin_recovery_codes_id CHECK (length(id) = 64)
);

CREATE TABLE admin_setup_codes (
  id         TEXT NOT NULL,                      -- SHA-256 (hex) of the normalised setup code
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  CONSTRAINT pk_admin_setup_codes PRIMARY KEY (id),
  CONSTRAINT ck_admin_setup_codes_id CHECK (length(id) = 64)
);

CREATE TABLE admin_mfa_challenges (
  id                 TEXT NOT NULL,              -- SHA-256 of the cookie token ('login', 'enroll') or a UUID ('add')
  kind               TEXT NOT NULL,              -- 'login' | 'enroll' (sign-in) | 'add' (settings)
  password_version   TEXT NOT NULL,
  session_id         TEXT,                       -- 'add': the session that started it
  setup_code_id      TEXT,                       -- 'enroll': the setup code accepted for it
  pending_secret_enc TEXT,                       -- 'enroll' (after the setup code) and 'add'; AAD 'pending:<id>'
  attempts           INTEGER NOT NULL DEFAULT 0,
  user_agent         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at         TEXT NOT NULL,
  CONSTRAINT pk_admin_mfa_challenges PRIMARY KEY (id),
  CONSTRAINT ck_admin_mfa_challenges_kind CHECK (kind IN ('login', 'enroll', 'add')),
  CONSTRAINT ck_admin_mfa_challenges_session CHECK ((kind = 'add') = (session_id IS NOT NULL)),
  CONSTRAINT ck_admin_mfa_challenges_setup CHECK (kind = 'enroll' OR setup_code_id IS NULL),
  CONSTRAINT ck_admin_mfa_challenges_secret CHECK (CASE kind
    WHEN 'login' THEN pending_secret_enc IS NULL
    WHEN 'add' THEN pending_secret_enc IS NOT NULL
    ELSE (setup_code_id IS NULL) = (pending_secret_enc IS NULL) END),
  CONSTRAINT ck_admin_mfa_challenges_attempts CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT ck_admin_mfa_challenges_user_agent CHECK (length(user_agent) <= 300)
);
CREATE INDEX ix_admin_mfa_challenges_expires_at ON admin_mfa_challenges (expires_at);
CREATE INDEX ix_admin_mfa_challenges_session_id ON admin_mfa_challenges (session_id);
```

Query modules (AGENTS.md → Data rules; reference `admin_sessions`): `admin_authenticators`,
`admin_recovery_codes`, `admin_setup_codes`, `admin_mfa_challenges`; `admin_sessions` extended
(`createAdminSessionStatement` takes the new fields, the row type and columns grow). The tables stay
tiny (≤ 10 authenticators, ≤ 10 codes, a few challenges and sessions).

The CLI's SQL lives in `src/lib/db/queries/admin_two_factor_cli/sql.ts`: **no imports** (a `tsx`
script cannot load `@repo/db/client`), plain strings and pure builders that accept only checked values
(a 64-hex id, an ISO timestamp), with a test that every statement is parameter-free and that the
builders refuse anything else.

### Writes that must not race

"Anchor on the new row's id": a fresh UUID exists only if its own insert succeeded, so later
statements use `WHERE EXISTS (SELECT 1 FROM t WHERE id = ?)` instead of a long `changes()` chain.
"Live challenge" = `EXISTS (SELECT 1 FROM admin_mfa_challenges WHERE id = ? AND expires_at > ?)`, so a
CLI reset between the read and the write wins.

| Write | Batch | Guarantee |
| --- | --- | --- |
| Sign in with a code | `UPDATE admin_authenticators SET last_step = ?, last_used_at = ? WHERE id = ? AND last_step < ? AND <live challenge>` → `INSERT INTO admin_sessions … SELECT … WHERE changes() > 0` → audit, challenge delete `WHERE EXISTS (new session)` | a step is used once |
| Sign in with a recovery code | `UPDATE admin_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND <live challenge>` → session `WHERE changes() > 0` → audit, challenge delete as above | a code is used once |
| Accept a setup code | `UPDATE admin_mfa_challenges SET setup_code_id = ?, pending_secret_enc = ? WHERE id = ? AND kind = 'enroll' AND setup_code_id IS NULL AND expires_at > ? AND EXISTS (live setup code)` | the QR appears only after a valid setup code |
| First enrolment | `DELETE FROM admin_setup_codes WHERE id = ? AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM admin_authenticators) AND EXISTS (live challenge WHERE setup_code_id = this id)` → `INSERT INTO admin_authenticators (…, last_step) SELECT …, ? WHERE changes() > 0` → `DELETE FROM admin_recovery_codes WHERE EXISTS (new id)` → 10 recovery inserts, session, audit ×2, challenge delete, all `WHERE EXISTS (new id)` | one setup code, one first authenticator; the setup code is spent only together with the enrolment. A batch with no effect is re-read: an authenticator exists → 409 `ALREADY_ENROLLED`, else 401 `CHALLENGE_EXPIRED` |
| Start adding one | `DELETE FROM admin_mfa_challenges WHERE kind = 'add' AND expires_at <= ?` → `INSERT INTO admin_mfa_challenges … SELECT … WHERE (SELECT count(*) FROM admin_mfa_challenges WHERE session_id = ? AND kind = 'add' AND expires_at > ?) < 3` | at most 3 live per session (409 `AUTHENTICATOR_LIMIT`) |
| Add an authenticator | `INSERT … SELECT … WHERE (SELECT count(*) FROM admin_authenticators) < 10 AND <live 'add' challenge of this session>` → audit, challenge delete `WHERE EXISTS (new id)` | the cap holds; the confirming step is stored |
| Remove an authenticator | `DELETE FROM admin_sessions WHERE authenticator_id = ? AND id <> ? AND (SELECT count(*) FROM admin_authenticators) > 1` → `DELETE FROM admin_authenticators WHERE id = ? AND (SELECT count(*) FROM admin_authenticators) > 1` → audit `WHERE changes() > 0` | never the last (409 `LAST_AUTHENTICATOR`; a missing id is 404, read first); its sessions end |
| Regenerate recovery codes | `DELETE FROM admin_recovery_codes` → 10 inserts → `DELETE FROM admin_sessions WHERE second_factor = 'recovery_code' AND id <> ?` → audit | all or nothing |
| Sign out a session | `DELETE FROM admin_mfa_challenges WHERE session_id = ?` → `DELETE FROM admin_sessions WHERE id = ?` (likewise for "others" and "everywhere") | no orphaned 'add' rows |
| Count an attempt | `UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < 5 AND expires_at > ?` | `changes = 0` → spent: delete it, 401 `CHALLENGE_EXPIRED` |
| Confirm with a code | step update as in sign-in → `UPDATE admin_sessions SET verified_until = ?, code_failures = 0 WHERE id = ? AND changes() > 0`; a wrong code: `UPDATE … SET code_failures = code_failures + 1 WHERE id = ? AND code_failures < 5`, then `DELETE … WHERE id = ? AND code_failures >= 5` | five wrong codes end the session |

### Sign-in flow

```
/admin/login (server page, force-dynamic, no-store) ─ reads the challenge cookie ─┬─ none, expired ─► step 1: LoginForm
                                                                                  ├─ login  ─► CodeForm
                                                                                  ├─ enroll, no setup code yet ─► SetupCodeForm
                                                                                  └─ enroll, setup code accepted ─► EnrollForm

POST /api/admin/login         same-origin → parse → rate limit → lockout (D2.11) → Turnstile → email + password
                              → 503 TWO_FACTOR_NOT_CONFIGURED without a usable key
                              → authenticators exist: challenge 'login'
                                none: a live setup code exists → challenge 'enroll'; else 503 TWO_FACTOR_SETUP_REQUIRED
                              → batch: delete expired challenges, insert the challenge → challenge cookie
                              → { data: { next: 'code' | 'setup' } }; the client refreshes the page
POST /api/admin/login/setup   { setupCode }: same-origin → challenge 'enroll' → lockout → code buckets → count the attempt
                              → accept (table above), new secret → { data: { next: 'enroll' } }
POST /api/admin/login/verify  { code } | { recoveryCode } | enrol: { code, label }   (exactly one kind of code)
                              same-origin → challenge cookie → live challenge, kind 'login' or 'enroll' (with a
                              setup code), password_version current → lockout → code buckets → count the attempt → verify
                              → the batches above → session cookie; challenge cookie cleared
                              → { data: { expiresAt, recoveryCodes? (enrol), recoveryCodesLeft? (recovery sign-in) } }
DELETE /api/admin/login       "Start over": same-origin, delete the challenge, clear its cookie
```

- Challenge cookie: `__Host-memoria_admin_mfa` over HTTPS, `memoria_admin_mfa` on plain http (D2.19),
  httpOnly, `SameSite=Lax`, path `/`, max-age 600.
- Kind `login` with no authenticator left (a CLI reset in between), or a stale `password_version`:
  delete the challenge, 401 `CHALLENGE_EXPIRED`. Kind `enroll` with an authenticator already present
  (set up from another device): delete it, 409 `ALREADY_ENROLLED` (built 2026-11-12: clearer than
  "timed out"; a first enrolment therefore deletes only its own challenge).
- An `enroll` challenge's 5 attempts are shared by the setup code and the new app's first code. A
  `recoveryCode` on an `enroll` challenge is 400 `INVALID_PARAMS`.
- Responses of every sign-in and security route carry `Cache-Control: no-store`; their pages are
  `dynamic = 'force-dynamic'`.
- `next` survives the steps; only `/admin…` paths are honoured.
- `country`: `clientCountry(req)` in `lib/security/request.ts` → `CF-IPCountry` if `/^[A-Z]{2}$/` and
  not `XX`/`T1`, else null.

### Rate limits

| Bucket | Limit | Counts |
| --- | --- | --- |
| `login:ip:<key>`, `login:global` | 10 / 15 min, 60 / hour (unchanged) | password attempts |
| per challenge | 5 attempts, 10 minutes | setup-code and code attempts on one challenge |
| `login:code:ip:<key>` | 10 / 15 min | every second-factor attempt per IP (sign-in, setup code, confirm) |
| `login:code:global` | 60 / hour | the same, overall |
| `login:code:fail` | 20 / UTC day | the **failures** listed in D2.11; at 20 (`isOverLimit`: `count >= limit`) sign-in is locked |
| per session | 5 wrong confirm codes | ends the session (D2.9) |

`hitRateLimits` counts; the lockout check needs a read-only `isOverLimit(rule)` beside it.

### Settings → Security (`/admin/settings/security`)

Server page (`force-dynamic`, reads through query modules) with client islands; mutations are admin
API routes (`requireAdmin` first). "Confirm" = D2.9.

| Section | Shows | Actions |
| --- | --- | --- |
| Authenticator apps | label, added, last used (`@repo/ui/date`) | **Add** (confirm) → `POST /api/admin/authenticators/enrollments` → `{ enrollmentId, secret, otpauthUri }` (10 min; at most 3 live per session) → QR, *Open in authenticator app*, secret, name (default from the user agent: "iPhone", "Mac") and its code → `POST /api/admin/authenticators { enrollmentId, label, code }`. **Rename** (confirm) inline → `PATCH /api/admin/authenticators/[id] { label }`. **Remove** (confirm) after "Remove iPhone? Codes from it stop working, and devices signed in with it are signed out." → `DELETE /api/admin/authenticators/[id]`; disabled with "You need at least one" on the last |
| Recovery codes | "7 of 10 unused"; warning at ≤ 3, urgent at 0 | **Generate new codes** (confirm) after "Your 7 unused codes stop working." → `POST /api/admin/recovery-codes` → `RecoveryCodesPanel`; **I have saved these codes** → `POST /api/admin/recovery-codes/acknowledge` |
| Sessions | "This device" first (a text pill); device ("Chrome on macOS"), country when known, signed in (with which app, "a removed app", or a recovery code), last active | **Sign out** this device (no confirm; warns it ends this page; clears the cookie) → `DELETE /api/admin/sessions/[id]`; **Sign out** another (confirm); **Sign out all other devices** (confirm) → `POST /api/admin/sessions/sign-out-others`; empty: "No other devices are signed in." |
| Password | "To change your password, see the deployment guide." Commands in a `<details>`: `npm run admin:hash-password`, `wrangler secret put ADMIN_PASSWORD_HASH`; changing it signs out every device | — |

`POST /api/admin/second-factor { code } | { recoveryCode }` opens the window (D2.9). A route that needs
it checks it after `requireAdmin` and before any write. Session ids are the 64-hex row ids, validated
before SQL. On phones the lists are cards; every action is a 44 px target.

### Sign-in UI

All steps share the login card (`/admin/login`, one `<h1>` per step: "Sign in", "Enter your code",
"Set up two-factor", "Save your recovery codes"). After a step change, focus moves to the new `<h1>`.

- **CodeForm**: one input, `autoComplete="one-time-code"`, `inputMode="numeric"`, `pattern="[0-9]*"`,
  `maxLength={7}`, never `type=number`; spaces and dashes stripped (paste of "123 456"); submits at 6
  digits and keeps the button; one request at a time (button disabled while loading). On an error the
  field keeps its value, focus and selection. Hint: "Codes change every 30 seconds." Links: *Use a
  recovery code* (switches the field: `autoComplete="off"`, accepts case, spaces and a missing dash)
  and *Start over* (`DELETE /api/admin/login`; returns to step 1 even if the call fails).
- **SetupCodeForm**: "Enter the setup code printed by `npm run admin:mfa -- setup`." Same input rules.
- **EnrollForm**: "On this phone? Tap *Open in authenticator app*. On a computer? Scan the code." QR,
  the link, the secret in groups of four with Copy (select-all text as a fallback), name field
  (default from the user agent), code field. A wrong code keeps the QR, secret and name.
- **RecoveryCodesPanel**: the 10 codes as selectable monospace text; **Copy** (primary), **Download**
  (`memoria-recovery-codes-YYYY-MM-DD.txt`); "Shown once. Without these codes and without your phone,
  only the developer can get you back in." Continue stays disabled (with the reason) until **I have
  saved these codes**; `beforeunload` asks before leaving while unticked.
- After a recovery-code sign-in with ≤ 3 left, the dashboard banner (D2.8) points to Security.

**Messages** (one vocabulary: *sign in*, *sign out*, *authenticator app*, *code*, *recovery code*,
*setup code*; sentence case):

| Code | Message |
| --- | --- |
| `CODE_INVALID` | "That code did not work. {n} tries left." + (n ≤ 2) "Check that your phone sets its date and time automatically." / (n = 1) "Last try before you need to sign in again." |
| `CODE_ALREADY_USED` | "That code was just used. Wait for the next one." |
| `CHALLENGE_EXPIRED` | "This sign-in timed out. Enter your password again." (step 1, email kept) |
| `RATE_LIMITED` (codes) | "Too many tries. Wait {m} minutes." |
| `SIGN_IN_LOCKED` | "Sign-in is locked after too many wrong codes. It unlocks at midnight UTC, or the developer can unlock it." |
| `TWO_FACTOR_SETUP_REQUIRED` | "Two-factor sign-in is not set up yet. Ask the developer for a setup code (`npm run admin:mfa -- setup`)." |
| `TWO_FACTOR_NOT_CONFIGURED` | "Two-factor sign-in is not configured on the server." |
| `ALREADY_ENROLLED` | "Two-factor was just set up from another device. Sign in again." |
| `SECOND_FACTOR_REQUIRED` | (the dialog) "Enter a code to continue. You will not be asked again for 5 minutes." |

### The studio shell

```
components/admin/
  nav.ts           registry: { id, label, href, icon, soonPhase? }   (pure; tested)
  icons.tsx        the mockup's inline SVG icons (no icon library)
  AdminShell.tsx   server: skip link → <main id="content" tabIndex={-1}>, Sidebar (lg+), MobileBar (<lg)
  Sidebar.tsx      server: logo mark + studio name, New gallery, NavList, footer (Sign out, 44 px)
  NavList.tsx      client: usePathname → aria-current="page"; Soon items are <span>s
  MobileBar.tsx    client: top bar + Dialog drawer (same Sidebar content)
  PageHeader.tsx   the page's <h1>, description, actions slot
  RecoveryCodesBanner.tsx   D2.8, on the dashboard and Security
  settings/nav.ts  the settings section registry (D2.17)
```

| Item | Href | Phase 2 |
| --- | --- | --- |
| New gallery | `/admin/galleries/new` | Soon (5) |
| Dashboard | `/admin` | built (content: Phase 11) |
| Galleries | `/admin/galleries` | Soon (5) |
| Selections | `/admin/selections` | Soon (8) |
| Insights | `/admin/insights` | Soon (11) |
| Settings | `/admin/settings` → `/admin/settings/security` | built |

- Look: `Main.dc.html` (220 px sidebar on `surface`, `line` border; items 44 px, radius `control`, text
  `ink-2`, active `accent-tint` / `accent-ink` semibold; New gallery the `dark` button). The sidebar
  is fixed at 220 px (the mockup's lets it grow).
- **Soon items**: label in `ink-muted` (AA; `ink-faint` is for disabled decoration only), a `draft`
  `Pill` "Soon" with `aria-hidden`, and `<span class="sr-only">, not available yet</span>`; not
  focusable, no hover. The New gallery button while Soon: a non-interactive block in the same shape,
  `wash` fill, `ink-muted` text, the pill: never a dark button that looks tappable.
- **Drawer** (`Dialog` primitive, drawer variant): Menu button with `aria-expanded`/`aria-controls`
  (44 px); `showModal()` (focus trap, Esc, inert page); first focus on the close button (44 px); closes
  on a backdrop click, on navigation (`usePathname`) and when the viewport reaches `lg`; locks body
  scroll while open; focus returns to Menu; the slide respects `prefers-reduced-motion`. One `<nav
  aria-label="Studio">` per layout (the desktop one is `display: none` below `lg`).
- **Settings section list**: `<nav aria-label="Settings">` of links with `aria-current` (the mockup's
  tablist would be wrong for routes); below `lg` a horizontal scroll row above the content.
- `nav.test.ts`: every built item's `href` has a `page.tsx` under `app/admin/(panel)`; every Soon item
  has none (so a phase that ships a screen must drop the flag); ids unique; no store or clients item;
  the same for `settings/nav.ts`.

### Modules

```
apps/web/src/lib/auth/
  totp.ts              PURE: base32, generateSecret, totpCode, matchTotp(all secrets, code, now, lastSteps), otpauthUri
  recoveryCodes.ts     PURE: generate, normalise (NFKC, case, spaces, dash variants)
  setupCode.ts         PURE: normalise, sha256 id (the CLI generates with node:crypto)
  twoFactorKeys.ts     HKDF → { encryptSecret(plain, aad), decryptSecret(enc, aad), recoveryCodeId(code) }
  challenge.ts         server-only: create, read from the cookie, count, spend; challengeCookie()
  secondFactor.ts      server-only: verify a code / recovery code / setup code → the batches above
  userAgent.ts         PURE: describeUserAgent(ua) → "Chrome on macOS"; defaultAuthenticatorLabel(ua)
  session.ts           createSession({ …, secondFactor, authenticatorId, country }); cookie max-age 90 days;
                       expires_at = min(last activity + 14 d, sign-in + 90 d); verified_until
  requireAdmin.ts      D2.19 cookie names; requireRecentSecondFactor(ctx)
apps/web/src/lib/security/request.ts   + clientCountry(req); isSecureRequest(headers, url?) shared by routes and pages (D2.19)
apps/web/src/lib/security/rateLimit.ts + isOverLimit(rule)
scripts/admin-mfa.ts   the CLI (D2.13); root script "admin:mfa"
packages/ui/dialog.tsx Dialog on <dialog> (modal and drawer variants)
apps/web/src/components/admin/  shell (above); login/{CodeForm,SetupCodeForm,EnrollForm}; QrCode;
                                RecoveryCodesPanel; CodeDialog; security/*
```

- `Config.admin.totpKey: Uint8Array | null`: `TOTP_ENCRYPTION_KEY` base64 of exactly 32 bytes (decoded
  with `atob` inside a try), else null. Server-only like every secret in `Config`; `AppConfig` never
  carries it (`appConfig.test.ts` gets the key in its secrets list). `.dev.vars.example` gets a fixed
  local key; the developer copies the line into `.dev.vars`.
- `vitest.setup.components.ts` gains a `<dialog>` polyfill (`showModal`/`show` set `open`, `close`
  removes it and dispatches `close`); focus trapping and Esc are checked by hand (Verification 5).
- `uqr@0.1.3` (exact) in the root `package.json`, imported only by `QrCode` (loaded with
  `next/dynamic` on the enrolment screens).
- `otpauth://totp/<issuer>:<email>?secret=…&issuer=<issuer>&algorithm=SHA1&digits=6&period=30`,
  issuer = `appName`, both percent-encoded.

### Errors

| Case | Status | `errorCode` |
| --- | --- | --- |
| No usable `TOTP_ENCRYPTION_KEY`, or no stored secret decrypts | 503 | `TWO_FACTOR_NOT_CONFIGURED` |
| No authenticator and no live setup code | 503 | `TWO_FACTOR_SETUP_REQUIRED` |
| Locked (D2.11) | 429 | `SIGN_IN_LOCKED` |
| No, expired, spent or stale challenge | 401 | `CHALLENGE_EXPIRED` |
| Wrong or malformed code or setup code | 401 | `CODE_INVALID` (`details.attemptsLeft`) |
| A code whose step was already used (D2.20) | 401 | `CODE_ALREADY_USED` (`details.attemptsLeft`) |
| Both a code and a recovery code, or neither | 400 | `INVALID_PARAMS` |
| Rate limited | 429 | `RATE_LIMITED` |
| First enrolment lost the race | 409 | `ALREADY_ENROLLED` |
| Needs a recent code | 403 | `SECOND_FACTOR_REQUIRED` |
| Removing the last authenticator | 409 | `LAST_AUTHENTICATOR` |
| An 11th authenticator, a 4th live enrollment | 409 | `AUTHENTICATOR_LIMIT` |
| Unknown authenticator, session or enrollment | 404 | `NOT_FOUND` |

Logs (events and ids only, never a code, secret, setup code or recovery-code id): `admin_code_failed`,
`admin_code_replayed`, `admin_challenge_spent`, `admin_sign_in_locked`, `admin_totp_key_mismatch`,
`admin_enrolled`, `admin_authenticator_added`/`removed`, `admin_recovery_code_used`. Audit: `create`
/ `update` / `delete` on `authenticator`, `update` on `recovery_codes`, `login` / `logout` on `session`
(the summary names the factor), `update` on `two_factor` for a lockout.

### The CLI: `npm run admin:mfa -- <command> [--remote] [--yes]`

| Command | Does |
| --- | --- |
| `list` | authenticators (label, added, last used), recovery codes (unused / total), live sessions, a live setup code's expiry, the lockout |
| `setup` | delete setup codes and `enroll` challenges, insert the new code's hash `WHERE NOT EXISTS (SELECT 1 FROM admin_authenticators)`, read it back (`--json`); prints the code only if it was stored, else "Two-factor is already set up: use `reset`" |
| `reset` | delete setup codes, authenticators, recovery codes, challenges, sessions (in that order), audit "Two-factor reset from the command line", then store and print a new setup code |
| `unlock` | delete the `login:%` rate-limit rows (lockout and buckets) |
| `key` | print a new random `TOTP_ENCRYPTION_KEY` (no database) |

`scripts/admin-mfa.ts` (tsx, run from the repo root): builds SQL from `admin_two_factor_cli/sql.ts`
and runs wrangler's own script with node: `wrangler d1 execute DB --local|--remote --json --command
<statements>` (`--yes` when remote) in `apps/web`, an argv array, no shell. (Built 2026-11-12 with
`--command` instead of a temporary `--file`: a remote `--file` is an import that returns no rows, and
`setup` reads its code back.) `--remote`: refuses while
`database_id` is all zeros; prints the plan and asks to type the command name unless `--yes`; needs
`wrangler login`. `list` uses `--json` and prints a table.

## Workstreams

### A. Two-factor core

- **T2.1** Migration `0003_admin_two_factor.sql`; query modules (`admin_authenticators`,
  `admin_recovery_codes`, `admin_setup_codes`, `admin_mfa_challenges`, `admin_sessions` extended,
  `admin_two_factor_cli/sql.ts`); `Config.admin.totpKey`; `.dev.vars.example`; `cf-typegen`; `uqr`.
- **T2.2** `totp.ts`, `recoveryCodes.ts`, `setupCode.ts`, `twoFactorKeys.ts`, `userAgent.ts`,
  `clientCountry`, `isOverLimit`, table-driven tests.

### B. Sign-in and the CLI

- **T2.3** Login step 1 (lockout, challenge); `login/setup`, `login/verify`, `DELETE /api/admin/login`;
  `challenge.ts`, `secondFactor.ts`, `session.ts` (new fields, 90-day cap), `requireAdmin.ts`
  (D2.19); the guard: `EXEMPT` matches `login`, `login/setup`, `login/verify`, `logout` and its
  self-test extracts the full path after `admin/`; `routeHarness.adminCookie` creates a session with
  `secondFactor: 'authenticator'` and a test authenticator id; `login/route.test.ts` uses
  `adminCookie` for its session cases; route tests split per route.
- **T2.4** Login UI: the server page picks the step; `CodeForm`, `SetupCodeForm`, `EnrollForm`,
  `QrCode`, `RecoveryCodesPanel`; messages.
- **T2.5** `scripts/admin-mfa.ts` and the root `admin:mfa` script (needed to sign in at all).

### C. The shell

- **T2.6** `Dialog` primitive and the jsdom polyfill; `nav.ts`, `icons.tsx`, `AdminShell`, `Sidebar`,
  `NavList`, `MobileBar`, `PageHeader`; `(panel)/layout.tsx` uses the shell; dashboard and design
  pages get `PageHeader`; contrast rows for the new pairs.

### D. Security settings

- **T2.7** Settings shell and registry; Security page; `second-factor`, `authenticators`
  (+ `enrollments`), `recovery-codes` (+ `acknowledge`), `sessions` routes; `CodeDialog` (sequential
  retry on the same `useApi` hook); `RecoveryCodesBanner`.

### E. Docs (each in its commit)

- Commit 2: AGENTS.md (where to look: `lib/auth` two-factor modules; commands: `admin:mfa`; the
  sign-in routes as the exception list of the admin-route guard), `architecture.md` → Admin (two-step
  sign-in, setup code, lockout, sessions), `deployment.md` (`TOTP_ENCRYPTION_KEY`, first sign-in with
  `admin:mfa -- setup --remote`, reset, unlock, key loss), `.dev.vars.example`.
- Commit 3: AGENTS.md (an admin screen = a page + a `nav.ts` entry; `PageHeader`), `recipes.md`
  (an admin screen).
- Commit 4: `architecture.md` → Admin (security settings, confirm with a code).
- **T2.8** Commit 5: index status, plan `done`, wiki index.

## Tests

| Test | What |
| --- | --- |
| `auth/totp.test.ts` | RFC 6238 SHA-1 vectors (T = 59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000; 8 digits, then 6); base32 round trip and RFC 4648 vectors; ±1 step accepted, ±2 refused; `step ≤ last_step` refused; non-digits, 5 or 7 digits refused; two secrets: the right one matched; `otpauthUri` (encoding, explicit parameters) |
| `auth/recoveryCodes.test.ts`, `setupCode.test.ts` | count, format, uniqueness; normalising (case, spaces, dash variants, NFKC); ids differ per key |
| `auth/twoFactorKeys.test.ts` | round trip; wrong key, tampered ciphertext, unknown version, **another row's AAD** → null |
| `auth/userAgent.test.ts` | table: browsers × systems; empty → "Unknown device"; default labels |
| `security/request.test.ts` | `clientCountry`: `US` → US; `XX`, `T1`, `us`, missing → null. `isSecureRequest`: header https/http, no header with an https/http URL, no header and no URL for a public host, `localhost`, `127.0.0.1`, `192.168.1.5` |
| `auth/session.test.ts` | the cookie's max-age is 90 days; a refresh never extends `expires_at` past sign-in + 90 days; a session older than 90 days is refused and deleted; 14 days idle ends it |
| `security/rateLimit.test.ts` | `isOverLimit` true at exactly the limit, false below; it writes nothing |
| `platform/config.test.ts` rows | `TOTP_ENCRYPTION_KEY` 32 bytes → key; 31, 33, not base64, empty → null |
| `config/appConfig.test.ts` | the key added to its secrets list |
| query module tests | each conditional write: replay, used recovery code, setup code used once and expired, cap 10, 3 live enrollments, last authenticator, concurrent first enrolment (one wins; the setup code survives a lost or expired attempt), attempts stop at 5, a challenge deleted mid-way blocks the write, remove ends that app's sessions, regenerate ends recovery-code sessions, confirm failures end the session at 5 |
| `admin_two_factor_cli/sql.test.ts` | every statement parameter-free; builders refuse a non-hex id or a non-ISO time; on a test D1: `setup` stores nothing when an authenticator exists, `reset` leaves no authenticator, code, challenge or session, `unlock` clears the `login:%` rows only |
| `api/admin/login/route.test.ts` | step 1 sets a challenge cookie and no session; `next` 'code' vs 'setup' by state; 503 setup required without a setup code; 503 without the key; lockout answers before the password is checked; the existing cases (sessions through `adminCookie`) |
| `api/admin/login/setup/route.test.ts` | right code → `enroll` with a pending secret; wrong code → attempts; expired code; a second challenge cannot reuse it after enrolment |
| `api/admin/login/verify/route.test.ts` | code from either of two apps; drift; replay → 401; the enrolment code cannot sign in again; `attemptsLeft` 4..0, the fifth deletes the challenge and clears its cookie; expired; password changed mid-way; CLI reset mid-way; recovery code single use and `recoveryCodesLeft`; both fields → 400; enrolment creates app + 10 codes + session and returns the codes once; `ALREADY_ENROLLED`; `no-store`; lockout after 20 failures (also refused at `setup`/`verify` with a live challenge), audited once; a replay is not a failure; a recovery code on an `enroll` challenge → 400; cross-origin 403; `__Host-` only on HTTPS |
| settings route tests | `SECOND_FACTOR_REQUIRED` before any write; the sign-in code typed again into the confirm dialog → `CODE_ALREADY_USED`, no failure counted; a 4th live enrollment → 409; window expiry (`atFixedTime`); recovery code consumed by the confirm; 5 wrong → session gone; add (bound to its session, expiry, caps), rename, remove (not the last, 404, sessions ended); regenerate; acknowledge; sign out this / another / others; 401 without a session; `no-store` |
| `components/admin/nav.test.ts` | as in *The studio shell* |
| component tests | `CodeForm` (attributes, paste "123 456"/"123-456", submits once at 6, error keeps value and focus, attempts text, expired → step 1 with the email, recovery mode, Start over); login page picks the step for each challenge state, and finds the cookies with and without `x-forwarded-proto`; `EnrollForm` (link href, grouped secret, copy fallback, wrong code keeps the QR); `RecoveryCodesPanel` (copy, download, `beforeunload`, continue gated); `CodeDialog` (retries the action once, stays open on a wrong code, recovery option, focus return); `Dialog`/`MobileBar` (`aria-expanded`, closes on navigation and at `lg`, scroll lock restored, backdrop); `NavList` (aria-current, Soon not focusable, announced once); Security parts (last Remove disabled with reason, rename limits, This device, empty sessions, no country shown when null); banner at ≤ 3 and 0 |
| `scripts/admin-mfa.test.ts` | argument parsing; `--remote` refused with a zero `database_id`; the confirmation prompt |
| `colorContrast.test.ts` | rows for every new text/surface pair |
| guards | `admin-routes-require-admin` exempts exactly `login`, `login/setup`, `login/verify`, `logout` |

## Risks and edge cases

- **Clock skew** beyond ±30 s fails every code; the message after two failures says to check the
  phone's time.
- **Locked out** (no phone, no codes): `admin:mfa -- reset --remote`, then the printed setup code.
- **Key lost or rotated**: authenticators and recovery codes stop working (503 and a log line); reset.
- **Lockout as denial of service**: someone with the password can lock sign-in for a day; `unlock`.
  Without the password nobody reaches the code step.
- **Recovery codes on screen**: shown once, `no-store`, never logged.
- **CPU**: step 2 decrypts ≤ 10 secrets and runs ≤ 30 HMAC-SHA1, well under 1 ms; PBKDF2 unchanged.
- **Row budget**: a sign-in writes about 5 rows.
- **File size**: route tests split per route; `session.ts` stays well under 700 lines.

## Verification

1. `npm run verify`; `npm run build:worker`.
2. `npm run db:migrate:local`; the new `.dev.vars` line; restart `npm run dev`. `npm run admin:mfa --
   setup`; first sign-in with a real authenticator app (from a computer, and with *Open in
   authenticator app* on a phone); sign out; sign in with a code; with a recovery code; add a second
   app and sign in with it; remove one; regenerate codes; sign out another session.
3. The sign-in path in `npm run preview` (port 8787).
4. `admin:mfa -- reset` → the next sign-in needs the new setup code; trip the lockout, then `unlock`;
   `list`.
5. `/admin`, the login steps and `/admin/settings/security` at 360 px and 1440 px; the drawer and the
   dialogs with the keyboard only and with VoiceOver or TalkBack.

### Results (M1, 2026-11-12)

1. `npm run verify`: ts-check clean, 701 tests in 60 files; the OpenNext build (`npm run preview`) passes.
2. Local D1: `db:migrate:local` applied `0003`. In `npm run preview` (port 8787), with a code computed
   from the shown key standing in for a phone: `admin:mfa -- setup` → password → setup code (typed in
   lower case with spaces) → QR step (QR, link, grouped key, name "Windows PC") → code → 10 recovery
   codes, Continue gated → dashboard. Sign out; password → code: the enrolment code again →
   "That code was just used", value and focus kept; a fresh code auto-submits at 6 digits → dashboard.
   Recovery code `5VLB2 TX547` (upper case, space) at 360 px → dashboard; `list`: 9 of 10 unused.
3. As 2 (the real Worker in workerd).
4. Today's failures set to 20 in the local D1 → step 1 answers "Sign-in is locked…"; `unlock` →
   `reset` → `list` shows no app, code or session and a live setup code → sign-in asks for it again.
   `--remote` is refused while `database_id` is all zeros.
5. Login steps at 360 and 1440 px: no horizontal scroll; focus moves to each new step's `<h1>`. Fixed
   after the run: the QR shrank to ~120 px beside the key at 1440 (now `shrink-0`, 200 px); the first
   code now sets the app's "last used". The shell and Security parts come with M2 and M3.

### Results (M2, 2026-11-12)

- `npm run verify`: ts-check clean, 731 tests in 63 files. The OpenNext build passes.
- In the built Worker (`wrangler dev` on 8788 with its own throwaway D1 and a session inserted there,
  so the developer's local two-factor state was not touched): at 1440 px the sidebar (mark, New
  gallery and the later screens as *Soon*, Dashboard current, Sign out at the foot) and the design
  page; at 360 px the top bar, no horizontal scroll. Keyboard only: Tab → *Skip to content* → Menu;
  Enter opens the drawer with focus on Close and the page scroll locked; Tab moves Dashboard →
  Sign out and skips the *Soon* items; Esc closes it, focus back on Menu, scroll restored; widening
  to 1440 px with the drawer open closes it. Fixed after the run: the skip link's padding (`not-sr-only`
  reset it). Not checked: VoiceOver or TalkBack (no screen reader here).
- Settings is listed as *Soon* until M3 adds its pages (`nav.test.ts` requires a page for every linked
  item); the design page stays linked from the dashboard until then.

### Results (M3, 2026-11-12)

- `npm run verify`: ts-check clean, 784 tests in 67 files. The OpenNext build passes.
- In the built Worker (`wrangler dev` on 8788 with a throwaway D1 seeded with a setup code; codes
  computed from the shown keys standing in for phones): first sign-in through the UI, then Settings
  from the sidebar → Security. *Add an app* → the code dialog; the sign-in code typed again →
  "That code was just used"; a wrong code → "4 tries left", field selected; a right one → the dialog
  closes and the add starts by itself (QR, link, key, name). A wrong code for the new app keeps the QR,
  key and name; the right one adds "Tablet". Within the 5 minutes, *Remove Phone* and *Generate new
  codes* asked only their own question, no code; the device list then read "with a removed app".
  New codes at 360 px: Done gated by "I have saved these codes", Esc ignored. *Sign out* this
  device → the sign-in page.
- Fixed after the run: at 360 px the page scrolled sideways by ~50 px: the visually hidden
  ", not available yet" of the *Soon* settings sections escaped the scrolling row (no positioned
  ancestor); the items are `relative` now, in the sidebar list too.
- Not checked: VoiceOver or TalkBack.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(auth): TOTP, recovery and setup codes, the encryption key` | T2.2, the config key of T2.1 | — |
| 2 | `feat(auth): two-step sign-in, first-time setup and the admin:mfa command` | T2.1, T2.3–T2.5 | `db:migrate:local`; Verification 2 (sign-in), 3, 4 |
| 3 | `feat(admin): the studio shell` | T2.6 | Verification 5 (shell) |
| 4 | `feat(admin): security settings` | T2.7 | Verification 2, 5 |
| 5 | `docs: Phase 2 done` | T2.8 | — |

The tables moved to commit 2 while building (2026-11-12): the rebuilt `admin_sessions` needs a second
factor, which only commit 2's sign-in can give, so commit 1 alone would have broken sign-in.

Milestones: **M1** = commits 1–2 (two-factor sign-in works), **M2** = commit 3, **M3** = commits 4–5.

## Checklist

- [x] T2.1 Migration, query modules, config key, `uqr`
- [x] T2.2 TOTP, codes, keys, user agent, country, `isOverLimit` (pure)
- [x] T2.3 Sign-in routes, session changes, guard
- [x] T2.4 Sign-in UI
- [x] T2.5 `admin:mfa` command
- [x] T2.6 Dialog and the studio shell
- [x] T2.7 Settings shell and Security
- [x] T2.8 Docs and status
- [x] Verification 1–5 (results under each milestone; a real phone and a screen reader are the developer's to try)

## Open questions

None blocking.
