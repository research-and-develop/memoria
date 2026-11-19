---
title: Deployment
type: reference
updated: 2026-11-16
related: [architecture.md, ../.github/workflows/ci.yml, ../.github/workflows/backup.yml]
---

# Deployment

How the app gets to Cloudflare, and the runbooks for the things that go wrong. Every command runs
from the repo root. Wrangler commands go through **`npm run wrangler -- <args>`** (it runs wrangler in
`apps/web` with this project's credentials, below); never plain `npx wrangler`, which would use
whatever `wrangler login` this machine has.

## Cloudflare credentials

This project never uses `wrangler login` (one per machine: it may belong to another project). It
uses an **account API token** in a gitignored file, read only by `scripts/cloudflare.ts` (behind
`npm run wrangler`, `deploy`, `db:migrate:remote`, `measure:cpu` and `admin:mfa -- … --remote`).

1. **The account id**: Dashboard → the Memoria account → **Workers & Pages** → *Account details* →
   *Account ID* (32 hex characters; not a secret). Put it in `apps/web/wrangler.jsonc` as
   `"account_id": "<id>",` under `"name"`. Commands refuse to run while it is missing, and refuse a
   token file for another account: nothing can reach the wrong account. (Editing `wrangler.jsonc`
   while `npm run dev` runs breaks the dev server's bindings: restart it.)
2. **The token**: in that account, **Manage Account → Account API Tokens → Create Token → Custom
   token** (an *account* token keeps working if a user leaves; a profile token does not). Name
   `memoria-cli`. Permissions, all **Account**-level: *Workers Scripts: Edit*, *D1: Edit*, *Workers R2
   Storage: Edit*, *Workers Tail: Read*, *Account Settings: Read*. Optional: a TTL, and *Client IP
   Address Filtering* to your IP. Create, copy the token once.
3. **The file** `.cloudflare.env` at the repo root (gitignored; deliberately not `.env*`: Next and
   OpenNext read those, and OpenNext bakes them into the Worker):

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<the account id>
   CLOUDFLARE_API_TOKEN=<the token>
   ```

   Nothing else goes in it (refused). Check: `npm run wrangler -- d1 list` lists this account's
   databases (none yet) and asks for no login.
4. **CI** (when you choose to deploy from GitHub): repository secrets `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_API_TOKEN` (a second token, `memoria-ci`, with the same permissions minus *Workers
   Tail*, so either can be revoked alone). Every workflow that touches Cloudflare runs only by hand
   (*CI variables* below).

Custom domains and DNS (later phases) need zone permissions; they are added to the token then, or done
in the dashboard.

## One-time setup

After *Cloudflare credentials*:

```sh
npm run wrangler -- d1 create memoria --location <hint>   # e.g. weur/eeur/enam: near your visitors; FIXED at creation
#   → paste the printed database_id into apps/web/wrangler.jsonc
npm run cf-typegen                                        # after any wrangler.jsonc change
npm run wrangler -- secret put TURNSTILE_SECRET_KEY       # Dashboard → Turnstile → add a widget (site key → vars)
npm run wrangler -- secret put HASH_SALT                  # openssl rand -base64 32
npm run admin:mfa -- key                                  # → the TOTP_ENCRYPTION_KEY secret
npm run wrangler -- secret put TOTP_ENCRYPTION_KEY
npm run db:migrate:remote && npm run deploy
npm run admin:mfa -- password --email <the photographer's email> --remote   # → the account, a generated password (printed once)
npm run admin:mfa -- setup --remote                # → a setup code for the first sign-in (valid 1 hour)
```

Give the photographer the email, the password and the setup code. The first sign-in takes the email,
the password, then the setup code, then a code from the authenticator app it connects; it shows 10
recovery codes once (see *Two-factor sign-in* below). The Security page then asks them to choose
their own password (Settings → Security → Your sign-in), so the installer stops knowing it.

Production needs **no** `ADMIN_EMAIL` or `ADMIN_PASSWORD_HASH`: they are development defaults
(`.dev.vars`), used only while `admin_account` has no row. If they were set on a Worker, delete them
after the first install (`npm run wrangler -- secret delete ADMIN_PASSWORD_HASH`, and `ADMIN_EMAIL` from
`vars`): an old backup restored without the row would bring them back into force. The Security page
warns while `ADMIN_PASSWORD_HASH` is still set.

Then set `TURNSTILE_SITE_KEY` in `wrangler.jsonc` `vars`. The studio name and the website address are
the photographer's, in Settings → Studio; `APP_NAME` / `SITE_URL` in `vars` are only their defaults.
Set the website address once a custom domain serves the Worker (never before: canonical URLs would
point at a domain that does not answer; the "Check it opens" link tests it). Custom domain: Worker →
**Settings → Domains & Routes → Add → Custom domain**; a `www` redirect is a Redirect Rule
(`www.example.com/*` → `https://example.com/$1`, 301).

The very first deploy runs from your terminal, not CI. The account token creates both Workers
itself (verified 2026-11-16). New Cron Triggers take a few minutes to start firing (7 minutes on
the first deploy), and a new `workers.dev` route can answer 404 for a minute.

**Local data and the production id**: both `wrangler.jsonc` files keep `preview_database_id` at the
all-zeros id, so `next dev`, `npm run dev:relay` and every `--local` command keep the local database
they always had; wrangler prints that id in a deploy's binding list, but the upload uses
`database_id` (a deployed app reads the production data).

### Media (R2)

Needed before the first upload ships (Phase 5); local dev, the tests and CI never touch it. R2 must be
enabled on the account first (the dashboard may ask for billing details; the free tier still applies).
**Two buckets** (plan p05, D5.1): `memoria-media` holds what browsers fetch (display copies, thumbnails,
branding) and gets the public media domain; `memoria-originals` holds the uploaded originals and is
**private**: no public domain, no `r2.dev` URL, ever. Both are bound on both Workers (`MEDIA`,
`ORIGINALS`). The owner's checklist, in order:

1. **Buckets**, in the same location (`memoria-media` exists since the smoke deploy, `eeur`):
   ```sh
   npm run wrangler -- r2 bucket create memoria-media --location <hint>       # = wrangler.jsonc r2_buckets
   npm run wrangler -- r2 bucket create memoria-originals --location <hint>   # the same hint as memoria-media
   ```
2. **CORS** for both, after replacing the placeholder origin in both files with the production origin
   (`r2-cors.json` also gets the public media domain's site origin if pages are served from another one):
   ```sh
   npm run wrangler -- r2 bucket cors set memoria-media --file r2-cors.json
   npm run wrangler -- r2 bucket cors set memoria-originals --file r2-cors-originals.json
   ```
3. **The S3 API token**: Dashboard → R2 → **Manage API tokens → Create API token**, permission **Object
   Read & Write**, scoped to **`memoria-media` and `memoria-originals` only**. It shows an *Access Key ID*
   and a *Secret Access Key* once: `npm run wrangler -- secret put MEDIA_S3_ACCESS_KEY_ID` and
   `npm run wrangler -- secret put MEDIA_S3_SECRET_ACCESS_KEY`. Then `MEDIA_S3_ENDPOINT` in `wrangler.jsonc`
   `vars` = `https://<account id>.r2.cloudflarestorage.com` (presigned URLs work only there, not on a
   custom domain).
4. **The public media domain, on `memoria-media` only**: R2 → `memoria-media` → Settings → Custom
   Domains (e.g. `media.<domain>`), its DNS, then `MEDIA_PUBLIC_BASE_URL` in `vars`. **This var and
   `MEDIA_S3_ENDPOINT` are baked into the pages' Content-Security-Policy at `next build`** (`connect-src`,
   `img-src`): changing either needs a rebuild and a deploy, not only a var change or a dashboard edit.
5. **`MEDIA_S3_BUCKET` and `MEDIA_S3_ORIGINALS_BUCKET`** in `vars` stay `memoria-media` and
   `memoria-originals` (the guard checks they match `r2_buckets`).
6. **Deploy the relay, then the app** (`npm run deploy:relay`, `npm run deploy`).
7. **Check from a browser once** (plan Phase 1, Verification 5; Phase 5, Verification 4): a presigned PUT
   and GET against each bucket with the CORS rules, `response-content-disposition`, and that a PUT with
   another Content-Type fails. (`npm run media:probe -- <url> [--originals]` checks the same round trip
   locally, through the development routes.)

- Without all five S3 settings (the endpoint, both buckets, the key pair), every upload/download URL
  fails with `MEDIA_NOT_CONFIGURED` (503): there is no fallback in production. The `/api/blobs/*` routes
  answer 404 there (they need `NEXTJS_ENV=development`, which only `.dev.vars` sets; the guard keeps it
  out of `vars`).

## How a change ships

GitHub Actions (`.github/workflows/ci.yml`) is the only CI.

1. Push to `master` or a pull request → `check`: `npm ci`, `ts-check`, `test`, `build:worker`
   (plus an informational `npm audit`).
2. Deploy is **manual**: Actions → CI → Run workflow on `master` with `deploy` ticked → `check`, then
   `npm run db:migrate:remote`, then `npm run deploy`. Manual by design — a push never goes live by
   itself, and nothing in CI touches Cloudflare unless you run it (the `check` job uses no
   credentials). It works only after the first deploy from a terminal (One-time setup) has created the D1
   and its `database_id` is in `wrangler.jsonc`.

### Migrations run before the code

The new code goes live only after its migrations are applied, so for a moment the OLD code runs
against the NEW schema. Every migration must be safe for the code that is still running: add
tables/columns (nullable or with a default) first; drop or rename only in a later release, once no
deployed code reads them.

**Rehearse a migration that changes existing data's tables** (first: `0006`, Phase 5) against a copy of
production before `db:migrate:remote`:

```sh
npm run wrangler -- d1 export DB --remote --output=rehearsal.sql          # written to apps/web/; client data: delete it after
cd apps/web
npx wrangler d1 execute DB --local --persist-to ../../.rehearsal --file=rehearsal.sql   # a scratch local D1, not your dev one
npx wrangler d1 migrations apply DB --local --persist-to ../../.rehearsal               # the new migrations on real data
```

Only when that applies cleanly, run `npm run db:migrate:remote`. Rollback is a forward fix (a new
migration); Time Travel (*Rollback*) restores the data if one went wrong. Delete `rehearsal.sql` and
`.rehearsal/` afterwards. (Local `--persist-to` commands never touch Cloudflare, so plain `npx wrangler`
is fine for them.)

### Preview versions

There is no CI preview job. `npm run wrangler -- versions upload` (after `npm run build:worker`)
makes a new version that is NOT live, on its own preview URL. **A preview version uses the production
bindings** — the same D1. Use it only for changes that do not
write data and need no unapplied migration.

## CI variables

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → Workers & Pages → Account details |
| `CLOUDFLARE_API_TOKEN` | an **account** API token, `memoria-ci` (*Cloudflare credentials*, step 4): Workers Scripts: Edit, D1: Edit, Workers R2 Storage: Edit, Account Settings: Read |

App secrets are NOT CI variables: they live in Cloudflare (`wrangler secret put`).

## Secrets

Never in `wrangler.jsonc`, the repo or CI. Each is documented in `apps/web/.dev.vars.example` and set
in production with `npm run wrangler -- secret put <NAME>`; `npm run wrangler -- secret list` shows
which exist. Setting a secret deploys a new version.

| Secret | What |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | the Turnstile widget's secret (its site key is the `TURNSTILE_SITE_KEY` var) |
| `ADMIN_PASSWORD_HASH` | development and a first install only (`npm run admin:hash-password`): the account lives in D1 (`admin:mfa -- password`). Delete it once a D1 account exists |
| `HASH_SALT` | a long random string; hashes IPs for rate limits (missing → logged `hash_salt_missing`) |
| `TOTP_ENCRYPTION_KEY` | `npm run admin:mfa -- key` (32 random bytes): encrypts the authenticator secrets, keys the recovery codes. Missing → sign-in answers 503. Changing it disables every authenticator: reset (below) |
| `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | the R2 API token scoped to the two buckets (One-time setup → Media) |
| `SETTINGS_ENCRYPTION_KEY` | **both Workers, the same value**: `npm run admin:mfa -- key --settings`, then `secret put` without and with `-c ../relay/wrangler.jsonc`. Encrypts the mail password or key saved in Settings → Emails and every gallery password (Phase 5). Changing it = enter the mail secret again, **set every gallery password again**, and every gallery access cookie ends (Phase 6) |

`MEDIA_DEV_SIGNING_SECRET` is local only (it signs the development blob routes): never set it in
production. So are `MAIL_FROM` and `SMTP_*` (the Mailpit fallback, *Email → Locally*).

## Email

The photographer chooses how email is sent in Settings → Emails (Phase 3 commit 4): their own SMTP
server, Brevo, Amazon SES or Microsoft 365. The relay sends; the app only queues
([architecture.md → Email](architecture.md#email-phase-3)). First set `SETTINGS_ENCRYPTION_KEY` on both
Workers (*Secrets*).

**The sending domain** (the From address's) must be verified at the provider, with its DNS records:
the provider's **DKIM** keys (DMARC passes through DKIM aligned with the From domain, since providers
rewrite the envelope sender), its SPF include, and a DMARC record (`v=DMARC1; p=none` to start).

| Provider | What to create there |
| --- | --- |
| SMTP server | The host, port 587 (STARTTLS) or 465 (TLS), a username and an **app password** (Gmail and others refuse the account password: `SMTP_534`). Hosts are DNS names; the certificate must match. |
| Brevo | An API key (SMTP & API → API keys). **Turn IP allow-listing off** (Security → Authorised IPs): Workers have no fixed IPs (`BREVO_401`/`403`). The free tier sends 300 a day. |
| Amazon SES | The domain identity verified (DKIM), **production access** requested (the sandbox only sends to verified addresses, 200 a day), an IAM user whose only permission is `ses:SendEmail` on that identity, its access key. The region in Settings is the identity's. |
| Microsoft 365 | An Entra app registration with a client secret; the application permission `Mail.Send` granted **only through RBAC for Applications in Exchange Online** on the sending mailbox (remove any tenant-wide grant); up to 2 hours to take effect. Graph keeps a copy in the mailbox's Sent Items. |

**Runbooks**

- *An email did not arrive*: Settings → Emails shows its status and reason; `npm run wrangler -- tail
  memoria-relay` shows `job_retry` / `job_failed` with the code (never the address).
- *A permanent failure that is really configuration* (SMTP "sender not verified", SES
  `MessageRejected` for an unverified From): fix it at the provider, then Retry the email.
- *Rotating the provider's secret*: create the new one, enter it in Settings → Emails, then revoke the
  old one. Queued emails use the new one on their next attempt.
- *`SETTINGS_ENCRYPTION_KEY` lost or changed*: emails fail `MAIL_SECRET_UNREADABLE` and retry; enter
  the secret again in Settings → Emails, then Retry the failed ones. Two-factor is unaffected.
- *A stuck queue*: `npm run wrangler -- d1 execute DB --remote --command "SELECT id, kind, status,
  attempts, run_after, last_error FROM jobs WHERE status IN ('pending','running') ORDER BY run_after
  LIMIT 20"`. Pending jobs due long ago mean the relay is not running: check that it is deployed and its
  cron is listed (Workers & Pages → memoria-relay → Settings → Triggers).

**Locally**: run [Mailpit](https://mailpit.axllent.org/) (`docker run -d --rm --name mailpit -p
1025:1025 -p 8025:8025 axllent/mailpit`; the inbox is http://localhost:8025). With no provider saved,
the `.dev.vars` fallback (`MAIL_FROM`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_SECURITY=none`,
in `apps/relay/.dev.vars` copied from its example; the app needs the same lines in `apps/web/.dev.vars`
to show email as set up) sends there. Start `npm run dev:relay`, then Settings → Emails → Send test
email. Without the app (a relay-only check), queue one by hand from `apps/web`:

```sh
NOW=$(node -e "console.log(new Date().toISOString())"); ID=$(node -e "console.log(crypto.randomUUID())")
npx wrangler d1 execute DB --local --command "INSERT INTO jobs (id, kind, payload, status, priority, attempts, max_attempts, run_after, created_at, updated_at) VALUES ('$ID', 'email', '{\"v\":1,\"template\":\"test\",\"to\":{\"email\":\"you@example.com\"},\"params\":{\"queuedAt\":\"$NOW\"}}', 'pending', 0, 0, 1, '$NOW', '$NOW', '$NOW');"
```

The relay's 10-second loop sends it; the job ends `done` (`SELECT status, last_error FROM jobs`).
To see a `535`, start Mailpit with `--smtp-auth-file` and a wrong `SMTP_PASSWORD`. A provider saved
in Settings → Emails cannot point at Mailpit (a saved SMTP host must be a public DNS name with a valid
certificate): try the HTTPS providers with their free tier or sandbox instead.

## Two-factor sign-in

Signing in to `/admin` takes the password, then a 6-digit code from an authenticator app or a
one-time recovery code ([architecture.md → Admin](architecture.md#admin)). The developer's controls,
run from the repo root (local D1 by default, `--remote` for production with *Cloudflare credentials*; a
remote run says what it will do and asks you to type the command's name, or pass `--yes`):

| Command | When |
| --- | --- |
| `npm run admin:mfa -- password [--email <address>] [--remote]` | First install, or a forgotten password: stores a generated password (and the email; required while there is no account), signs out every device, prints both once. The photographer is asked to choose their own. Authenticators stay. |
| `npm run admin:mfa -- setup [--remote]` | No authenticator yet (first sign-in): prints a setup code, valid 1 hour. Refused once one exists. |
| `npm run admin:mfa -- reset [--remote]` | Phone and recovery codes lost, or a changed `TOTP_ENCRYPTION_KEY`: removes every authenticator, recovery code and session (everyone is signed out) and prints a new setup code. |
| `npm run admin:mfa -- unlock [--remote]` | "Sign-in is locked": 20 wrong codes in a UTC day lock sign-in until midnight UTC; this clears it (and the sign-in rate limits). |
| `npm run admin:mfa -- list [--remote]` | What is registered: apps, recovery codes left, live sessions, a live setup code, wrong codes today. |
| `npm run admin:mfa -- key [--settings]` | A new `TOTP_ENCRYPTION_KEY` (no database); with `--settings` a `SETTINGS_ENCRYPTION_KEY` (*Secrets*). |

The photographer changes the email and password in Settings → Security → Your sign-in (a code
first, then the current password). A new password signs out every device; authenticators stay. The
sign-in needs `TOTP_ENCRYPTION_KEY` on the Worker as well: the CLI cannot read a remote secret, so it
only reminds you.

## Rollback

- **Code**: `npm run wrangler -- rollback` (or Dashboard → Worker → Deployments). Instant;
  does not touch data.
- **Data**: D1 Time Travel restores the database to a point in time (7 days on the free plan):
  `npm run wrangler -- d1 time-travel info DB`, then
  `npm run wrangler -- d1 time-travel restore DB --timestamp=<ISO time>`. This rewinds every write after that
  time — export first (`npm run wrangler -- d1 export DB --remote --output=backup.sql`).
- A migration is never "rolled back" by editing it: write a new migration that undoes it.

## Backups

Time Travel (7 days) plus a SQL export **when you run it**: Actions → Backup → Run workflow
(`.github/workflows/backup.yml`; nothing is scheduled, you decide when anything touches Cloudflare).
It exports the D1 (an export briefly blocks other queries; it never overlaps a deploy), gzips the dump,
**encrypts it with a passphrase** (AES-256, `gpg --symmetric`) and keeps it as a workflow artifact for
90 days. Run it before every deploy with a migration, and now and then.

**Before the first run** (after the first `db:migrate:remote`): the repository secrets of *CI
variables* plus `D1_BACKUP_PASSPHRASE`, a long random string (`openssl rand -base64 32`). Keep a copy
outside GitHub (a password manager): without it no backup can be read. Check that the artifact
`d1-<run id>` appears; download one now and then and keep it outside GitHub.

Without GitHub: `npm run wrangler -- d1 export DB --remote --output=backup.sql` (written to
`apps/web/`; it holds client data: keep it encrypted, never commit it).

**Restore** (rehearse once into a scratch database):

```sh
gpg --decrypt --output d1.sql.gz d1.sql.gz.gpg   # asks for D1_BACKUP_PASSPHRASE
gunzip d1.sql.gz
npm run wrangler -- d1 create memoria-restore-test
npm run wrangler -- d1 execute memoria-restore-test --remote --file=../../d1.sql   # wrangler runs in apps/web
npm run wrangler -- d1 delete memoria-restore-test
```

To restore production itself, prefer Time Travel (Rollback) while within its 7 days; an export is for
older points or a lost database.

**R2 is not backed up.** Neither bucket is covered by the D1 export or Time Travel. `memoria-media` can
be rebuilt from the originals (Phase 5 M5's reprocess), but **`memoria-originals` is irreplaceable**, and
a deleted gallery's purge (7 days after the delete) is final. Options, the owner's choice (plan p05, open
question 11): keep the photographer's own copies (Lightroom catalogue, exports) as the backup; an
`rclone` copy of `memoria-originals` to an external store, run by hand like the D1 backup; R2 object
versioning or bucket replication once Cloudflare offers it on the plan.

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
(`npm run wrangler -- versions upload`, then `npm run wrangler -- versions deploy <live>@100% <new>@0%`).

## Logs

Workers Logs is on (`observability` in `wrangler.jsonc`): Dashboard → Worker → Logs (3 days on the
free plan). Live: `npm run wrangler -- tail`. The app logs JSON events — search by the
`event` field, e.g. `unhandled_route_exception` (its `reqId` is the one the user saw).
