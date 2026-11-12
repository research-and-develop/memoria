---
title: Architecture
type: reference
updated: 2026-11-12
related: [../AGENTS.md, deployment.md, recipes.md, plans/202611/plan_202611_p01_core_adapters.md]
---

# Architecture

## Hosting: one Worker, Cloudflare free tier

```
browser ──► Cloudflare edge (custom domain)
              │
              ├─ static assets (.open-next/assets: /_next/static, public/)   free, unlimited, no Worker run
              │
              └─ Worker "memoria" (worker.ts)                               100k req/day, 10 ms CPU/req
                   ├─ edge routes (src/lib/edge)            /healthz, before Next.js loads (~1 ms CPU)
                   ├─ OpenNext: the Next.js server         pages, /admin, /api/**
                   ├─ D1 "memoria" (binding DB)            settings, sessions, rate limits, audit
                   ├─ R2 "memoria-media" (binding MEDIA)   photos and branding files (used from Phase 5)
                   └─ Turnstile siteverify (fetch)         the login form
```

Everything is one deployable: public pages, the admin (`/admin`) and the API (`/api/**`) are routes
of the same Next app.

### Planned (Phases 3–6)

Not built yet; the build plan is [plans/202611/plan_202611_mvp.md](plans/202611/plan_202611_mvp.md).

```
memoria (apps/web)          as above, plus client galleries; worker.ts also serves protected-mode images
memoria-relay (apps/relay)  no UI: runs jobs from a D1 `jobs` table (SMTP email, reminders, expiry,
                            R2 cleanup); nudged by memoria through a service binding, retried by a cron
R2 memoria-media            originals, thumbnails, display copies, logos; public on a custom domain
D1 memoria                  shared by both Workers
```

The relay builds its platform with `cloudflarePlatform(env, ctx.waitUntil)` and adds the `Mailer` and
`Jobs` ports (Phase 3); see *Platform layer* below.

## Layout

```
apps/web            Next.js 16 App Router app (pages, admin, HTTP API) + wrangler/OpenNext config
packages/logger     structured logger + redaction       — leaf, zero deps
packages/core       AppError, validation, url helpers    — depends on nothing
packages/api        HTTP envelope + route error boundary — core, logger, next
packages/platform   the ports, config parsing, media rules, blob tokens/URLs, memory store, contract
                    suites, test platform; current.ts = the composition root — core, logger, aws4fetch
packages/platform-cloudflare  D1/R2 adapters, cloudflarePlatform, the OpenNext wrapper — platform,
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
                  └─ defer(p)  work after the response; a rejection is logged as deferred_task_failed

@repo/platform/current ──► @repo/platform-cloudflare/next    in Next: getCloudflareContext() per call,
                             │                               one platform per env, kept on globalThis
                             └─► cloudflarePlatform(env, waitUntil): d1Db(env.DB), r2BlobStore(env.MEDIA)
vitest aliases it to ──► @repo/platform/testing              a test D1, an in-memory BlobStore, your env
```

- **Ports** are in `packages/platform/ports.ts`. Each has a **contract suite** in
  `packages/platform/contract/` that every adapter runs: D1 and R2 in workerd (through wrangler's
  `getPlatformProxy`), the in-memory store in Node. `Mailer` and `Jobs` arrive with the relay (Phase 3).
- **Worker entries outside Next** (`worker.ts`, the relay) call `cloudflarePlatform(env, ctx.waitUntil)`
  themselves; only Next code goes through `getPlatform()`, which exists only inside a request.
- **The boundary is a guard**, `platform-boundary`: outside the adapters, the composition root, the
  test harness and the Worker's own config files, nothing imports `@opennextjs/cloudflare`, `wrangler`,
  `@repo/platform-cloudflare` or `cloudflare:*`, calls `getCloudflareContext()` or names a Cloudflare
  runtime type (the generated Workers types are global, so `tsc` cannot enforce it).

### Media

`blobUrls(config)` (`@repo/platform/blobUrls`) mints every URL a browser uses for a stored file. Its
mode follows the config:

| Mode | When | Upload | Download |
| --- | --- | --- | --- |
| `s3` | all four `MEDIA_S3_*` set (production) | presigned PUT straight to R2's S3 endpoint; the Content-Type is signed | presigned GET with `response-content-disposition` |
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

One admin, configured by three settings: the `ADMIN_EMAIL` var, the `ADMIN_PASSWORD_HASH` secret
(`npm run admin:hash-password`; PBKDF2-SHA256 in Web Crypto, iterations measured against the 10 ms
CPU budget) and the `TOTP_ENCRYPTION_KEY` secret. Any missing = sign-in answers 503. Signing in takes
the password **and** a second factor (Phase 2: [plan](plans/202611/plan_202611_p02_admin_totp.md)).

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
- **The developer is in charge**: `npm run admin:mfa -- setup|reset|unlock|list|key [--remote]`
  ([deployment.md → Two-factor sign-in](deployment.md#two-factor-sign-in)).
- **Sessions**: a random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie, created only after the
  second factor; D1 stores its SHA-256 and how it signed in (which app, or a recovery code). Over HTTPS
  only the `__Host-` cookie is read, on plain http only the plain name (`isSecureRequest`, one rule for
  routes and pages). A session ends after 14 days without use and at most 90 days after sign-in (the
  cookie lives 90 days; `expires_at` is refreshed at most hourly, since a write per request would burn
  the write budget). Each session records a fingerprint of the password hash, so rotating the password
  ends every session.
- **Gate**: `app/admin/(panel)/layout.tsx` redirects pages; every admin API route calls `requireAdmin`
  itself (a page gate never protects an API). Guard: `admin-routes-require-admin`.

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
