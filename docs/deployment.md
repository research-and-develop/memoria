---
title: Deployment
type: reference
updated: 2026-11-12
related: [architecture.md, ../.github/workflows/ci.yml, ../.github/workflows/backup.yml]
---

# Deployment

How the app gets to Cloudflare, and the runbooks for the things that go wrong. Run every `wrangler`
command from `apps/web` (the npm scripts do this for you).

## One-time setup

```sh
cd apps/web
npx wrangler login
npx wrangler d1 create memoria --location <hint>   # e.g. weur/eeur/enam: near your visitors; FIXED at creation
#   → paste the printed database_id into wrangler.jsonc
npm run cf-typegen                                 # after any wrangler.jsonc change
npm run admin:hash-password -- --generate          # → the ADMIN_PASSWORD_HASH secret
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put TURNSTILE_SECRET_KEY       # Dashboard → Turnstile → add a widget (site key → vars)
npx wrangler secret put HASH_SALT                  # openssl rand -base64 32
cd ../.. && npm run admin:mfa -- key               # → the TOTP_ENCRYPTION_KEY secret
cd apps/web && npx wrangler secret put TOTP_ENCRYPTION_KEY
cd ../.. && npm run db:migrate:remote && npm run deploy
npm run admin:mfa -- setup --remote                # → a setup code for the first sign-in (valid 1 hour)
```

The first sign-in takes the email, the password, then that setup code, then a code from the
authenticator app it connects; it shows 10 recovery codes once (see *Two-factor sign-in* below).

Then set `ADMIN_EMAIL` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc` `vars`, and `SITE_URL` once a
custom domain serves the Worker (never before: canonical URLs would point at a domain that does not
answer). Custom domain: Worker → **Settings → Domains & Routes → Add → Custom domain**; a `www`
redirect is a Redirect Rule (`www.example.com/*` → `https://example.com/$1`, 301).

The very first deploy runs from a terminal (`wrangler login`): a CI token with *Workers: Editor* can
update a Worker but not create it.

### Media (R2)

Needed before the first upload ships (Phase 5); local dev, the tests and CI never touch it. R2 must be
enabled on the account first (the dashboard may ask for billing details; the free tier still applies).

```sh
cd apps/web
npx wrangler r2 bucket create memoria-media --location <hint>   # the name in wrangler.jsonc r2_buckets
# r2-cors.json: replace the placeholder origin with the production origin first
npx wrangler r2 bucket cors set memoria-media --file r2-cors.json
```

- **The S3 API token**: Dashboard → R2 → **Manage API tokens → Create API token**, permission **Object
  Read & Write**, scoped to **the `memoria-media` bucket only**. It shows an *Access Key ID* and a
  *Secret Access Key* once: `npx wrangler secret put MEDIA_S3_ACCESS_KEY_ID` and
  `npx wrangler secret put MEDIA_S3_SECRET_ACCESS_KEY`.
- **Vars** in `wrangler.jsonc`: `MEDIA_S3_ENDPOINT` = `https://<account id>.r2.cloudflarestorage.com`
  (presigned URLs work only there, not on a custom domain); `MEDIA_S3_BUCKET` = the bucket (the guard
  checks it matches `r2_buckets`); `MEDIA_PUBLIC_BASE_URL` = the public media domain once one is chosen
  (R2 → bucket → Settings → Custom Domains), empty until then.
- Without all four S3 settings, every upload/download URL fails with `MEDIA_NOT_CONFIGURED` (503):
  there is no fallback in production. The `/api/blobs/*` routes answer 404 there (they need
  `NEXTJS_ENV=development`, which only `.dev.vars` sets; the guard keeps it out of `vars`).
- Check from a browser once (plan Phase 1, Verification 5): a presigned PUT and GET against the bucket
  with the CORS rules, `response-content-disposition`, and that a PUT with another Content-Type fails.

## How a change ships

GitHub Actions (`.github/workflows/ci.yml`) is the only CI.

1. Push to `master` or a pull request → `check`: `npm ci`, `ts-check`, `test`, `build:worker`
   (plus an informational `npm audit`).
2. Deploy is **manual**: Actions → CI → Run workflow on `master` with `deploy` ticked → `check`, then
   `npm run db:migrate:remote`, then `npm run deploy`. Manual by design — a push never goes live by
   itself. It works only after the first deploy from a terminal (One-time setup) has created the D1
   and its `database_id` is in `wrangler.jsonc`.

### Migrations run before the code

The new code goes live only after its migrations are applied, so for a moment the OLD code runs
against the NEW schema. Every migration must be safe for the code that is still running: add
tables/columns (nullable or with a default) first; drop or rename only in a later release, once no
deployed code reads them.

### Preview versions

There is no CI preview job. `cd apps/web && npx wrangler versions upload` (after `npm run build:worker`)
makes a new version that is NOT live, on its own preview URL. **A preview version uses the production
bindings** — the same D1. Use it only for changes that do not
write data and need no unapplied migration.

## CI variables

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → Workers & Pages → Account details |
| `CLOUDFLARE_API_TOKEN` | an **account** API token (Manage Account → Account API Tokens), not a profile token (which dies with its user): Workers: Editor, D1: Edit, Account Settings: Read |

App secrets are NOT CI variables: they live in Cloudflare (`wrangler secret put`).

## Secrets

Never in `wrangler.jsonc`, the repo or CI. Each is documented in `apps/web/.dev.vars.example` and set
in production with `cd apps/web && npx wrangler secret put <NAME>`; `npx wrangler secret list` shows
which exist. Setting a secret deploys a new version.

| Secret | What |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | the Turnstile widget's secret (its site key is the `TURNSTILE_SITE_KEY` var) |
| `ADMIN_PASSWORD_HASH` | `npm run admin:hash-password` |
| `HASH_SALT` | a long random string; hashes IPs for rate limits (missing → logged `hash_salt_missing`) |
| `TOTP_ENCRYPTION_KEY` | `npm run admin:mfa -- key` (32 random bytes): encrypts the authenticator secrets, keys the recovery codes. Missing → sign-in answers 503. Changing it disables every authenticator: reset (below) |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | the bucket-scoped R2 API token (One-time setup → Media) |

`MEDIA_DEV_SIGNING_SECRET` is local only (it signs the development blob routes): never set it in
production.

## Two-factor sign-in

Signing in to `/admin` takes the password, then a 6-digit code from an authenticator app or a
one-time recovery code ([architecture.md → Admin](architecture.md#admin)). The developer's controls,
run from the repo root (local D1 by default, `--remote` for production after `wrangler login`; a
remote run says what it will do and asks you to type the command's name, or pass `--yes`):

| Command | When |
| --- | --- |
| `npm run admin:mfa -- setup [--remote]` | No authenticator yet (first sign-in): prints a setup code, valid 1 hour. Refused once one exists. |
| `npm run admin:mfa -- reset [--remote]` | Phone and recovery codes lost, or a changed `TOTP_ENCRYPTION_KEY`: removes every authenticator, recovery code and session (everyone is signed out) and prints a new setup code. |
| `npm run admin:mfa -- unlock [--remote]` | "Sign-in is locked": 20 wrong codes in a UTC day lock sign-in until midnight UTC; this clears it (and the sign-in rate limits). |
| `npm run admin:mfa -- list [--remote]` | What is registered: apps, recovery codes left, live sessions, a live setup code, wrong codes today. |
| `npm run admin:mfa -- key` | A new `TOTP_ENCRYPTION_KEY` (no database). |

Changing the password (`admin:hash-password`, `wrangler secret put ADMIN_PASSWORD_HASH`) signs out
every device; authenticators stay.

## Rollback

- **Code**: `cd apps/web && npx wrangler rollback` (or Dashboard → Worker → Deployments). Instant;
  does not touch data.
- **Data**: D1 Time Travel restores the database to a point in time (7 days on the free plan):
  `npx wrangler d1 time-travel info DB`, then
  `npx wrangler d1 time-travel restore DB --timestamp=<ISO time>`. This rewinds every write after that
  time — export first (`npx wrangler d1 export DB --remote --output=backup.sql`).
- A migration is never "rolled back" by editing it: write a new migration that undoes it.

## Backups

Time Travel (7 days) plus a nightly SQL export: `.github/workflows/backup.yml` runs at 03:00 UTC
(an export briefly blocks other queries; it never overlaps a deploy), gzips the dump, **encrypts it
with a passphrase** (AES-256, `gpg --symmetric`) and keeps it as a workflow artifact for 90 days.

**Enable it** after the first `db:migrate:remote`:

1. Repository secret `D1_BACKUP_PASSPHRASE`: a long random string (`openssl rand -base64 32`). Keep a
   copy outside GitHub (a password manager): without it no backup can be read.
2. Repository **variable** `D1_BACKUP_ENABLED` = `true` (Settings → Secrets and variables → Actions →
   Variables). Until then every run is skipped.
3. Actions → Backup → Run workflow once, and check that the artifact `d1-<run id>` appears.

Download one now and then and keep it outside GitHub.

**Restore** (rehearse once into a scratch database):

```sh
gpg --decrypt --output d1.sql.gz d1.sql.gz.gpg   # asks for D1_BACKUP_PASSPHRASE
gunzip d1.sql.gz
cd apps/web
npx wrangler d1 create memoria-restore-test
npx wrangler d1 execute memoria-restore-test --remote --file=../../d1.sql
npx wrangler d1 delete memoria-restore-test
```

To restore production itself, prefer Time Travel (Rollback) while within its 7 days; an export is for
older points or a lost database.

## Dependencies

`npm audit fix` (never `--force`) is applied as its own commit, gated by `npm run verify`,
`npm run build:worker` and `npm run preview`; revert the lockfile if any of them breaks.

**Accepted advisories (2026-11-11):** 5 remain, all in OpenNext's build-time chain: `glob` 9–14
(high: the `glob` CLI's `-c` option, `AbortSignal` bypass), `minimatch` 7–11 (moderate: ReDoS),
`@node-minify/core`, `@opennextjs/aws`, `@opennextjs/cloudflare`. They run only during
`opennextjs-cloudflare build` on our own source, never on user input, and none of them is in the
deployed bundle (`grep -rlE "minimatch|node-minify" apps/web/.open-next/{worker.js,server-functions,middleware,cloudflare}`
is empty). npm's only "fix" downgrades to `@opennextjs/cloudflare@0.3.0`. Re-check after each OpenNext
upgrade.

## Measuring CPU time

The free plan allows 10 ms of CPU per request:

```sh
npm run measure:cpu -- https://memoria.<account-subdomain>.workers.dev/ 20
```

It tails the Worker, sends the requests and prints median/p95/max CPU and wall time per group
(`--group-by <header>`, default `cf-cache-status`). `--version <id>` reaches a version deployed at 0%
(`npx wrangler versions upload`, then `npx wrangler versions deploy <live>@100% <new>@0%`).

## Logs

Workers Logs is on (`observability` in `wrangler.jsonc`): Dashboard → Worker → Logs (3 days on the
free plan). Live: `cd apps/web && npx wrangler tail`. The app logs JSON events — search by the
`event` field, e.g. `unhandled_route_exception` (its `reqId` is the one the user saw).
