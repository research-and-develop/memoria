# Cloudflare Next.js boilerplate

Next.js 16 (App Router) + React 18 + TypeScript strict + Tailwind v3, deployed as a **single
Cloudflare Worker** with [OpenNext](https://opennext.js.org/cloudflare). Data in **D1**, spam
protection with **Turnstile**, a single-admin login with D1 sessions, a contact form with a rate
limit — all inside Cloudflare's free tier. vitest, with **guard tests standing in for a linter**.

Extracted from a production site. What you get out of the box:

| | |
| --- | --- |
| Worker entry | `apps/web/worker.ts`: answers cheap paths (`/healthz`) before Next.js loads |
| HTTP envelope | `{ data }` / `{ error, errorCode, details }`, one error boundary (`withErrorHandling`), `useApi` on the client |
| D1 | a thin client (`batch` = the transaction), query modules, migrations, an **in-memory D1 per test file** (no Docker, no setup) |
| Security | CSP/HSTS headers, same-origin (CSRF) checks, Turnstile verify, fixed-window rate limits in D1, PBKDF2 admin password, hashed session tokens |
| Example feature | contact form → `POST /api/contact` → admin inbox (`/admin`) with mark-read / delete + audit log |
| Guards | 12 repo-wide rules as tests (routes wrapped, admin routes gated, no server code in client bundles, fresh env types, migration naming, …) |
| Docs | `AGENTS.md` (rules for humans and coding agents), a `docs/` wiki with recipes |

Rules for humans and agents alike: [AGENTS.md](AGENTS.md). Architecture and recipes:
[docs/README.md](docs/README.md).

## Quick start

```sh
npm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # local secrets (test keys, a local admin password)
npm run db:migrate:local       # create the local D1 (apps/web/.wrangler/state)
npm run dev                    # http://localhost:3000 — admin: /admin, admin@example.local / local-dev-password-2026
```

No database server or Docker is needed: D1 and the other bindings run locally inside wrangler.
If npm reports blocked install scripts (`npm warn allow-scripts`), approve `workerd` and `esbuild`
(`npm install-scripts approve workerd esbuild`) — wrangler needs them.

## Verify

```sh
npm run ts-check               # both tsconfigs (packages + scripts, and the app)
npm run test                   # D1 tests start an in-memory D1 themselves
npm run preview                # the real Worker, locally, at http://localhost:8787
```

## Make it yours

1. **Names.** Replace `my-app` (the Worker and the D1 database) in `apps/web/wrangler.jsonc` (`name`,
   `services[].service`, `database_name`), `scripts/measure-cpu.mjs` and the root `package.json`.
   The `wrangler-config` guard fails until they agree. `@repo/*` is the internal package scope; keep
   it or search-and-replace it.
2. **Product.** `APP_NAME` in `wrangler.jsonc`, the two-line description at the top of `AGENTS.md`,
   the language of user-facing messages (`AGENTS.md` → API routes), `lang` in `app/layout.tsx`,
   `APP_LOCALE` / `APP_TIME_ZONE` in `apps/web/src/lib/dates.ts`.
3. **Design.** The tokens in `packages/ui/tailwind-preset.mjs` (keep `cn.ts` in step — `cn.test.ts`
   checks), fonts via `next/font` in `app/layout.tsx`, the contrast pairs in
   `packages/ui/colorContrast.test.ts`.
4. **Cloudflare.** `npx wrangler d1 create <name>` → paste the id into `wrangler.jsonc`; create a
   Turnstile widget → its site key into `vars`, its secret with `wrangler secret put`. Then
   `npm run cf-typegen`. Full runbook: [docs/deployment.md](docs/deployment.md).
5. **The example feature.** Keep the contact form as the reference for public writes, or delete
   `contact_messages` (migration 0003, query module, routes, components) once you have your own.
6. Run `npm run verify`, commit, and set up CI (`.gitlab-ci.yml` or `.github/workflows/ci.yml`).

## Deploy

```sh
npm run db:migrate:remote      # apply new migrations to the production D1 first
npm run deploy
```

CI checks every push and deploys only when you press the button (manual by design). Secrets,
rollback, backups, logs: [docs/deployment.md](docs/deployment.md).

## What's where

See the table in [AGENTS.md](AGENTS.md#where-to-look) and [docs/architecture.md](docs/architecture.md).
