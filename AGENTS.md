# Memoria (Next.js on Cloudflare Workers) — agent instructions

**Memoria** is a client-gallery app for one photographer: upload a shoot, share a branded gallery,
let the client favourite, comment and submit a selection, then deliver. Cloudflare's **free** tier:
one Worker today, a relay Worker for email and jobs planned. Build plan:
[`docs/plans/202611/plan_202611_mvp.md`](docs/plans/202611/plan_202611_mvp.md).

Next.js 16 App Router on npm workspaces, deployed as **one Cloudflare Worker** through OpenNext
(`@opennextjs/cloudflare`). Data in **D1** (SQLite), spam protection with **Turnstile**. Tailwind v3,
vitest. **There is no eslint: the test suite is the linter** (see *Guards*).

Docs wiki: [`docs/README.md`](docs/README.md). How to add a table, a route, a secret or a binding:
[`docs/recipes.md`](docs/recipes.md).

## Where to look

| Path | Holds |
| --- | --- |
| `apps/web/src/app/**` | pages (server components by default) and `api/**/route.ts` handlers |
| `apps/web/src/components/**` | app-specific UI: `AppProvider`, `forms/Turnstile`, `admin/` |
| `apps/web/src/lib/<feature>/**` | domain logic: pure helpers + `server-only` orchestration |
| `apps/web/src/lib/db/queries/<table_name>/**` | the ONLY place SQL lives (reference modules: `site_settings`, `admin_sessions`) |
| `apps/web/src/lib/config/appConfig.ts` | the public part of `getPlatform().config()`, handed down via `AppProvider` |
| `apps/web/wrangler.jsonc` | the Worker: bindings (D1 `DB`, R2 `MEDIA`, assets, …), vars, compatibility flags; `r2-cors.json` = the bucket's CORS rules |
| `apps/web/src/lib/media/` | the development blob routes' checks (`devBlobRequest.ts`) and headers (`blobResponseHeaders.ts`) |
| `apps/web/worker.ts` + `src/lib/edge/` | the Worker entry: answers cheap paths (`/healthz`) before Next loads; imports relative only, nothing `server-only` |
| `apps/web/cloudflare-env.d.ts` | GENERATED type of the env (`npm run cf-typegen`) — never hand-edit |
| `apps/web/open-next.config.ts` | OpenNext adapter config (caching overrides) |
| `apps/web/.dev.vars.example` | every local secret, documented — copy to `.dev.vars` |
| `packages/logger` | structured logger + secret redaction (zero deps) — `@repo/logger` |
| `packages/core` | `AppError`, `isUuid`, `objectToUrlSearchParams`; `testing/` = the guards' source index |
| `packages/api` | the HTTP envelope: `responses`, `withErrorHandling`, `publicErrorMessage`, `responseHeaders` |
| `packages/platform` | the ports (`Db`, `BlobStore`, `Config`, `defer`: `ports.ts`), config parsing, media rules, blob tokens/URLs; `current.ts` = the composition root (`getPlatform()`); `testing/` = the test platform, `contract/` = the adapter contract suites |
| `packages/platform-cloudflare` | the Cloudflare adapters: `d1.ts`, `r2.ts`, `platform.ts` (`cloudflarePlatform(env, waitUntil)`), `next.ts` (OpenNext), `testing/proxy.ts` |
| `packages/db` | the database layer on the `Db` port: `client.ts` (`statement`, `query`, `queryFirst`, `execute`, `batch`, `all`/`first`/`run`, `allRows`/`firstRow`, `getDb`), `rows.ts` (pure converters), `migrations.ts`, `test-utils` |
| `packages/ui` | `theme/studio.mjs` = every design value (colour roles, type scale, radii); primitives (`button`, `input`, `layout`), `typography.tsx` (single source of text styling), `cn.ts` (`twMerge`), `date.tsx`, `hooks/useApi`; the Tailwind preset maps the theme |
| `migrations/*.sql` | the authoritative D1 schema, applied by wrangler and by the test harness |
| `scripts/guards/*.test.ts` | repo-wide rules enforced by the suite |
| `docs/` | the wiki: plans, audits, reference docs — index `docs/README.md` |

## Commands

- `npm run dev` (port 3210; `next dev` with the local D1/vars through `initOpenNextCloudflareForDev`)
- `npm run preview` — build with OpenNext and run the real Worker locally in workerd (port 8787)
- `npm run deploy` — build + deploy to Cloudflare (needs `wrangler login`)
- `npm run db:migrate:local` / `npm run db:migrate:remote` — apply `migrations/` to the local / production D1
- `npm run db:migrations:new -- <name>` — a new, correctly numbered migration file
- `npm run admin:hash-password [-- --generate]` — the `ADMIN_PASSWORD_HASH` secret; locally the admin
  is `admin@example.local` / `local-dev-password-2026` (from `.dev.vars.example`)
- `npm run media:probe -- <base-url>` — round-trip a PNG through the development blob routes of a
  running `npm run dev`/`preview` (needs `MEDIA_DEV_SIGNING_SECRET` in `.dev.vars`)
- `npm run cf-typegen` — regenerate `cloudflare-env.d.ts` after ANY change to `wrangler.jsonc` or
  `.dev.vars.example` (it reads the example, never your `.dev.vars`; guard `wrangler-config`)
- `npm run measure:cpu -- <url> [count] [--version <id>] [--group-by <header>]` — CPU/wall time per
  request of the deployed Worker
- `npm run ts-check` (both tsconfigs) · `npm run test` (`test:node`, `test:components`) · `npm run verify` (both)
- Shipping, secrets, rollback: [`docs/deployment.md`](docs/deployment.md). CI: `.github/workflows/ci.yml`
  (deploy is manual; migrations run first and must be safe for the code still running); nightly D1
  backup: `.github/workflows/backup.yml`
- Done means **`npm run ts-check` and `npm run test` both green**; a change to bindings, caching or
  config also needs `npm run preview` to boot and serve.

## Cloudflare rules that bite

- **Env and bindings only through the platform.** Domain code calls `getPlatform()` from
  `@repo/platform/current` and uses its ports: `config()` (vars and secrets, parsed by
  `@repo/platform/config`), `db()`, `blobs()`, `defer()`. Only the Cloudflare adapters
  (`packages/platform-cloudflare`) read `getCloudflareContext()`; a Worker entry outside Next builds its
  platform with `cloudflarePlatform(env, ctx.waitUntil)`. Locally: `wrangler.jsonc` `vars` +
  `apps/web/.dev.vars`. Production: `vars` + `wrangler secret put`. A new secret = a line in
  `.dev.vars.example` with a comment and a `Config` field. Never commit `.dev.vars`.
- **`getPlatform()` exists only inside a request**: never call it at import time (module scope) or
  from code that runs at build time (a statically prerendered page, `generateStaticParams`).
- **Free plan = 10 ms CPU per request, 50 subrequests, 100k requests/day.** Waiting on D1/fetch is
  not CPU; rendering, hashing and parsing are. Never do per-request work proportional to content size,
  measure anything crypto-heavy (PBKDF2 iterations are a measured trade-off), and answer cheap paths
  in `worker.ts` before Next loads.
- **Work after the response goes in `getPlatform().defer(promise)`** (`ctx.waitUntil` underneath;
  a rejection is logged as `deferred_task_failed`). A floating promise is cancelled. Tests:
  `await flushDeferred()`.
- **No filesystem at runtime.** Static files are build assets (`public/`); uploads go to R2.
- **Node APIs only through `nodejs_compat`.** Prefer Web APIs (`crypto.randomUUID()`,
  `crypto.subtle`, `fetch`, `Response`) over `node:*` imports in runtime code.
- **The Workers runtime types are global** (generated file). `Response.json()` returns `unknown` —
  cast to the envelope type you expect.
- **Deps go in the root `package.json`** (one hoisted tree); workspace manifests carry none.

## Workspace rules

- **A package never imports the app's `@/` alias** — relative inside a package, `@repo/*` across.
  Guard: `no-app-alias-in-packages.test.ts`.
- **One target per `exports` pattern** in a package's package.json — Node honours array fallbacks,
  Vite does not. Add an explicit entry per directory barrel (`"./queries/x": "./queries/x/index.ts"`).
- **A Tailwind preset cannot carry `content`** — each app spreads `uiContentGlobs` into its own
  `content` and excludes `*.test.ts(x)`. Guard: `tailwind-ui-content.test.ts`.
- **A process-wide singleton lives on `globalThis`**, never a module-level `let` — Next's server
  build duplicates modules across chunks (see `packages/platform-cloudflare/next.ts`).

## API routes (house pattern)

```ts
export const runtime = 'nodejs'; // OpenNext runs it in the Worker; the edge runtime is NOT supported

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: Params) => {
  const admin = await requireAdmin(req);                 // 1. auth FIRST, before the body (admin routes)
  if (!admin.ok) return admin.response;
  const { id } = await params;
  if (!isUuid(id)) return notFoundError();              // 2. ids checked before SQL
  const body = await req.json().catch(() => ({}));      // 3. parse defensively
  const parsed = parseThingInput(body);                 // 4. validate in a pure helper
  if (!parsed.ok) return invalidParamsError(parsed.message, parsed.field);
  const thing = await updateThing(id, parsed.value);    // 5. delegate (src/lib/<feature>)
  return NextResponse.json({ data: thing });            // 6. { data }
}, { route: 'PATCH /api/admin/things/[id]' });
```

Reference: `app/api/admin/login/route.ts` (a public write: same-origin, Turnstile and the rate limit
before any work). The admin-write pattern above has no reference route until Phase 2 adds one.

- **Every exported method is `withErrorHandling(fn, { route: '<METHOD> <path>' })`.** Guard:
  `every-route-wrapped.test.ts`. Errors: the `@repo/api/responses` builders, or
  `throw new AppError(msg, 'CODE', { status, ...details })`. Never hand-build `{ error }` JSON.
- Envelope: success `{ data, ...paging }`; failure `{ error, errorCode, details? }`. `useApi` parses exactly this.
- Thin routes: logic in `src/lib/<feature>`, SQL in `src/lib/db/queries`. Dynamic `params` is a **Promise**.
- Naming: URL query params `underscore_case`, JSON body `camelCase`, DB columns `underscore_case`.
- Validate ids with `isUuid` before SQL. A missing row is a 404.
- **Public write endpoints verify same-origin, Turnstile and the rate limit BEFORE any write.**
  Admin endpoints verify the session AND that the request is same-origin (CSRF) — `requireAdmin`
  does both. Guard: `admin-routes-require-admin.test.ts`.
- **The exception: the development blob routes** (`/api/blobs/upload`, `/api/blobs/read`) skip Turnstile
  and the rate limit. They answer 404 unless `NEXTJS_ENV=development`, and each request carries an
  HMAC token minted by server code (`blobUrls`), so **minting is the gate**: an admin-only API, or a
  public one behind Turnstile and a rate limit. Never add another route like them.
- User-facing messages are in the product's language (set it here); `errorCode`s, log events and
  identifiers stay English.

## Data rules (D1 — non-negotiable)

- **There are no interactive transactions.** `BEGIN`/`COMMIT` are rejected by D1. The atomic unit is
  `batch([...statements])`: all-or-nothing, in order. A change and its audit row go in ONE batch
  (`lib/auth/session.ts`). A query module that may join a batch exports a `*Statement` builder next to
  its executing function (see `site_settings/upsert.ts`).
- **Reads between writes are not isolated.** Enforce invariants in the schema (UNIQUE/CHECK/FK) or in
  the write itself (`UPDATE … WHERE id = ? AND version = ?`, `INSERT … ON CONFLICT`, an audit row
  `WHERE changes() > 0`), then check `changes` (`run`/`execute` return `{ changes, lastRowId }`; each
  `batch` result has `{ rows, changes }`). Never read-check-write across two round trips. `changes`
  also counts trigger writes: **compare it with 0, never with an exact count.**
- **Placeholders are `?`.** Parameters are strings, numbers or `null`: `undefined` and booleans throw in
  `statement()` (pass `null`; `fromBool`).
- **Types:** ids TEXT (`crypto.randomUUID()` in the app); timestamps TEXT ISO-8601 UTC with ms
  (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`); booleans INTEGER 0/1 + CHECK; JSON TEXT + `json_valid()`.
  The query module converts rows (parse JSON, 0/1 → boolean; converters in `@repo/db/rows`, which stays
  import-free; `allRows`/`firstRow` in `@repo/db/client`); callers never see raw columns. Render dates on the client with `@repo/ui/date`, on the server with
  `apps/web/src/lib/dates.ts` — never the host locale: guard `no-host-locale-date.test.ts`.
- **Mind the free-tier row budget** (5M rows read, 100k rows written per day): every public-page query
  is indexed and bounded (`LIMIT`); no `count(*)`/full scans on request paths; counters are upserts.
- **Migrations:** `migrations/NNNN_<change>.sql` (`npm run db:migrations:new`), one per logical
  change-set, every constraint/index/trigger named (`pk_/fk_/uq_/ck_/ix_/tr_`). Statements end with `;`
  at end of line; never `;`+newline inside a string literal (the test harness splits on it). Guard:
  `migrations.test.ts`. **Forward-only from the first `db:migrate:remote`:** before it (no remote D1
  yet: `database_id` all zeros in `wrangler.jsonc`) an unshipped migration may be edited; after it, never
  rewrite one applied to the remote D1, write a new one. Unsure whether it shipped? Ask the human.
- **Query modules:** `src/lib/db/queries/<table_name>/` (snake_case) with `types.ts` (`<Entity>Row`,
  `<Entity>DbRow`, `<Entity>Input`, the columns and the row converter), the reads (`get.ts`/`list.ts`
  or one `read.ts`), the writes (`write.ts`: `*Statement` builders plus executing helpers), an
  `index.ts` barrel of `export *` lines, and `<table_name>.test.ts` on a test D1. **A `*Statement`
  builder is pure**: it returns a `Statement` (`{ sql, params }`, plain data) and takes no `opts`. Every
  function that executes takes `opts?: Options` LAST and threads it to the client (`first(stmt, opts)`,
  `run(stmt, opts)`, `batch([...], opts)`). Domain code sees the `Db` port, never a D1 type.

## Media rules (non-negotiable)

- **Through the port only**: `getPlatform().blobs()` (`BlobStore`) to store and read; `blobUrls(config)`
  (`@repo/platform/blobUrls`) for URLs a browser uses. Production uploads and downloads are presigned S3
  URLs straight to R2 (`MEDIA_S3_*`); there is no fallback (`MEDIA_NOT_CONFIGURED`, 503). Locally,
  the same calls mint development route URLs. **Never stream an upload through a Next route**: OpenNext
  buffers the body in a 128 MB isolate.
- **Images only**: `MEDIA_TYPES` (`image/jpeg`, `image/png`, `image/webp`). An uploaded HTML or SVG
  served from our origin is stored XSS. Anything else read back is an `application/octet-stream`
  attachment.
- **Keys are generated by server code** under a known prefix (`BLOB_PREFIXES`: `galleries/`, `branding/`,
  `dev/`; `isBlobKey`), never derived from a user's filename (filenames are D1 metadata).
- **Limits are checked when minting**: upload expiry ≤ 15 min, size ≤ 100 MB (`MAX_UPLOAD_BYTES`). A
  presigned PUT cannot enforce the size: the phase that registers an upload re-checks `head()`.
- Presigned GETs are for downloads only (unique per call, so never cached). Gallery images come from
  the public media domain or `worker.ts` (Phase 6).

## Client code

- **Nothing a client component imports may reach `@repo/db/client`, `@opennextjs/cloudflare` or a
  `server-only` module** — one value import drags the Worker runtime into the browser bundle. Share
  values via a dependency-free module; `import type` is exempt. Mark server modules
  `import 'server-only'`. Guard: `no-server-imports-in-client.test.ts`.
- **No `NEXT_PUBLIC_*` in client code** — read env server-side and hand it down through
  `AppProvider` (public keys such as the Turnstile site key included). Guard: `no-client-public-env.test.ts`.
- **The look lives in `packages/ui/theme/studio.mjs`**: colours as roles (`bg-surface`, `text-ink-muted`,
  `ring-focus`), never a literal (guard `no-raw-colors`); a restyle is an edit there. A new token (size,
  weight, radius, shadow) goes there too: the preset and `cn.ts` read their names from it.
  `/admin/design` shows every token and primitive: check it at 360 px and 1440 px after a change.
- Colour roles have rules: placeholders use `ink-muted`; `ink-faint` is for disabled text and
  decoration only (below AA); `alert` text sits on `surface` only.
- Touch: interactive targets reach 44 px on a coarse pointer (the `coarse:` variant; `Button` sizes
  `sm`/`md`/`icon` do it with a `::before`). Form fields are 16 px text below `sm` (iOS zooms into
  smaller fields): use the `@repo/ui/input` controls, do not shrink their text.
- Use `@repo/ui` primitives and the typography components before writing classes; never one-off
  `text-[Npx]` (guard `no-one-off-text-size`) — sizes are tokens of the preset. Merge classes with
  `twMerge` from `@repo/ui/cn` (it knows the theme's tokens; guard `tailwind-merge-via-ui`;
  `cn.test.ts` checks it against the preset). A generic primitive goes in `packages/ui`;
  app-specific UI stays in `apps/web/src/components`.
- Text/surface colour pairs are pinned to WCAG AA in `packages/ui/colorContrast.test.ts` — add a row for
  each new pair.
- A server component passes only serialisable props to a client component (no functions).
- **Effects:** React 18.3.1 (no `useEffectEvent`), no `exhaustive-deps` lint. Depend on stable
  identities: `useApi().execute` is stable per URL; wrap derived callbacks in `useCallback` on
  those. Dev StrictMode double-mounts: effects must clean up (useApi aborts on unmount).
- `useApi` is bound to one URL; a per-row action gets its own component with its own `useApi`.
- Mobile-first: every section must work from 360 px up.

## Testing

- vitest projects: **`node`** (`*.test.ts`: pure logic, D1 integration, routes, guards) and
  **`components`** (`*.test.tsx`, jsdom, no database).
- **D1 tests need no setup**: `createTestDb()` (`@repo/db/test-utils`) starts an in-memory D1
  through wrangler's `getPlatformProxy` and applies `migrations/`; `testDb.db` is the `Db` port. One per
  test FILE (`beforeAll`), `reset()` in `afterEach`, `dispose()` in `afterAll`. Pass `{ db: testDb.db }`;
  raw SQL in a test is `run(statement(…), { db: testDb.db })`.
- **Under vitest, `@repo/platform/current` is the test platform** (alias in `vitest.config.ts`):
  `getPlatform().name === 'test'`, never Cloudflare.
- Routes → `route.test.ts` driving the real handler with `useTestDb(testDb.db)` (every un-scoped
  query goes to the test D1 through the test platform; `useTestDb(null)` in afterEach), or
  `useTestPlatform({ db, env })` when the route reads config (`resetTestPlatform()` in afterEach,
  `flushDeferred()` for deferred work). Never mock `@opennextjs/cloudflare`; mock only the other
  edges: Turnstile, an email sender. Helpers: `src/lib/testing/routeHarness.ts`
  (`jsonRequest`, `adminCookie`, `params`, `atFixedTime` for fixed-window rate limits).
- Blobs in tests: the test platform's `blobs()` is a fresh in-memory store per `useTestPlatform`; the
  `BlobStore` contract suite (`@repo/platform/contract/blobStore`) runs it and R2 (workerd) alike.
- Pure business logic → a colocated pure helper with a **table-driven** test (`it.each`).
- Assert the persisted effect (re-read via the query module), not only the JSON.

## Guards (the suite is the linter)

`scripts/guards/`: `every-route-wrapped`, `admin-routes-require-admin`, `no-client-public-env`,
`no-server-imports-in-client`, `no-host-locale-date`, `no-app-alias-in-packages`, `tailwind-ui-content`,
`no-one-off-text-size`, `tailwind-merge-via-ui`, `no-raw-colors` (colours only as theme roles),
`wrangler-config` (`cloudflare-env.d.ts` fresh, no secret in `vars`, `MEDIA_S3_BUCKET` = the `MEDIA` bucket,
no `NEXTJS_ENV` in `vars`, every hard-coded Worker name = `name`),
`migrations` (numbering, named constraints, no transaction control),
`file-size` (700 lines prod / 800 tests; allowlist `file-size-allowlist.json`),
`platform-boundary` (no `@opennextjs/cloudflare`, `wrangler`, `@repo/platform-cloudflare`, `cloudflare:*`,
`getCloudflareContext()` or Cloudflare runtime type outside the adapters; contract suites only in tests).

- Need a repo-wide rule? **Add a guard test, not a linter.**
- A guard reads source through `readSourceFiles` from `@repo/core/testing/sourceIndex` (one
  snapshot per run), never its own directory walk. Generated `*.d.ts` files are not in the index.
- A guard **strips comments first** (`stripComments`), or it flags the docs that name the banned thing.
- A guard asserts it found something to scan, so a broken walk cannot pass vacuously, and tests its
  own matcher on a good and a bad sample.

## Docs (the wiki)

Durable plans/audits are committed under `docs/`, never left in gitignored `tmp/`:
plans `docs/plans/YYYYMM/plan_*.md`, audits `docs/audits/YYYYMM/audit_*.md`, reference docs
`docs/<topic>.md`. Conventions: `docs/wiki-conventions.md`; index: `docs/README.md`.
Work a plan by ticking its checklist in the same commit as the code.

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess`; avoid `any` (use `unknown` and narrow).
- Never commit secrets; every secret is documented in `.dev.vars.example`, none prefixed `NEXT_PUBLIC_`.
- Log events, not sentences: `logger.info({ event: 'admin_login', session })`. Never log a
  visitor's name, email, phone or message — log ids.
- camelCase vars/functions · PascalCase types/components · CONSTANT_CASE constants ·
  snake_case query-module dirs, kebab-case other dirs.
- Small single-purpose modules; colocate what one feature uses, promote what two use.
