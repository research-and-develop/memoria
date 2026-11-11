---
title: Recipes
type: reference
updated: 2026-11-09
related: [../AGENTS.md, architecture.md]
---

# Recipes

Step lists for the common changes. Each ends the same way: `npm run verify`.

## A table

1. `npm run db:migrations:new -- add_things` → write the SQL in the new file: TEXT uuid id, ISO
   timestamps with the `strftime` default, INTEGER 0/1 + CHECK booleans, every constraint named
   (`pk_things`, `ck_things_title`, `ix_things_created_at`). Guard: `migrations`.
2. `apps/web/src/lib/db/queries/things/`: `types.ts` (`ThingRow`, `ThingDbRow`, `ThingInput`,
   `THING_COLUMNS`, `toThingRow`), `read.ts`, `write.ts` (`*Statement` builders), `index.ts`
   (`export *`), `things.test.ts` on `createTestDb()`. Copy `site_settings/` (or `admin_sessions/`).
3. `npm run db:migrate:local`.
4. Before deploying: is the migration safe for the code still running? (Add first, drop later.)

A table whose rows a migration seeds and tests must keep (a singleton): `createTestDb({ keep: ['things'] })`.

## An API route

1. Pure validation in `src/lib/<feature>/parseXInput.ts` + a table-driven test; the form imports the
   same parser.
2. Domain function in `src/lib/<feature>/` (`import 'server-only'`); writes in one `batch()` with the
   audit row (`lib/auth/session.ts`).
3. `src/app/api/<path>/route.ts`, `export const runtime = 'nodejs'`, every method
   `withErrorHandling(fn, { route: 'METHOD /api/<path>' })` (guard: `every-route-wrapped`); admin
   routes call `requireAdmin(req)` first (guard: `admin-routes-require-admin`); public writes check
   same-origin, Turnstile and a rate limit first (`app/api/admin/login/route.ts`).
4. `route.test.ts` next to it: the real handler on a test D1, mocks only at the edges
   (`@opennextjs/cloudflare`, Turnstile). Assert the persisted effect.

## A var or a secret

- **Var** (not secret): `vars` in `wrangler.jsonc` with a comment.
- **Secret**: a line with a comment in `apps/web/.dev.vars.example` (+ your `.dev.vars`), then
  `npx wrangler secret put NAME` in production, and a row in deployment.md → Secrets.
- Either way: `npm run cf-typegen` (guard `wrangler-config` fails until you do). Read it with
  `getCloudflareContext().env.NAME` on the server; a value the browser needs goes through
  `getAppConfig()` → `AppProvider`, never `NEXT_PUBLIC_*`.

## A binding

Add it to `wrangler.jsonc`, run `npm run cf-typegen`, create the resource. The guard knows the common
kinds (D1, R2, KV, queues, Durable Objects, services, `send_email`, AI, Hyperdrive, Vectorize, …).

- **R2 (uploads)**: `"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "memoria-media" }]`,
  `npx wrangler r2 bucket create memoria-media --location <hint>`. Serve objects from `worker.ts`
  (stream `bucket.get(key)`, honour `If-None-Match`, immutable keys → `Cache-Control: immutable`) so a
  file costs ~1 ms CPU instead of a Next.js route. Only serve keys of your own layout, never an
  arbitrary object key. Add `blob:` to the CSP `img-src` for upload previews (already there).
- **Email (Email Routing)**: `"send_email": [{ "name": "EMAIL" }]` without `destination_address`
  delivers to any VERIFIED Email Routing destination. Send after the response:
  `ctx.waitUntil(sendNotification(id).catch(log))`, store the outcome on the row (sent / failed /
  skipped) so the admin can resend; mock `env.EMAIL.send` in route tests.
- **KV**: good for config read on every request; not for counters (eventually consistent — use D1
  upserts).
- **Cron**: `"triggers": { "crons": ["0 3 * * *"] }` and a `scheduled(event, env, ctx)` handler next
  to `fetch` in `worker.ts` (housekeeping: prune old rows, retry failed emails).

## Caching

Every page renders per request by default (`dynamic = 'force-dynamic'` in the root layout); measure
first (`npm run measure:cpu`). When renders cost too much CPU, options from cheapest to most work:

1. **Static where possible**: a page that reads no D1/env can be static (drop `force-dynamic` there;
   build-time code must use `getCloudflareContext({ async: true })`).
2. **OpenNext's incremental cache** (`open-next.config.ts`, R2/KV-backed ISR) with `revalidatePath`
   after admin writes.
3. **A page cache in the Worker entry** (the source project's approach — a hit costs ~1 ms CPU):
   `worker.ts` serves public pages from `caches.default`, keyed by host + version id
   (`CF_VERSION_METADATA`) + path + an allow-list of query params. Freshness is a "content stamp" row in
   D1 that triggers on every content table rewrite (INSERT → soft: serve stale and refresh in a
   separate invocation through `WORKER_SELF_REFERENCE`; UPDATE/DELETE → hard: re-render before
   serving). Render only from an allow-listed request (no visitor cookies or headers), store only a
   complete 200 `text/html` without `Set-Cookie`, never cache RSC payloads. Note: the Cache API does
   nothing on `workers.dev` and preview URLs — only on a custom domain.

## A second app

`apps/admin` (say): its own `tsconfig.json` (own `@/`), `tailwind.config.mjs` spreading
`uiContentGlobs`, a `wrangler.jsonc` if it is its own Worker. Add it to `SOURCE_INDEX_ROOTS`
(`packages/core/testing/sourceIndexBuild.ts`), the `APPS` list in `every-route-wrapped`, the
`TAILWIND_CONFIGS` list in `tailwind-ui-content`, a `ts-check:<app>` script, and its own vitest
projects if it uses `@/`.
