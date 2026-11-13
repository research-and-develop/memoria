---
title: "Phase 2b: Settings in the database"
type: plan
status: draft
updated: 2026-11-13
related: [plan_202611_mvp.md, plan_202611_p02_admin_totp.md, plan_202611_p03_relay_email.md, ../../architecture.md, ../../deployment.md, ../../../AGENTS.md]
---

# Phase 2b: Settings in the database

## Goal

What the photographer may want to change lives in D1 and is edited in the studio, not in Worker
variables: the sign-in email and password (Settings → Security) and the studio's name and website
address (Settings → Studio). Environment variables remain as the defaults a fresh install and local
development start from; once a value is saved in the studio, it wins. Phase 3 puts email delivery in
the same place.

User decision (2026-11-13): "everything is set as env variables … which might not be an easy way to
operate for an average photographer, can we put these settings into the database so they are
configured through the UI? Of course for the development purposes we can have the option with the
env variables."

**Done when:**

- The sign-in email and password come from D1 (`admin_account`) when a row exists, else from
  `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`. Settings → Security has a **Sign-in** card: change the email,
  change the password (or generate one); both need a code (the D2.9 window) and the current password;
  a new password signs out every device.
- A production install needs **no** `ADMIN_EMAIL` or `ADMIN_PASSWORD_HASH`: `npm run admin:mfa --
  password --email <address> --remote` creates the account with a generated password (printed once,
  for the photographer, who is asked to change it), `setup` gives the first authenticator's code.
- Settings → **Studio** sets the studio name (page titles, the admin, authenticator labels, later the
  emails) and the website address (canonical URLs, robots, links in emails); `APP_NAME` / `SITE_URL`
  are only defaults.
- The env values that are now defaults are reachable only through the settings modules (a type
  change plus a guard).

- **Depends on:** Phase 2. **Unblocks:** Phase 3 (email settings in the same store, the studio name and
  website address in emails, notices to the account email), Phase 4 (more studio settings).
- **Mockups:** `Settings.dc.html` ("Your sign-in", the settings layout).
- **Scope (feature IDs):** A1 (the account editable), the groundwork of B1 (studio name).

## Starting point (verified 2026-11-13)

- `Config.admin = { email, passwordHash, totpKey }`, `Config.appName` (`APP_NAME`, default "Memoria"),
  `Config.siteUrl` (`SITE_URL`, null = the request's origin) — all from env, parsed by `parseConfig`.
- Readers of the account: `api/admin/login/route.ts` (the "not configured" 503 runs **before** the
  rate limit today; email compared lower-cased with `config.admin.email`), `lib/auth/codeStep.ts`
  (the challenge's `password_version`), `requireAdmin.ts` (`adminPasswordHash()` → `resolveSession`),
  `admin/login/page.tsx` and `authenticators/enrollments/route.ts` (otpauth label =
  `config.admin.email`, issuer = `config.appName`). `password_version` = a fingerprint of the hash: a
  new hash ends every session and challenge; the same hash keeps them.
- `parsePasswordHash` trims the stored value; `verifyPassword` runs PBKDF2-SHA256 at 20,000
  iterations (measured for one derivation per request).
- Readers of the studio name: `toAppConfig(config)` / `getAppConfig()` (root layout metadata, home
  page, admin shell), `config.appName` (Security page, login page, enrollments). Site URL:
  `lib/config/siteUrl.ts` (`getSiteUrl()`), used by the root layout's `metadataBase` and `robots.ts`.
- `site_settings` (key `[a-z]*` ≤ 64, JSON value) with get/list/upsert; no row stored yet.
- Settings → Security ends with a *Password* card pointing to the deployment guide. `confirmWithCode`
  / `SECOND_FACTOR_REQUIRED` (D2.9) protect two-factor changes; five wrong confirm codes end the
  session (`deleteSessionAtFailureCapStatement`); the client retries through `SecondFactorProvider`.
- `hitRateLimits(rules)` increments fixed windows by upsert and reports whether any is over.
- `audit_log.action` allows `create`, `update`, `delete`, `login`, `logout`.
- `scripts/admin-mfa.ts` (`list|setup|reset|unlock|key`), SQL in the import-free
  `admin_two_factor_cli/sql.ts`. `/healthz` is answered by `worker.ts`.
- No production D1 exists: this phase's migration is `0004` (Phase 3's `jobs` becomes `0005`).

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D2b.1 | **Two kinds of settings.** *Deploy-level* (set once by whoever deploys): `TOTP_ENCRYPTION_KEY`, `HASH_SALT`, Turnstile keys, the R2/S3 token and endpoint, `MEDIA_PUBLIC_BASE_URL`, `LOG_*`, bindings, later `SETTINGS_ENCRYPTION_KEY` — env only. *Studio-level* (the photographer's): the sign-in email and password, the studio name, the website address; email delivery (Phase 3); branding, time zone (Phase 4) — D1, edited in Settings. | A photographer never edits Worker variables; the secrets that protect the data stay out of the database they protect. |
| D2b.2 | **Effective value = D1, else env, else the default.** Once a D1 value exists the env value is ignored. Deleting the D1 row (a restore from an old backup, a manual `DELETE`) makes the env value effective again — so after the first production install the env credentials are **deleted** (deployment.md), and the Sign-in card warns while a D1 account exists and `ADMIN_PASSWORD_HASH` is still set. | Development and a first install work from env; the studio takes over without a migration step; the one dangerous fallback is visible. |
| D2b.3 | **The env defaults move into `Config.bootstrap`** = `{ appName, siteUrl, adminEmail, adminPasswordHash }` (the old `appName`, `siteUrl`, `admin.email`, `admin.passwordHash` fields disappear). Guard `settings-through-store`: `.bootstrap` appears only in `packages/platform/config.ts`, `packages/platform/testing/**`, `lib/settings/**`, `lib/auth/account.ts` and `scripts/**`. | A type change finds every reader; the guard keeps later phases from bypassing the fallback rule, also through an alias. |
| D2b.4 | **The account is a one-row table** `admin_account` (`id = 1`). | Its own CHECKs; writes conditional on the old hash; no JSON on the sign-in path. |
| D2b.5 | **Changing the email or the password: code first, then the password.** Order: auth → body → parse → rate limits counted **before** any check (`account_password:<session>` 5/hour, `account_password` 20/hour overall) → confirm window (no window → 403 `SECOND_FACTOR_REQUIRED`, the password never looked at) → `verifyPassword` → write. Five wrong current passwords on one session end it (as five wrong codes do). | A stolen session without a code learns nothing about the password; parallel requests cannot outrun the limit. |
| D2b.6 | **A new password ends every session and challenge**, the current one too (`password_version`); the page then goes to sign-in with "Password changed. Sign in again." A new email ends nothing. | One rule, already enforced on every request. |
| D2b.7 | **Passwords**: 12–128 characters after NFKC, not equal to the email; *Generate* fills a 20-character one (`generatePassword`), shown once with Copy. Hashed in the route with the existing parameters. A change runs PBKDF2 twice (verify + hash): **measured** (Verification 4); over budget → the change splits into two requests (verify → a 2-minute single-use token in the session row → hash). | Long passwords without a strength meter; the 10 ms CPU limit. |
| D2b.8 | **The CLI is the way in and the way out** (D2.13): `admin:mfa -- password [--email <address>] [--remote] [--yes]` stores a generated password (and the email, required when there is no row), marks it `set_by = 'cli'`, ends every session and challenge, and prints the email and password once with "Give this to the photographer; they change it in Settings → Security." It also prints the reminder that sign-in needs `TOTP_ENCRYPTION_KEY` on the Worker (the CLI cannot read a remote secret). While `set_by = 'cli'`, the Sign-in card shows "Choose your own password". | First production install without env credentials; a forgotten password; the installer does not keep knowing the photographer's password. |
| D2b.9 | **Studio settings** are the `site_settings` row `studio` = `{ "name": string, "siteUrl": string \| null }`. Name: 1–80 characters after trimming and NFC, no control, format or bidi characters (`\p{Cc}`, `\p{Cf}`). Website address: a bare domain (`photos.example.com`) gets `https://`; the stored value is an `https://` origin without path, query or fragment (`http://localhost…` in development); empty = the request's origin. The form shows the normalised value and a "Check it opens" link to `<address>/healthz`. **Changing the website address needs a code** (it goes into links in client emails from Phase 3); changing the name does not. | One row, one read; a photographer types a domain, not a URL; a stolen session cannot redirect email links. |
| D2b.10 | **Reads**: route handlers read the account once — `requireAdmin` puts it in `AdminContext` (`ctx.account`), and `codeStep`/the login route read it once; server components use `cache()`d `getAdminAccount()` / `getStudio()`. `getStudio()` never throws: a D1 error or an invalid row logs `studio_settings_unavailable` / `studio_settings_invalid` and uses the env defaults. | One indexed row per request; a D1 hiccup does not take every public page down. |
| D2b.11 | **Sign-in with no account** answers 503 `ADMIN_NOT_CONFIGURED` with "Sign-in is not set up yet. Ask whoever installed this site." (the command goes to the log and `details`), **after** the rate limit, the lockout and Turnstile. | No developer commands on a public page; no unthrottled D1 read. |

## Design

### Data: `migrations/0004_admin_account.sql`

```sql
-- The sign-in account (Phase 2b). Absent = ADMIN_EMAIL / ADMIN_PASSWORD_HASH from env (D2b.2).
CREATE TABLE admin_account (
  id            INTEGER NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  set_by        TEXT NOT NULL,                   -- who chose the password: 'studio' | 'cli' | 'env' (first save of an env account)
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_admin_account PRIMARY KEY (id),
  CONSTRAINT ck_admin_account_id CHECK (id = 1),
  CONSTRAINT ck_admin_account_email CHECK (length(email) BETWEEN 6 AND 254 AND email = lower(email) AND email LIKE '%_@_%._%'),
  CONSTRAINT ck_admin_account_password_hash CHECK (password_hash LIKE 'pbkdf2-sha256$%' AND length(password_hash) <= 200),
  CONSTRAINT ck_admin_account_set_by CHECK (set_by IN ('studio', 'cli', 'env'))
);
```

Query module `lib/db/queries/admin_account/`: `getAdminAccountRow()` and the pure builder
`saveAdminAccountStatement({ email, passwordHash, setBy, expectedHash, now })`:

```sql
INSERT INTO admin_account (id, email, password_hash, set_by, updated_at) VALUES (1, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash,
  set_by = excluded.set_by, updated_at = excluded.updated_at
WHERE admin_account.password_hash = ?
```

Params `[email, passwordHash.trim(), setBy, now, expectedHash]`. The update happens only if the hash is
still the one the current password was checked against (a concurrent change or a CLI reset wins). The
insert path (no row yet: the account came from env) has no such check — accepted: the env hash cannot
change while the Worker runs. In the same batch: `conditionalAuditStatement(update 'admin_account' …
WHERE changes() > 0)` and, for a password, the session and challenge deletes `WHERE EXISTS (SELECT 1
FROM admin_account WHERE id = 1 AND password_hash = ?)` (the new hash). Nothing changed → re-read →
409 `ACCOUNT_CHANGED` ("Your sign-in was changed elsewhere. Sign in again." when the hash differs).

The CLI's statements join `admin_two_factor_cli/sql.ts` (import-free): the upsert with checked values
(`set_by = 'cli'`, no `WHERE` on conflict: the developer wins) and the session/challenge deletes.

### Effective values

```ts
// packages/platform/ports.ts
type Config = { …; bootstrap: { appName: string; siteUrl: string | null; adminEmail: string; adminPasswordHash: string }; … };

// apps/web/src/lib/auth/account.ts (server-only)
export type AdminAccount = { email: string; passwordHash: string; source: 'database' | 'env'; setBy: 'studio' | 'cli' | 'env' };
export async function readAdminAccount(opts?: Options): Promise<AdminAccount | null>; // row ?? bootstrap (both set, email lower-cased, hash trimmed) ?? null
// account.cached.ts: export const getAdminAccount = cache(readAdminAccount);       // server components only

// apps/web/src/lib/settings/studio.ts (server-only)
export type Studio = { name: string; siteUrl: string | null };
export async function readStudio(opts?: Options): Promise<Studio>;   // never throws (D2b.10)
// studio.cached.ts: export const getStudio = cache(readStudio);
// The read* modules import no React: the relay (Phase 3) uses them; only the *.cached.ts wrappers use cache().
// apps/web/src/lib/settings/parseStudioInput.ts (pure, shared with the form)
```

| Where | Today | After |
| --- | --- | --- |
| `api/admin/login/route.ts` | `config.admin` before the rate limit | order: same-origin → parse → rate limit → lockout → Turnstile → `readAdminAccount()` (null → 503, D2b.11) → PBKDF2 (always run, as today) → email compare (both lower-cased) |
| `requireAdmin.ts` | `adminPasswordHash()` | reads the account once; `resolveSession(token, { passwordHash: account?.passwordHash ?? '' })`; `AdminContext.account`; no account → 401 |
| `getAdminSession()` (pages) | as above | `getAdminAccount()` (cached) |
| `codeStep.ts`, `admin/login/page.tsx` | `config.admin.passwordHash` | the account read once per request |
| otpauth label (`login/page.tsx`, `enrollments/route.ts`) | `config.admin.email`, `config.appName` | account email, studio name |
| `appConfig.ts` | `toAppConfig(config)` sync | `toAppConfig(config, studio)` pure; `getAppConfig()` async (cached); root layout `generateMetadata`, `RootLayout`, home page and `(panel)/layout.tsx` await it (all server components) |
| `siteUrl.ts` | `config.siteUrl` | `(await getStudio()).siteUrl ?? request origin` |
| Security page, recovery-codes text | `config.appName` | studio name |

### Settings → Security: the Sign-in card

Replaces the *Password* card. The card component is promoted from
`components/admin/security/SecuritySection.tsx` to `components/admin/settings/SettingsCard.tsx` (its
four importers follow; Phase 3 reuses it).

- Shows the sign-in email. Notes, only when they apply:
  - `set_by = 'cli'`: "This password was set when the site was installed. Choose your own."
  - a database account while `ADMIN_PASSWORD_HASH` is still set: "The installer's password is still in
    the server configuration. Ask them to remove ADMIN_PASSWORD_HASH and ADMIN_EMAIL." (D2b.2)
- **Change email**: new email + current password → `PATCH /api/admin/account/email`.
- **Change password**: current password, new password (Generate fills it and shows it with Copy),
  repeat → `PATCH /api/admin/account/password` → "Password changed. Sign in again." → `/admin/login`.
- Both go through `SecondFactorProvider` (a `SECOND_FACTOR_REQUIRED` answer asks for a code, then the
  same request is retried once). Wrong current password: "That is not your current password." on the
  field; the fifth signs out.

### Settings → Studio (`/admin/settings/studio`)

New first entry in `SETTINGS_SECTIONS` (`SETTINGS_HOME` becomes Studio). One card:
- **Studio name** ("Shown on every page, in the studio, in authenticator apps and in your emails").
- **Website address** (placeholder `photos.example.com`; "Set it once your own domain opens this site.
  Leave empty to use whichever address the site is opened on."), the normalised value shown under the
  field, a **Check it opens** link (`<address>/healthz`, new tab).
- `PATCH /api/admin/settings/studio` `{ name, siteUrl }` → `parseStudioInput` → if `siteUrl` changes:
  confirm window (D2b.9) → `batch([upsertSiteSettingStatement('studio', …), audit update 'studio' { fields }])`
  → `{ data: Studio }`; `router.refresh()`.
- A new name changes the label that new authenticator enrolments get; existing apps keep theirs.

### Routes

All: `requireAdmin` first, `no-store`, `withErrorHandling`.

| Route | Body | Order of checks | Effect |
| --- | --- | --- | --- |
| `PATCH /api/admin/account/email` | `{ email, currentPassword }` | parse (`parseEmailAddress`) → rate limits (counted) → confirm window → `verifyPassword` (wrong: 400, count the session's consecutive failures, the 5th deletes the session) | save (hash unchanged, `set_by` kept), audit |
| `PATCH /api/admin/account/password` | `{ currentPassword, newPassword }` | parse (length, NFKC, ≠ email) → the same | `hashPassword`, save (`set_by = 'studio'`), delete sessions + challenges, audit; clear the cookie; `{ data: { signedOut: true } }` |
| `PATCH /api/admin/settings/studio` | `{ name, siteUrl }` | parse → confirm window when `siteUrl` changes | upsert + audit |

Consecutive wrong passwords per session use the existing `admin_sessions.code_failures` counter (a
wrong password counts like a wrong confirm code; the cap of 5 ends the session).

### Email addresses

`packages/core/email.ts` (pure, no deps): `parseEmailAddress(text)` → the address trimmed with the
domain lower-cased, or null; ASCII only, local part `[A-Za-z0-9._+-]` 1–64 without leading, trailing or
double dots, labels `[A-Za-z0-9-]` 1–63, a 2+ letter TLD (punycode for IDNs), ≤ 254. The account stores
it fully lower-cased. Phase 3's mailer re-exports it.

### The CLI

`scripts/admin-mfa.ts` gains `password [--email <address>]` (D2b.8): a 20-character password from
`generatePassword`, hashed with `lib/auth/password.ts` (Node Web Crypto, same parameters); `--email`
checked by `parseEmailAddress`; without `--email` and without a row → "No account yet: pass --email";
the upsert and the session/challenge deletes in one `wrangler d1 execute` file; `--remote` asks to type
`password` unless `--yes`. `list` prints `account: <email> (database, password set by <who>)` or
`account: none in the database (env ADMIN_EMAIL/ADMIN_PASSWORD_HASH are used if set)`.

### Errors

| Code | Status | When |
| --- | --- | --- |
| `INVALID_PARAMS` | 400 | a field fails its parser (`field`) |
| `WRONG_PASSWORD` | 400 | the current password does not match (`field: 'currentPassword'`), after a valid code |
| `SECOND_FACTOR_REQUIRED` | 403 | no code in the last 5 minutes (D2.9) |
| `RATE_LIMITED` | 429 | 5 password attempts an hour on a session, 20 overall |
| `ACCOUNT_CHANGED` | 409 | the account changed between the check and the write |
| `ADMIN_NOT_CONFIGURED` | 503 | sign-in with no account in D1 or env |

## Workstreams

- **T2b.1** Migration `0004_admin_account.sql`; query module `admin_account`; `@repo/core/email.ts`;
  `Config.bootstrap` (+ `config.test.ts`, the test platform); `lib/auth/account.ts`; every account
  reader switched (login route order, `requireAdmin` + `ctx.account`, `codeStep`, login page,
  enrollments); `lib/settings/studio.ts` (`readStudio` + `studio.cached.ts`), `toAppConfig(config, studio)`,
  async `getAppConfig` and its callers, `getSiteUrl`, the studio-name labels and Security text (so
  `Config.bootstrap` compiles everywhere in this commit); the CLI `password` and `list`; guard
  `settings-through-store`; `.dev.vars.example` comments ("development and first install only").
- **T2b.2** `SettingsCard` promotion; the Sign-in card; the two account routes.
- **T2b.3** `parseStudioInput`; the Studio section, route and nav entry.
- **T2b.4** Docs: AGENTS.md (the two kinds of settings, D2b.1–3; where to look: `lib/settings`,
  `lib/auth/account.ts`; the guard), `architecture.md` (Configuration: the settings layers; Admin: the
  account, the order of checks), `deployment.md` (first install: `admin:mfa -- password --email …
  --remote`, then `setup`; `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` only for development, **deleted** after
  the first install; a forgotten password), `recipes.md` (*A studio setting*: a field in a
  `site_settings` row, a parser, the env default in `bootstrap`, the Settings form); index (Phase 2b
  row), plan `done`.

## Tests

| Test | What |
| --- | --- |
| `queries/admin_account/admin_account.test.ts` | insert when absent; update only with the expected hash (a stale one changes nothing, and the batch writes no audit row); CHECKs refuse id 2, an upper-case or malformed email, a non-PBKDF2 hash, an unknown `set_by`; a hash with surrounding spaces is stored trimmed |
| `auth/account.test.ts` | the row wins; bootstrap when no row (email lower-cased, hash trimmed); null when neither or half; row deleted → bootstrap again (documented behaviour) |
| `core/email.test.ts` | valid: plain, `+`, uppercase domain, punycode; refused: CR/LF, `<>`, space, quote, `%`, `!`, non-ASCII, two `@`, no TLD, dots, label 64, local 65, 255 in all |
| `settings/studio.test.ts` | row > bootstrap > default per field; invalid row ignored and logged; a throwing db → bootstrap and logged; `parseStudioInput`: trimmed, NFC, 81 characters, `\p{Cc}`, `\p{Cf}` (zero-width, bidi), bare domain → `https://`, `http://` outside development, a path, a query, a port kept, empty → null |
| `api/admin/login/route.test.ts` | the database account signs in; bootstrap when no row; database wins (the env password fails); 503 `ADMIN_NOT_CONFIGURED` only after the rate limit and Turnstile (an over-limit request answers 429 without reading the account), its message has no command; PBKDF2 runs for a wrong email too |
| `auth/requireAdmin` (in route tests) | no account → 401; `ctx.account` set; a session survives the first env-to-database save (same hash) |
| `api/admin/account/email/route.test.ts`, `password/route.test.ts` | 401, 403 cross-origin; no window → 403 and the password is not checked (a wrong one answers 403 too); rate limits counted before checks (parallel requests cannot exceed 5); wrong password → 400, the 5th ends the session; email change keeps the session and `set_by`; password change ends every session (the current included) and challenge, clears the cookie, `set_by = 'studio'`, the old password fails at sign-in; concurrent change → 409; audit rows without passwords or hashes; `no-store` |
| `api/admin/settings/studio/route.test.ts` | saves and audits; name-only change needs no code; a `siteUrl` change without a window → 403; invalid fields → 400 with `field` |
| `config/appConfig.test.ts`, `config/siteUrl.test.ts` | the studio name; still no secret; studio address > request origin |
| `platform/config.test.ts` | `bootstrap` from `APP_NAME`, `SITE_URL`, `ADMIN_EMAIL` (lower-cased), `ADMIN_PASSWORD_HASH` (trimmed) |
| `scripts/admin-mfa.test.ts` | `password` parsing (`--email` checked), the remote confirmation; on a test D1 through the SQL module: creates the row with `set_by = 'cli'`, replaces the hash, ends sessions |
| component tests | Sign-in card (the two notes appear only when they apply, Generate shows and copies, repeat mismatch, wrong-password message, the code dialog then retry, redirect after a password change); Studio form (bare domain normalised and shown, the Check link, errors, refresh) |
| guard | `settings-through-store`: flags `.bootstrap` outside the allowed files, also through `const c = getPlatform().config(); c.bootstrap`; passes inside; self-test samples |

## Risks and edge cases

- **Locked out after a password change**: `admin:mfa -- password`.
- **Old backup restored, or the row deleted**: the env credentials become effective again (D2b.2) —
  hence deleting them after the first install, and the warning.
- **Website address set before the domain works**: the Check link and the note; clearing it falls back.
- **CPU**: a password change runs PBKDF2 twice; measured (Verification 4), with the split as the fallback.
- **Rows**: one row read per admin request and per public page view.
- **The local `.dev.vars` credentials keep working** (bootstrap); nothing to migrate.

## Verification

1. `npm run verify`; `npm run build:worker`.
2. Local: sign in with the `.dev.vars` account; change the email (code asked first) → sign out → sign
   in with the new email; change the password with Generate → signed out → sign in with it; the
   installer note after `npm run admin:mfa -- password`, gone after choosing a password; `list` shows
   the database account.
3. Settings → Studio: a new name shows in the page title, the admin sidebar and a new authenticator's
   label; `photos.example.com` is saved as `https://photos.example.com` (code asked); `robots.txt`
   follows; clearing it falls back.
4. `npm run preview`, then the first deploy when it happens: `measure:cpu` on `PATCH
   /api/admin/account/password` (two PBKDF2) and the sign-in; over 10 ms → the D2b.7 split.
5. 360 px and 1440 px; keyboard only.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(auth): the admin account in the database` | T2b.1 | `db:migrate:local`; sign-in still works (env and CLI accounts) |
| 2 | `feat(admin): change the sign-in email and password` | T2b.2 | Verification 2 |
| 3 | `feat(admin): Settings → Studio` | T2b.3 | Verification 3, 5 |
| 4 | `docs: Phase 2b done` | T2b.4 | Verification 4 (preview; production when it exists) |

Milestones: **M1** = commits 1–2, **M2** = commits 3–4.

## Checklist

- [ ] T2b.1 Account table, `Config.bootstrap`, effective account, readers, CLI, guard
- [ ] T2b.2 Sign-in card and account routes
- [ ] T2b.3 Studio settings and section
- [ ] T2b.4 Docs and status
- [ ] Verification 1–5

## Open questions

None blocking.
