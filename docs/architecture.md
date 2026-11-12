---
title: Architecture
type: reference
updated: 2026-11-12
related: [../AGENTS.md, deployment.md, recipes.md]
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
                   └─ Turnstile siteverify (fetch)         the login form
```

Everything is one deployable: public pages, the admin (`/admin`) and the API (`/api/**`) are routes
of the same Next app.

### Planned (Phases 1–3)

Not built yet; the build plan is [plans/202611/plan_202611_mvp.md](plans/202611/plan_202611_mvp.md).

```
memoria (apps/web)          as above, plus client galleries; worker.ts also serves protected-mode images
memoria-relay (apps/relay)  no UI: runs jobs from a D1 `jobs` table (SMTP email, reminders, expiry,
                            R2 cleanup); nudged by memoria through a service binding, retried by a cron
R2 memoria-media            originals, thumbnails, display copies, logos; public on a custom domain
D1 memoria                  shared by both Workers
```

Domain code will talk to ports (`Db`, `BlobStore`, `Mailer`, `Jobs`, `Config`) with Cloudflare
adapters now and Docker adapters possible later (Phase 1).

## Layout

```
apps/web            Next.js 16 App Router app (pages, admin, HTTP API) + wrangler/OpenNext config
packages/logger     structured logger + redaction       — leaf, zero deps
packages/core       AppError, validation, url helpers    — depends on nothing
packages/api        HTTP envelope + route error boundary — core, logger, next
packages/db         D1 client, batch, row converters, test harness — @opennextjs/cloudflare, wrangler (tests)
packages/ui         theme (theme/studio.mjs: every design value), primitives, typography, cn, useApi, Tailwind preset — core, react, tailwind-merge
migrations/         authoritative D1 schema (SQL), wrangler-numbered
scripts/guards/     repo-wide rules as tests
```

Dependencies point down that list; a package never imports an app. A second app (a separate admin,
a marketing site) is `apps/<name>` with its own tsconfig (`@/` means one directory per tsconfig),
its own entry in the guards' `SOURCE_INDEX_ROOTS`, and the same packages.

## Configuration

| Where | What | Read by |
| --- | --- | --- |
| `apps/web/wrangler.jsonc` | bindings, plain `vars`, compatibility flags | wrangler, OpenNext, the test harness |
| `apps/web/.dev.vars` (local) / `wrangler secret put` (prod) | secrets | merged into the env |
| `apps/web/cloudflare-env.d.ts` | generated `CloudflareEnv` type | tsc (guard: `wrangler-config`) |

All of it reaches code as `getCloudflareContext().env`. `next dev` gets the same object through
`initOpenNextCloudflareForDev()` in `next.config.mjs` (local D1 state in `apps/web/.wrangler/`).
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

One admin, configured by two settings: the `ADMIN_EMAIL` var and the `ADMIN_PASSWORD_HASH` secret
(`npm run admin:hash-password`; PBKDF2-SHA256 in Web Crypto, iterations measured against the 10 ms
CPU budget). Either missing = the login answers 503.

- **Login** (`POST /api/admin/login`): same-origin → parse → rate limit (10 per IP per 15 min, 60
  overall per hour) → Turnstile → email AND password always both checked (timing does not tell which
  was wrong) → session.
- **Sessions**: a random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed
  over HTTPS); D1 stores only its SHA-256. 14-day sliding expiry, refreshed at most hourly (a write per
  request would burn the write budget). Each session records a fingerprint of the password hash, so
  rotating the password ends every session.
- **Gate**: `app/admin/(panel)/layout.tsx` redirects pages; every admin API route calls `requireAdmin`
  itself (a page gate never protects an API). Guard: `admin-routes-require-admin`.

## Data

D1 is SQLite: no interactive transactions (atomicity = `batch()`), `?` placeholders, TEXT ids and
ISO-8601 timestamps. The schema lives in `migrations/`; `packages/db/test-utils.ts` applies the same
files to an in-memory D1 for tests. Rules: [AGENTS.md → Data rules](../AGENTS.md#data-rules-d1--non-negotiable).

| Table | What |
| --- | --- |
| `site_settings` | one JSON document per key (the reference query module) |
| `audit_log` | one row per admin change, in the change's batch |
| `admin_sessions` | hashed session tokens |
| `rate_limits` | fixed-window counters (upserts), pruned after a write in `waitUntil` |
