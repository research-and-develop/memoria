---
title: Architecture
type: reference
updated: 2026-11-19
related: [../AGENTS.md, deployment.md, recipes.md, plans/202611/plan_202611_p01_core_adapters.md]
---

# Architecture

## Hosting: two Workers, Cloudflare free tier

```
browser ──► Cloudflare edge (custom domain)
              │
              ├─ static assets (.open-next/assets: /_next/static, public/)   free, unlimited, no Worker run
              │
              └─ Worker "memoria" (worker.ts)                               100k req/day, 10 ms CPU/req
                   ├─ edge routes (src/lib/edge)            /healthz and /g/* (galleries), before Next.js
                   │                                        loads (~1 ms CPU)
                   ├─ OpenNext: the Next.js server         pages, /admin, /api/** (imported lazily)
                   ├─ D1 "memoria" (binding DB)            settings, sessions, rate limits, audit
                   ├─ R2 "memoria-media" (binding MEDIA)   photos and branding files (used from Phase 5)
                   └─ Turnstile siteverify (fetch)         the login form
```

Public pages, the admin (`/admin`) and the API (`/api/**`) are routes of the same Next app.

### The gallery path (Phase 6)

Client galleries (`/g/<slug>`) never run Next: `worker.ts` calls `routeEdge(request, deps, next)`
(`src/lib/edge/routes.ts`), which answers `/healthz` and everything under `/g/`, and imports OpenNext
**lazily** (`await import('./.open-next/worker.js')`) only on the `next()` path, so a gallery request
on a fresh isolate never evaluates Next's module (that is why OpenNext's Durable Object classes are not
re-exported). A gallery page is **one static shell for every gallery**: `app/gallery-shell/` is
prerendered (`force-static`), and `build:app` (`opennextjs-cloudflare build`, then
`scripts/gallery-shell.mjs`) copies it with the 404 page into `.open-next/assets/__gallery/` and writes
a 503 page; the build fails when the shell or one of its markers (`src/lib/edge/gallery/markers.mjs`)
is missing. `worker.ts` fetches `/__gallery/shell` through `ASSETS` and (from Phase 6 commit 3)
injects the gallery's head, theme attributes and data; its responses set their own headers (the gallery
CSP profile, `Referrer-Policy: no-referrer`, `X-Robots-Tag`; `src/lib/edge/gallery/headers.ts`).
Anything else under `/g/` is the 404 page. Plan: [p06](plans/202611/plan_202611_p06_client_gallery.md).

**One static root layout**: `app/layout.tsx` (html, body, studio fonts, `viewport`) reads no D1, so
the shell under it can be prerendered. What reads config per request declares it:
`app/admin/layout.tsx` (`force-dynamic`, the title template, `getAppConfig`, `AppProvider` for the
panel and the sign-in page) and `app/page.tsx` (`force-dynamic`, the studio name as title).
`not-found.tsx` and `error.tsx` carry static titles.

### The relay Worker (Phase 3)

```
memoria (apps/web)  ── RELAY service binding: POST /run (a nudge) ──►  memoria-relay (apps/relay)
                                                                        no public URL (no workers.dev,
                                                                        no preview URLs, no routes)
                                                                        Cron Trigger every minute
D1 memoria  ◄────────────────────── shared ───────────────────────►   D1 memoria (never migrates it)
R2 memoria-media  ◄──────────────── shared ───────────────────────►   R2 memoria-media
```

The relay runs background jobs (email from Phase 3, later reminders, expiry, R2 cleanup). It runs the
**same domain code** as the app (`apps/web/src/lib/**`, the query modules, `@repo/*`), bundled by
wrangler with two aliases (`apps/relay/wrangler.jsonc` `alias`, mirrored by its tsconfig `paths`):
`@repo/platform/current` → `packages/platform-cloudflare/relay.ts`, and `server-only` → an empty
module. `relay.ts` is its composition root: each invocation runs inside `withPlatform(platform, fn)`
(an `AsyncLocalStorage`), so `getPlatform()` works in shared code exactly as under Next, and
overlapping invocations never see each other's env. Guard `relay-graph` walks every import the relay
reaches and refuses Next, React, OpenNext, `@repo/api` and `@repo/ui` (except `theme/`): shared code
the relay uses must use the `read*` settings functions, never the `perRender` (`get*`) ones.

Still planned: client galleries (Phase 6; `worker.ts` will also serve protected-mode images) and the
originals bucket (Phase 5). Build plan: [plans/202611/plan_202611_mvp.md](plans/202611/plan_202611_mvp.md).

## Layout

```
apps/web            Next.js 16 App Router app (pages, admin, HTTP API) + wrangler/OpenNext config
apps/relay          the relay Worker: src/index.ts (fetch POST /run + scheduled), its wrangler.jsonc,
                    tsconfig and generated relay-env.d.ts; no package.json, no code of its own
packages/logger     structured logger + redaction       — leaf, zero deps
packages/core       AppError, validation, url helpers    — depends on nothing
packages/api        HTTP envelope + route error boundary — core, logger, next
packages/platform   the ports, config parsing, media rules, blob tokens/URLs, memory store, contract
                    suites, test platform; current.ts = the composition root — core, logger, aws4fetch
packages/platform-cloudflare  D1/R2 adapters, cloudflarePlatform, the OpenNext wrapper (next.ts),
                    the relay's composition root (relay.ts) — platform,
                    @opennextjs/cloudflare, wrangler (tests)
packages/db         the database layer on the Db port: statements, batch, row converters, migrations,
                    test harness — platform
packages/ui         theme (theme/studio.mjs: every design value), primitives, typography, cn, useApi, Tailwind preset — core, react, tailwind-merge
migrations/         authoritative D1 schema (SQL), wrangler-numbered
scripts/guards/     repo-wide rules as tests
```

Dependencies point down that list; a package never imports an app. A second app (a separate admin,
a marketing site) is `apps/<name>` with its own tsconfig (`@/` means one directory per tsconfig),
its own entry in the guards' `SOURCE_INDEX_ROOTS`, and the same packages.

## Platform layer

Domain code (routes, `src/lib/**`, query modules) never touches Cloudflare. It asks the platform:

```
domain code ──► getPlatform()   (@repo/platform/current, the composition root)
                  ├─ db()      Db         all / first / run / batch on plain { sql, params }
                  ├─ blobs()   BlobStore  put / get / head / delete / list
                  ├─ config()  Config     parsed from string env by parseConfig (pure, never throws)
                  ├─ defer(p)  work after the response; a rejection is logged as deferred_task_failed
                  └─ jobs()    Jobs       nudge(): wake the relay (POST /run through RELAY; a hint)

@repo/platform/current ──► @repo/platform-cloudflare/next    in Next: getCloudflareContext() per call,
                             │                               one platform per env, kept on globalThis
                             └─► cloudflarePlatform(env, waitUntil): d1Db(env.DB), r2BlobStore(env.MEDIA)
vitest aliases it to ──► @repo/platform/testing              a test D1, an in-memory BlobStore, your env
```

- **Ports** are in `packages/platform/ports.ts`. Each has a **contract suite** in
  `packages/platform/contract/` that every adapter runs: D1 and R2 in workerd (through wrangler's
  `getPlatformProxy`), the in-memory store in Node. `Mailer` is not a platform method: only the relay
  sends, and its entry hands the mailer to the job runner (`memoryMailer` and `unconfiguredMailer` today,
  the provider adapters from Phase 3 commit 3).
- **Worker entries outside Next** (`worker.ts`, the relay) call `cloudflarePlatform(env, ctx.waitUntil)`
  themselves; only Next code goes through `getPlatform()`, which exists only inside a request.
- **The boundary is a guard**, `platform-boundary`: outside the adapters, the composition root, the
  test harness and the Worker's own config files, nothing imports `@opennextjs/cloudflare`, `wrangler`,
  `@repo/platform-cloudflare` or `cloudflare:*`, calls `getCloudflareContext()` or names a Cloudflare
  runtime type (the generated Workers types are global, so `tsc` cannot enforce it).

### Media

**Two buckets** (Phase 5, D5.1):

| Bucket | Binding | Holds | Reached by |
| --- | --- | --- | --- |
| `memoria-media` | `MEDIA` | display copies, thumbnails, branding (the watermark, later logos) | the public media domain (`publicUrl`), presigned PUTs |
| `memoria-originals` | `ORIGINALS` | the uploaded originals (location data stripped in the browser) | presigned PUTs; short-lived presigned GETs for downloads (Phase 9); **never a public domain** |

`getPlatform().blobs(bucket)` returns one `BlobStore` per bucket (`media` by default); `blobUrls`
takes `{ bucket }` on `uploadUrl` and `readUrl` (S3: the bucket in the path; dev: the token's `b`, from
which the dev routes pick the binding) and `publicUrl` refuses `originals`. No URL guessed or edited
from a display copy can reach an original. Signing keys are cached per access key on `globalThis`
(D5.25): an upload batch signs 30 URLs with one key derivation.

`blobUrls(config)` (`@repo/platform/blobUrls`) mints every URL a browser uses for a stored file. Its
mode follows the config:

| Mode | When | Upload | Download |
| --- | --- | --- | --- |
| `s3` | all five `MEDIA_S3_*` set (production) | presigned PUT straight to R2's S3 endpoint; the Content-Type is signed | presigned GET with `response-content-disposition` |
| `dev` | `NEXTJS_ENV=development` and `MEDIA_DEV_SIGNING_SECRET` | `PUT /api/blobs/upload?t=…` (buffered, ≤ 32 MB) | `GET /api/blobs/read?t=…` |
| `none` | otherwise | `MEDIA_NOT_CONFIGURED` (503) | `MEDIA_NOT_CONFIGURED` (503) |

- Uploads never pass through a Next route in production: OpenNext buffers request bodies in a 128 MB
  isolate. The dev routes do, which is why they are capped and answer 404 outside development.
- Every key is generated by server code under `galleries/`, `branding/` or `dev/` (`isBlobKey`), and
  only `image/jpeg`, `image/png` and `image/webp` are minted. Size (≤ 100 MB) and expiry (≤ 15 min)
  are checked at minting; a presigned PUT cannot enforce the size, so registering an upload re-checks
  it with `head()` (Phase 5).
- **Gallery images are served by neither mode.** Presigned GETs are unique per call (no CDN cache)
  and are for downloads. Public galleries use the public media domain (`publicUrl`, an R2 custom
  domain); protected ones go through `worker.ts`, which answers before Next loads and so sets its own
  security headers. Phase 1's check in `npm run preview` showed why that matters: in a Next route, the
  site-wide `Content-Security-Policy` and `Referrer-Policy` from `next.config.mjs` replace the route's
  own (the dev read route's `sandbox` CSP and `no-referrer` never reach the browser).
- **The CSP carries the media origins** (Phase 4, `lib/security/headers.mjs`). `next.config.mjs` reads
  `MEDIA_PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT` from `wrangler.jsonc` `vars` **at build time**, so
  changing either needs a rebuild and deploy (guard `wrangler-config`: both are bare origins or empty).
  Two profiles of `securityHeaders({ dev, profile, media })`: **studio** (every Next response) adds the
  media domain to `img-src` and `connect-src` and the S3 endpoint to `connect-src` (presigned PUTs from
  the browser); **gallery** (Phase 6's `worker.ts` responses) is the studio policy without the
  Cloudflare beacon and the S3 endpoint, keeping Turnstile and `'unsafe-inline'` scripts. Locally the
  dev routes are same-origin and need neither.
- **Reading an image back in the studio** (the watermark, later logos) uses `publicUrl` in production
  and the dev read route in development, never a presigned GET (`watermarkImageUrl`,
  `lib/settings/watermark.ts`); without a public media domain an image watermark cannot be chosen.
- Browser-side image code lives in `apps/web/src/lib/images/`: `watermark.ts` (`watermarkBox`,
  `applyWatermark`: the same function previews the watermark and, from Phase 5, bakes it in the upload
  worker) and `upload.ts` (`putToSignedUrl`, a PUT with progress).

### Upload (Phase 5)

Photos never pass through the Worker: the browser processes them and PUTs straight to R2.

1. **In the browser** (`lib/images/`, a pool of module Web Workers, ≤ 80 decoded megapixels in flight):
   sniff the type from the bytes; SHA-256 of the file as dropped; remove the location losslessly
   (`metadata/`: GPS, MakerNote, the embedded thumbnail, XMP and free-text tags out, IPTC whitelisted,
   the JPEG rebuilt from a segment allow-list; an unknown structure is refused); decode upright; draw
   the display copy and the thumbnail (halving steps); bake the gallery's watermark snapshot; encode
   WebP (JPEG where the browser cannot); the placeholder colour.
2. **Register** (`POST /api/admin/galleries/[id]/uploads`, ≤ 10 photos): one `uploading` row per new hash
   (`INSERT … ON CONFLICT (gallery_id, sha256) DO NOTHING`), a re-mint for an unfinished one (same id
   and `rev`, so the new PUTs overwrite), `duplicate` for a finished one; three presigned PUTs each,
   10 minutes: the original to **`memoria-originals`**, the thumbnail and display copy to `memoria-media`.
3. **PUT** ×3 per photo, 4 in parallel, from the browser.
4. **Complete** (`…/uploads/complete`, ≤ 8 photos): `head()` the three objects (present, the declared
   sizes and types; a mismatch deletes them), then ONE batch marks them ready, adds them to their sets'
   counts, recounts the gallery, picks a cover if none and bumps `content_version` if anything changed.

Re-dropping the same files resumes an interrupted upload; an upload left `uploading` for 24 hours is
purged (`media.purge`, Phase 5 commit 6).

### The Docker path (documented, not built)

A Node build would add `packages/platform-node`: a SQLite `Db` (`node:sqlite` or `better-sqlite3`) that
runs the same `migrations/` and wraps `batch` in `BEGIN`/`COMMIT`; an S3/MinIO `BlobStore`;
`process.env` as config; `defer` as a tracked promise. The composition root points at it by aliasing
`@repo/platform/current` in `next.config.mjs` (`turbopack.resolveAlias`), as vitest already does, and
each adapter must pass the contract suites. Unproven: the alias, `next start` with
`output: 'standalone'`, and the cheap paths `worker.ts` answers today are to be verified in that phase.

## Configuration

| Where | What | Read by |
| --- | --- | --- |
| `apps/web/wrangler.jsonc` | bindings, plain `vars`, compatibility flags | wrangler, OpenNext, the test harness |
| `apps/web/r2-cors.json` | the media bucket's CORS rules | `wrangler r2 bucket cors set` (deployment.md → Media) |
| `apps/web/.dev.vars` (local) / `wrangler secret put` (prod) | secrets | merged into the env |
| `apps/web/cloudflare-env.d.ts` | generated `CloudflareEnv` type | tsc (guard: `wrangler-config`) |

All of it reaches domain code as `getPlatform().config()`, parsed by `parseConfig`
(`packages/platform/config.ts`); only the Cloudflare adapters read the raw env. `next dev` gets the
same env through `initOpenNextCloudflareForDev()` in `next.config.mjs` (local D1 and R2 state in
`apps/web/.wrangler/`).
Client components never read env: the root layout reads `getAppConfig()` on the server and hands the
public values down through `AppProvider`.

### Two kinds of settings (Phase 2b)

- **Deploy-level**, set once by whoever deploys, env only: `TOTP_ENCRYPTION_KEY`, `HASH_SALT`, the
  Turnstile keys, the R2/S3 token and endpoint, `MEDIA_PUBLIC_BASE_URL`, `LOG_*`, the bindings. The
  secrets that protect the data stay out of the database they protect.
- **Studio-level**, the photographer's, in D1 and edited in Settings: the sign-in email and password
  (`admin_account`, Settings → Security), the studio name and website address (the `studio` row of
  `site_settings`, Settings → Studio); email delivery (the `mail` row, Phase 3); the gallery look and
  the watermark (Phase 4: the `branding`, `gallery_defaults` and `watermark` rows; the time zone in M2).

**Effective value = D1, else env, else the default.** The env values that are only defaults live in
`Config.bootstrap` (`appName`, `siteUrl`, `adminEmail`, `adminPasswordHash`) and are read only by
`lib/settings/**` and `lib/auth/account.ts` (guard `settings-through-store`): `readStudio()` /
`getStudio()` and `readAdminAccount()` / `getAdminAccount()`. The `get*` forms are read once per
server render (`perRender`, `React.cache` where it exists); the `read*` forms take no React, for route
handlers and the relay. `readStudio()` never throws: a D1 error or an invalid row logs
`studio_settings_unavailable` / `studio_settings_invalid` and uses the defaults. Deleting a D1 row (an
old backup restored) makes the env value effective again, hence deleting the env credentials after the
first install (deployment.md → One-time setup).

Phase 4's rows have **no env default**: `readBranding()`, `readGalleryDefaults()` and `readWatermark()`
(`lib/settings/`, each with a `*.cached.ts` form) return the row, else the built-in default, through
`readSettingRow` (never throws; logs `<key>_settings_unavailable` / `<key>_settings_invalid`). A new
gallery copies them at creation (Phase 5); nothing reads them for an existing gallery. In M1 only the
watermark has a screen and a write route (Settings → Watermarks); Branding and Galleries come in M2.

## Request lifecycle (API)

1. `withErrorHandling` wraps the handler — the one error boundary.
2. Admin routes: `requireAdmin` checks same-origin for writes (CSRF), then the session cookie, and
   answers 403/401 before the body is read. Public write routes (today the login): same-origin,
   Turnstile, rate limit — all before any write.
3. The body is parsed defensively and validated by a pure helper (shared with the form).
4. A domain function writes through query modules; a change and its audit row go in one D1 `batch()`.
5. Success → `{ data }`. An `AppError` → its status and `{ error, errorCode, details }`. Anything
   else → a logged 500 with a `reqId`, its message filtered by `publicErrorMessage` (D1/SQLite
   diagnostics are replaced, never shown).

## Admin

One admin. The sign-in email and password hash live in the one-row `admin_account` table (Phase 2b:
[plan](plans/202611/plan_202611_p02b_settings_db.md)); without a row, `ADMIN_EMAIL` /
`ADMIN_PASSWORD_HASH` are used (development, or before the first `admin:mfa -- password`). Passwords
are PBKDF2-SHA256 in Web Crypto, iterations measured against the 10 ms CPU budget. Two-factor needs
the `TOTP_ENCRYPTION_KEY` secret. No account, or no key = sign-in answers 503 (`ADMIN_NOT_CONFIGURED`
says only "Sign-in is not set up yet", after the rate limit, the lockout and Turnstile). Signing in
takes the password **and** a second factor (Phase 2: [plan](plans/202611/plan_202611_p02_admin_totp.md)).

```
/admin/login  step 1  POST /api/admin/login         same-origin → rate limit → lockout → Turnstile → email + password
                                                     → a challenge (D1 row + its own httpOnly cookie, 10 min, 5 attempts)
              step 2  POST /api/admin/login/verify  a code from any authenticator app, or a recovery code → the session
first time    step 2  POST /api/admin/login/setup   the setup code from `npm run admin:mfa -- setup` → a QR code
              step 3  POST /api/admin/login/verify  the new app's first code + its name → app, 10 recovery codes, session
```

- **Codes**: TOTP (RFC 6238: SHA-1, 6 digits, 30 s, one step of drift), every app and step checked
  in constant time. Each app stores its last used step and a code is accepted only for a later one, in
  the same batch that creates the session (`lib/auth/secondFactor.ts`): one code, one session. A
  replayed code answers `CODE_ALREADY_USED` and is not a failure.
- **At rest**: app secrets are AES-GCM under a key derived (HKDF) from `TOTP_ENCRYPTION_KEY`, bound to
  their row; recovery codes are stored as HMACs, setup codes as SHA-256. A D1 export alone reveals
  nothing usable (`lib/auth/twoFactorKeys.ts`).
- **First enrolment** needs the setup code (100 bits, 1 hour), so the password alone never grants the
  admin. The setup code is spent only together with the enrolment, in one batch.
- **Lockout**: 20 wrong codes (sign-in, recovery or setup) in a UTC day lock sign-in until midnight
  UTC, checked before the password; audited once. Plus per-IP and overall code rate limits.
- **The developer is in charge**: `npm run admin:mfa -- password|setup|reset|unlock|list|key [--remote]`
  ([deployment.md → Two-factor sign-in](deployment.md#two-factor-sign-in)).
- **Sessions**: a random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie, created only after the
  second factor; D1 stores its SHA-256 and how it signed in (which app, or a recovery code). Over HTTPS
  only the `__Host-` cookie is read, on plain http only the plain name (`isSecureRequest`, one rule for
  routes and pages). A session ends after 14 days without use and at most 90 days after sign-in (the
  cookie lives 90 days; `expires_at` is refreshed at most hourly, since a write per request would burn
  the write budget). Each session records a fingerprint of the password hash, so a new password ends
  every session (the same hash, e.g. the first save of an env account into D1, ends none).
- **Your sign-in** (Settings → Security): change the email or the password (Generate offers one).
  Order of checks: the rate limits are counted first (5 an hour per session, 20 overall), then a code
  in the confirm window (below; without one the password is never looked at), then the current
  password. Five wrong passwords on one session end it, like five wrong codes. A new password ends
  every session and challenge, this one too; a new email ends nothing. The card warns when the
  password was set by `admin:mfa -- password` (`set_by = 'cli'`) or `ADMIN_PASSWORD_HASH` is still set.
- **Settings → Studio** (`/admin/settings/studio`, the first section): the studio name (page titles,
  the admin, new authenticator apps' labels, later the emails) and the website address (canonical URLs,
  `robots.txt`, later the links in emails). A bare domain is saved as an `https://` origin; a "Check it
  opens" link goes to its `/healthz`. A new address needs a code; a new name does not.
- **Settings → Security** (`/admin/settings/security`): authenticator apps (add with a QR code,
  rename, remove; at most 10, never the last), recovery codes (how many are left; new ones replace
  the set), signed-in devices (sign out one, or all the others). Removing an app signs out the
  devices it signed in; new recovery codes sign out the devices that used an old one.
- **Confirm with a code**: those changes (except signing out this device) need a code entered on this
  session in the last 5 minutes (`admin_sessions.verified_until`, NULL after sign-in; the API answers
  `403 SECOND_FACTOR_REQUIRED`, the page asks for a code and retries once: `SecondFactorProvider`).
  Wrong codes count toward the lockout, and five on one session end it (`lib/auth/confirm.ts`).
- **Settings → Emails** (`/admin/settings/emails`, Phase 3): how email is sent (the provider, its
  credentials, From, reply-to; saving needs a code, the secret is sealed and never shown again), a test
  email with its live status, the security-email switch (off needs a code and sends one last notice),
  and the last 20 emails with their reason and Retry on a failed one. A banner says when emails have
  waited more than 10 minutes untried (the relay is not running). Logic: `lib/email/admin.ts`.
- **Security notices** (D3.19): a new sign-in, an authenticator added or removed, new recovery codes, a
  recovery code used to confirm, the email (to the old and the new address) or the password changed,
  the mail settings changed (sent through the PREVIOUS settings, a sealed snapshot in the job's `via`),
  notices turned off, sign-in locked. Each is an `email` job in the event's own batch, written only if
  the event happened (`securityNotices()` in `lib/email/notices.ts` → a conditional insert); none when
  notices are off or email is not set up. The lockout notice is a separate write by the one request
  that reaches the limit (ordinary wrong codes read nothing extra). The CLI sends none.
- **Gate**: `app/admin/(panel)/layout.tsx` redirects pages; every admin API route calls `requireAdmin`
  itself (a page gate never protects an API). Guard: `admin-routes-require-admin`.

## Jobs (Phase 3)

Background work is a row in the D1 `jobs` table (`migrations/0005_jobs.sql`), never a floating promise
and never a Cloudflare Queue (portable, listable, retryable by the admin).

```
route ──► batch([change, audit, jobStatement(kind, payload).statement])   all or nothing
      └─► nudgeRelay()  = defer(jobs().nudge())  ── RELAY ──► relay POST /run → 202, drain in waitUntil
relay cron (every minute) ──► enqueuePeriodicJobs(scheduledTime), then the same drain
drain (lib/jobs/runner.ts): expire leases → claim → kind.run(payload, ctx) → done / retry / failed
```

- **Claim with a lease, fence with the attempt.** One `UPDATE … WHERE id = (SELECT … LIMIT 1) …
  RETURNING` claims the next due job (priority, then `run_after`), counts the attempt and sets a 2-minute
  lease. Every finishing write has `WHERE id = ? AND status = 'running' AND attempts = ?`, so a runner
  whose lease was taken over writes nothing (`job_lease_lost`). A dead runner's job comes back 10 minutes
  after its lease (`LEASE_EXPIRED`, then `job_reclaimed`).
- **One job per invocation** (nudge or cron), within 20 s: the free plan's 10 ms CPU covers the whole
  invocation. A handler gets an `AbortSignal` and a cap; one that ignores it cannot hold the runner.
- **Retries**: a `JobError`/`MailError` with `permanent` fails at once; anything else retries on the
  kind's backoff (minutes; a provider's `Retry-After` up to an hour) until `max_attempts`. An unknown
  kind or a newer payload `v` (a deploy in progress, a rollback) waits 10 minutes without spending an
  attempt and fails `UNKNOWN_KIND` after a day. Housekeeping (daily from 03:00 UTC) fails jobs due for 7
  days (`EXPIRED`) and deletes finished ones after 30.
- **Privacy**: logs carry job ids, kinds and codes only; a finished job drops its `params`; an unknown
  error keeps only its name.

## Email (Phase 3)

Only the relay sends. An email is an `email` job (`lib/email/job.ts`): `{ template, to, params }`,
rendered **when it is sent** with the studio name and address of that moment, then handed to the mailer
of the configured transport. The job id is the `Message-ID`, the same across retries.

```
emailJobStatement({ template, to, params, now })  → in the batch of its cause, then nudgeRelay()
relay: readMailSetup() → { from, replyTo, transport }        lib/settings/mail.ts
       renderEmail(template, params, emailContext(studio))   lib/email/templates (pure)
       ctx.mailerFor(transport).send(message, { signal })    packages/platform/mail/transport.ts
```

- **Four adapters, one `Mailer` port** (`packages/platform/mail/`, platform-neutral, each run through
  the contract suite `contract/mailer.ts`): `smtp.ts` (our client over an `SmtpSocket`; STARTTLS on
  587/2525 or TLS on 465, the certificate checked, `AUTH PLAIN` only after TLS; Cloudflare's sockets in
  `packages/platform-cloudflare/smtp.ts`), `brevo.ts`, `ses.ts` (raw MIME, SigV4) and `microsoft365.ts`
  (Graph, client credentials, raw MIME). `mime.ts` builds the message (RFC 2047 names and subjects,
  quoted-printable parts) and refuses any header text with a control, separator or bidi character, and
  any address `@repo/core/email` does not accept: nothing can be injected.
- **Errors**: a `MailError` with an enumerated `code` (`SMTP_550`, `BREVO_401`, `SES_MessageRejected`,
  `GRAPH_403`, …), `permanent` (a rejected recipient), `configuration` (credentials: retried and logged
  as an error) and a masked `detail` (`mask.ts`: every address, the configured ids and secrets) stored in
  `jobs.last_error` for the admin, never logged.
- **Mail settings** (`site_settings` row `mail`, `lib/settings/parseMailSettings.ts`): the provider, its
  fields, the From address and name (default: the studio name), a reply-to. The provider's secret is
  sealed with AES-GCM under a key derived from `SETTINGS_ENCRYPTION_KEY` (both Workers; not the two-factor
  key), additional data `mail.<provider>.<field>` (`lib/settings/secrets.ts`). Without a row,
  development falls back to `MAIL_FROM` + `SMTP_*` (`Config.bootstrap.mail`: Mailpit). A key that does
  not open the secret fails the job `MAIL_SECRET_UNREADABLE` (retried; enter the secret again).
- **Templates** (`lib/email/templates/`): pure `render(params, ctx)` → `{ subject, text, html }` in the
  shared layout (`layout.ts`: inline styles, the studio theme's colours through `tokenHex`, every value
  escaped). Links only through `ctx.link(path)` = the website address + a path.
- **Retries**: 6 attempts after 1, 5, 30, 120, 480 minutes; the test email gets one. A sent email
  drops its `params` and `via`; a failed one keeps them so the admin can Retry it (pruned after 30 days).

## Data

D1 is SQLite: no interactive transactions (atomicity = `batch()`), `?` placeholders, TEXT ids and
ISO-8601 timestamps. Statements are plain data (`statement(sql, params)`) run through the `Db` port.
The schema lives in `migrations/`; `packages/db/test-utils.ts` applies the same files to an in-memory
D1 for tests. Rules: [AGENTS.md → Data rules](../AGENTS.md#data-rules-d1--non-negotiable).

| Table | What |
| --- | --- |
| `site_settings` | one JSON document per key (the reference query module) |
| `audit_log` | one row per admin change, in the change's batch |
| `admin_sessions` | hashed session tokens, how each signed in |
| `admin_authenticators` | authenticator apps: label, encrypted secret, last used step |
| `admin_recovery_codes` | HMACs of the recovery codes, used / acknowledged |
| `admin_setup_codes` | the hash of the setup code for the first enrolment |
| `admin_mfa_challenges` | half-finished sign-ins (between the password and the code) |
| `rate_limits` | fixed-window counters (upserts), pruned after a write in `getPlatform().defer` |
| `jobs` | the background queue (Phase 3): see *Jobs* |
| `galleries` | one per client gallery (Phase 5): slug, purpose, status, access (the password **sealed**, never hashed), `settings` JSON (processing profile, look, sort), stored counts, `content_version`, soft delete |
| `photo_sets` | a gallery's sets (≤ 50), ordered by `position`, with a stored count of visible ready photos |
| `photos` | one per uploaded photo: the original's metadata, the derivatives' `rev`/extension, `sha256` (unique per gallery until deleted), `sort_key`, `status` (`uploading` → `ready` → `deleted`), `hidden` |

**Galleries, sets and photos** (plan p05 → Data, migration `0006`):

- **The schema holds the invariants.** A photo's set belongs to its gallery (`fk_photos_set` on
  `(set_id, gallery_id)` → `uq_photo_sets_id_gallery`); a hash is unique per gallery
  (`uq_photos_gallery_sha256`) and released on delete (`sha256 = NULL`); `status`/`published_at` and
  `access`/`password_sealed` are CHECKed pairs. No cascades: the purges delete dependents, photos, sets,
  then the gallery.
- **Four structures on `photos`** (index writes count as rows written): the table,
  `uq_photos_gallery_sha256`, `ix_photos_set_order (set_id, sort_key)` — the ONE order index of the client
  page and the manager, in either sort — and the partial `ix_photos_purge (updated_at) WHERE status IN
  ('uploading', 'deleted')`, whose predicate every purge read repeats. `status` and `hidden` are in no
  index key, so marking ready or hiding rewrites only the row.
- **`sort_key`** = `name_key|taken_key|id` (or `taken_key|name_key|id` for the capture-time sort), composed
  in SQL from the gallery's current sort in the same statement that registers a photo (from the bound
  keys) or re-sorts the gallery (from the columns), so a sort change and an upload never interleave
  into a stale key.
- **Counts and the cache key are written, never counted on a request**: `photo_sets.photo_count` is
  incremented by the complete batch (only for photos marked in that batch) and recounted for the sets a
  bulk action touched; `galleries.photo_count` is the sum of ≤ 50 sets. `content_version` moves only on a
  real change (the bump is guarded by `changes() > 0` or "a photo of the gallery was written in this
  batch"): Phase 6 caches a gallery's JSON by it.
- **Budgets**: an 800-photo upload writes ≈ 6,000 rows (of 100k a day); a sort change of 800 photos ≈
  1,600. Query modules: `lib/db/queries/galleries`, `photo_sets`, `photos`; `GalleryRow` never carries the
  sealed password (`getGalleryPasswordSealed` only).
