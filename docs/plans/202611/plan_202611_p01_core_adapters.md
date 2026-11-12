---
title: "Phase 1: Core and adapters"
type: plan
status: in-progress
updated: 2026-11-12
related: [plan_202611_mvp.md, plan_202611_p00_foundation.md, ../../architecture.md, ../../../AGENTS.md]
---

# Phase 1: Core and adapters

## Goal

Domain code (routes, `src/lib/**`, query modules) talks to **ports**, never to Cloudflare, so a Docker
deployment can later be added as new adapters without touching domain code. R2 is added behind the
`BlobStore` port, with presigned upload and download URLs that Phase 5 (upload), Phase 9 (downloads)
and Phase 10 (cleanup) build on.

**Done when:**

- Outside the allowed platform files, nothing imports `@opennextjs/cloudflare`, `cloudflare:*`,
  `wrangler` or `@repo/platform-cloudflare`, calls `getCloudflareContext`, or names a Cloudflare
  runtime type. Guard `platform-boundary`.
- The admin login works end to end in `npm run preview` through the ports (V3).
- In `npm run preview`, a PNG goes up through a signed upload URL and comes back byte-identical
  through a signed read URL (V4). The `BlobStore` contract suite passes against the in-memory adapter
  and against R2 (miniflare); the `Db` contract suite passes against D1.

- **Depends on:** Phase 0. **Unblocks:** Phases 2–11.
- **Mockups:** none. **Scope (feature IDs):** architecture; supports D2, D5, J3, K3.

## Starting point (verified 2026-11-12)

- Domain code reaches Cloudflare in: `packages/db/client.ts` (`getCloudflareContext().env.DB`; D1 types
  in signatures), `packages/db/rows.ts`, `packages/db/test-utils.ts` (`getPlatformProxy`),
  `lib/config/appConfig.ts`, `lib/config/siteUrl.ts`, `lib/auth/requireAdmin.ts`,
  `app/api/admin/login/route.ts` (`env.*`, `ctx.waitUntil`) and its test (`vi.mock('@opennextjs/cloudflare')`),
  the query modules (builders typed `D1PreparedStatement`; `.first()`/`.all()`/`.run()` called on
  statements in `admin_sessions/read.ts`, `site_settings/upsert.ts`, `lib/auth/session.ts:82,88`,
  `lib/security/rateLimit.ts:45`), `lib/testing/routeHarness.ts` (`D1Database`), and tests using raw D1
  (`packages/db/client.test.ts:15` `db.exec`, `login/route.test.ts:132` `db.prepare().run()`,
  `rows.test.ts` raw `D1Result`).
- Cloudflare-specific by nature, staying so: `apps/web/worker.ts`, `next.config.mjs`,
  `open-next.config.ts`, `wrangler.jsonc`, `cloudflare-env.d.ts`.
- Neutral already: `packages/logger` (`process.env`), Turnstile (`fetch`), hashing (`crypto.subtle`).
- `no-server-imports-in-client` treats `@repo/db/client` as server code only because it imports
  `@opennextjs/cloudflare` (its self-test asserts it).
- `aws4fetch` 1.0.20 is already in the lockfile (transitive); `tsx` is installed.
- No R2 binding, no Cloudflare account resources (`database_id` all zeros).

### Facts checked for this plan

- **OpenNext buffers the request body** (`@opennextjs/aws` edge converter: `Buffer.from(await event.arrayBuffer())`)
  and hands Next a rebuilt stream of unknown length; an isolate has 128 MB. Large uploads must not go
  through a Next route.
- **R2 `put` needs a known length** for a stream; `FixedLengthStream` exists in workerd but **not in
  Node** (`next dev`, vitest), where bindings are miniflare proxies.
- **aws4fetch does not sign `content-type`/`content-length` unless `allHeaders: true`**; with it, a PUT
  with another Content-Type fails `SignatureDoesNotMatch`. Content-Length cannot be relied on.
- **Presigned URLs work only on `<account>.r2.cloudflarestorage.com`**, not on a custom domain, and each
  is unique (no CDN cache): they suit uploads and downloads, not gallery images.
- R2 presign: path style, region `auto`, expiry ≤ 7 days; aws4fetch accepts a fixed `datetime` for tests.
- `getPlatformProxy` with an R2 binding and `persist: false` works locally; no remote bucket needed.
- `env` is one object per isolate (and one global in `next dev`); `ctx` is per request.
- `getCloudflareContext()` throws at module scope and in `next build`.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1.1 | Two new packages: **`@repo/platform`** (neutral: port types, config parsing, blob keys, media types, blob tokens, blob URLs, in-memory adapter, contract suites, the test platform) and **`@repo/platform-cloudflare`** (D1 and R2 adapters, env reading, the Cloudflare platform, the workerd test harness). `@repo/core` stays dependency-free. The boundary is enforced by the guard (the generated Cloudflare types are global, so `tsc` cannot). | A Docker package later sits beside the Cloudflare one. |
| D1.2 | Phase 1 ports: **`Db`**, **`BlobStore`**, **`Config`**, **`defer`**. `Mailer` and `Jobs` come in Phase 3 with their first adapter. | An interface fits its first implementation; an unused one drifts. |
| D1.3 | **The Cloudflare platform is a constructor**, `cloudflarePlatform(env, waitUntil)`, with no OpenNext import, so the relay Worker (Phase 3) and `worker.ts` build it from their own `env`/`ctx`. Next code gets it through **one composition root**, `@repo/platform/current` → `getPlatform()`, which re-exports `@repo/platform-cloudflare/next` (the OpenNext wrapper: `getCloudflareContext()` per call, memoised per `env`, `waitUntil` looked up at call time). vitest aliases the root to the test platform. A Docker build later aliases it to a Node platform; that path is documented, not built. | One line to swap in Next; the other Workers never bundle OpenNext; no test hooks in production code. |
| D1.4 | **Statements are plain data** `{ sql, params }`. Builders (`*Statement`) are pure and lose `opts`; the adapter prepares and binds at execution. `statement()` rejects `undefined` and booleans. `SqlValue = string | number | null` (no BLOBs: YAGNI). | Query modules need no database to build a batch; D1 types leave the signatures. |
| D1.5 | The dialect stays **SQLite**. A Docker `Db` adapter would be SQLite (`node:sqlite`/`better-sqlite3`), run the same migrations, wrap `batch` in `BEGIN`/`COMMIT`, and pass the `Db` contract suite. Not built for the MVP. | One schema, no ORM. |
| D1.6 | **Production media is S3 protocol only**: presigned PUT for uploads and presigned GET for downloads (`aws4fetch`, `allHeaders: true`, on R2's S3 endpoint; MinIO or S3 under Docker). Gallery images will be served by the public media domain (`publicUrl`) or, for protected galleries, by `worker.ts` (Phase 6): never by presigned GETs. Without S3 credentials outside development, minting throws `MEDIA_NOT_CONFIGURED` (503); there is no production fallback. | No hidden expensive path; one attack surface in production. |
| D1.7 | **Development and tests use Worker-signed routes** (`/api/blobs/upload`, `/api/blobs/read`), enabled only when `NEXTJS_ENV=development` (otherwise 404). They buffer the body (cap **32 MB**) and need no account, network or S3 credentials. | Local dev works offline; OpenNext buffering and the 128 MB isolate rule out large or production use. |
| D1.8 | **Upload hardening** applies in both modes: content types are an **allowlist** (`image/jpeg`, `image/png`, `image/webp`), keys are **generated** by server code under an **allowed prefix** (`galleries/`, `branding/`, `dev/`) and never derived from user filenames (filenames are D1 metadata); upload expiry ≤ 15 min; size ≤ 100 MB checked at mint (S3 mode cannot enforce it: Phase 5 checks `head()` on registration). | Stops stored XSS through an uploaded HTML/SVG and keeps keys predictable. |
| D1.9 | The dev routes are an **exception** to "public writes verify Turnstile and the rate limit": they exist only in development, and each request carries an HMAC token minted by server code. **Minting** is the gate in every phase: an admin-only API (Phase 5), or Turnstile + rate limit for a public one (Phase 9). Read tokens are **not** a delivery mechanism for protected galleries (Phase 6 uses `worker.ts` with the gallery cookie). | The rule stays true where it matters: whoever can mint. |
| D1.10 | `Config` comes from plain string env through a **pure function** that never throws; empty closes a feature. Public `AppConfig` keeps its shape, with a test that no secret reaches it. | Identical under `env` and `process.env`; table-tested. |
| D1.11 | R2 bucket, CORS rules and the R2 API token (scoped to this bucket, object read/write) are **manual one-time setup** (`docs/deployment.md`). Dev, tests and CI need no Cloudflare account. | As for D1 today. |

## Design

### Packages

```
packages/platform/                  @repo/platform (neutral)
  ports.ts                          SqlValue, Statement, WriteResult, BatchResult, Db, BlobMeta, BlobObject,
                                    BlobStore, Config, Platform
  config.ts                         parseConfig(env) → Config                        (pure)
  media.ts                          MEDIA_TYPES, BLOB_PREFIXES, MAX_UPLOAD_BYTES, MAX_DEV_UPLOAD_BYTES,
                                    isBlobKey(key), contentDisposition(name)          (pure)
  blobToken.ts                      signBlobToken / verifyBlobToken (HMAC-SHA256, crypto.subtle)
  blobUrls.ts                       blobUrls(config) → { uploadUrl, readUrl, publicUrl }
  memory/blobStore.ts               memoryBlobStore()
  contract/db.ts, contract/blobStore.ts   describe… suites (vitest; imported only by *.test.ts)
  current.ts                        import 'server-only'; export { getPlatform } from '@repo/platform-cloudflare/next'
  testing/current.ts                vitest alias target: getPlatform() → the installed test platform
  testing/platform.ts               useTestPlatform({ db?, env?, blobs? }), resetTestPlatform(), flushDeferred()

packages/platform-cloudflare/       @repo/platform-cloudflare
  d1.ts                             d1Db(binding): Db
  r2.ts                             r2BlobStore(bucket): BlobStore
  env.ts                            stringEnv(env): Record<string, string>   (string vars/secrets only)
  platform.ts                       cloudflarePlatform(env, waitUntil): Platform      (no OpenNext import)
  next.ts                           getPlatform(): Platform    (OpenNext: getCloudflareContext per call)
  testing/proxy.ts                  createProxy(): { db, blobs, dispose }   (getPlatformProxy: D1 + R2)

packages/db/                        @repo/db (neutral, built on the ports)
  client.ts                         import 'server-only'; statement, getDb, query, queryFirst, execute,
                                    batch, all, first, run, allRows, firstRow
  rows.ts                           PURE (no imports; types.ts files and worker.ts may import it):
                                    readJson, readStringArray, toBool, fromBool, batchRows
  migrations.ts                     migrationFiles(), splitSqlStatements()   (moved from test-utils)
  test-utils.ts                     createTestDb(), useTestDb(db)  (same names; proxy + test platform)
```

Each package: `package.json` with explicit `exports` (one target per pattern), no dependencies (root
`package.json`). Root gains `aws4fetch@1.0.20` (exact). `npm install` links the new workspaces and
updates `package-lock.json` in the same commit.

### Ports (`@repo/platform/ports`)

```ts
export type SqlValue = string | number | null;
export type Statement = { readonly sql: string; readonly params: readonly SqlValue[] };
/** `changes`: rows affected, trigger writes may be included: compare with 0 only. */
export type WriteResult = { changes: number; lastRowId: number | null };
export type BatchResult<T = Record<string, unknown>> = { rows: T[]; changes: number };

export interface Db {
  all<T>(s: Statement): Promise<T[]>;
  first<T>(s: Statement): Promise<T | null>;
  run(s: Statement): Promise<WriteResult>;
  /** Atomic: in order, all or nothing; rejects with the failing statement's error. */
  batch<T>(s: readonly Statement[]): Promise<BatchResult<T>[]>;
}

export type BlobMeta = { key: string; size: number; contentType: string | null; etag: string; uploadedAt: string };
export type BlobObject = BlobMeta & { body: ReadableStream<Uint8Array> };

export interface BlobStore {
  /** Bytes only (no streams until a phase needs them). `ifAbsent`: false = an existing key was kept. */
  put(key: string, bytes: ArrayBuffer | Uint8Array, opts: { contentType: string; cacheControl?: string; ifAbsent?: boolean }): Promise<BlobMeta | false>;
  get(key: string): Promise<BlobObject | null>;
  head(key: string): Promise<BlobMeta | null>;
  /** Missing keys are ignored; adapters chunk as their backend needs. */
  delete(keys: readonly string[]): Promise<void>;
  /** By key, ascending; `limit` ≤ 1000; `cursor` null when done. */
  list(opts: { prefix: string; cursor?: string | null; limit?: number }): Promise<{ blobs: BlobMeta[]; cursor: string | null }>;
}

export interface Platform {
  readonly name: 'cloudflare' | 'test';
  db(): Db;
  blobs(): BlobStore;
  config(): Config;
  /** Keep `task` running after the response. Rejections are logged (`deferred_task_failed`), never thrown. */
  defer(task: Promise<unknown>): void;
}
```

`Config` (strings trimmed; empty → closed feature or `null`):

```ts
export type Config = {
  appName: string;                    // APP_NAME || 'Memoria'
  siteUrl: string | null;             // SITE_URL, no trailing slash
  isDevelopment: boolean;             // NEXTJS_ENV === 'development'
  admin: { email: string; passwordHash: string };       // ADMIN_EMAIL (lower-cased), ADMIN_PASSWORD_HASH
  turnstile: { siteKey: string; secretKey: string };    // TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
  hashSalt: string;                                     // HASH_SALT
  media: {
    devSigningSecret: string | null;  // MEDIA_DEV_SIGNING_SECRET if ≥ 32 chars, else null (dev routes refuse)
    publicBaseUrl: string | null;     // MEDIA_PUBLIC_BASE_URL, no trailing slash
    s3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null;
                                      // MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID,
                                      // MEDIA_S3_SECRET_ACCESS_KEY: all four set, else null
  };
};
```

### The Cloudflare platform

- `cloudflarePlatform(env, waitUntil)`: `db()` → `d1Db(env.DB)`; `config()` → `parseConfig(stringEnv(env))`;
  `defer(task)` → `waitUntil(task.catch(log))`; `blobs()` → in commits 2–4 throws `MEDIA_NOT_CONFIGURED`
  unconditionally (no `env.MEDIA` reference: the binding and its type arrive in commit 5); from commit 5
  `r2BlobStore(env.MEDIA)`. Likewise `createProxy()` returns `{ db, dispose }` until commit 5 adds `blobs`.
- `next.ts` `getPlatform()`: `const { env } = getCloudflareContext()`; a `WeakMap<env, Platform>` kept on
  `globalThis` (AGENTS.md singleton rule) holds the platform built with
  `waitUntil = (p) => getCloudflareContext().ctx.waitUntil(p)`, so `ctx` is never captured. Never call
  `getPlatform()` at import time (it throws outside a request).
- `r2.ts`: `put` → `bucket.put(key, bytes, { httpMetadata, onlyIf: ifAbsent ? { etagDoesNotMatch: '*' } : undefined })`
  (`null` result → `false`); `get` returns `obj.body`; `delete` chunks the keys by 1000 (the port has no
  limit); `list` with `include: ['httpMetadata']`; `etag` is R2's `httpEtag` (quoted); `uploadedAt` from
  `uploaded` (a `Date`, or an ISO string through the proxy: accept both).
- **Proxy fallbacks** (decided by the T1.8 spike, recorded in `r2.ts`): `onlyIf` wildcard not honoured →
  `ifAbsent` = `head()` then `put()` (one admin; the race is acceptable; port comment says so);
  `get().body` not usable through the proxy → read `obj.arrayBuffer()` and return `new Response(buf).body`.
  If `put(bytes)` itself fails through the proxy, stop and re-plan (the R2 contract must run in vitest).

### `@repo/db` on the ports

- `statement(sql, params = [])` → frozen `Statement`; throws `TypeError` naming the parameter index on
  `undefined` or a boolean.
- `getDb(opts?)` → `opts?.db ?? getPlatform().db()`; `Options = { db?: Db }`.
- `query`, `queryFirst`, `execute` (→ `WriteResult`), `batch` (→ `BatchResult[]`; `[]` → `[]` without a
  call, and `d1Db.batch([])` returns `[]` too), `all/first/run(stmt, opts?)`, and
  `allRows(stmt, convert, opts?)`, `firstRow(stmt, convert, opts?)` (moved from `rows.ts`: they execute).
- `rows.ts` stays import-free: `batchRows(result: BatchResult | undefined, convert)` and the converters;
  the generic `<Db, Row>` is renamed `<DbRow, Row>`.
- `setDbOverride` goes; `useTestDb(db)` installs `db` on the test platform.
- `TestDb` = `{ db: Db; reset; dispose }` (from commit 2; tests needing raw SQL use `run(statement(…), { db })`).

### Call sites

| Commit | File | Change |
| --- | --- | --- |
| 2 | `queries/*/write.ts`, `site_settings/list.ts`, `upsert.ts` | builders → `Statement`, no `opts`; `conditionalAuditStatement(params: SqlValue[])` |
| 2 | `admin_sessions/read.ts`, `site_settings/get.ts`, `list.ts`, `upsert.ts`, `audit_log/list.ts` | `.first()`/`.all()` on a statement → `first(stmt, opts)` / `allRows(stmt, convert, opts)` (now from `@repo/db/client`) |
| 2 | `lib/auth/session.ts`, `lib/security/rateLimit.ts` | `.run()` → `run(stmt, opts)`; `results[i]?.results` → `results[i]?.rows`; builders without `opts` |
| 2 | `app/api/admin/logout/route.ts` | builders without `opts` |
| 2 | `site_settings.test.ts` | builders called without `opts()` |
| 2 | `db/client.test.ts`, `rows.test.ts` | `exec` → `run(statement(…), opts)`; `{} as D1Database` → a fake `Db`; `BatchResult` instead of `D1Result`; `splitSqlStatements` tests move to `migrations.test.ts` |
| 2 | `login/route.test.ts` | only the raw `testDb.db.prepare(…).run()` (line 132) → `run(statement(…), { db: testDb.db })` (it still mocks `@opennextjs/cloudflare` until commit 3) |
| 2 | `lib/testing/routeHarness.ts` | `adminCookie(passwordHash, db: Db)`; header comment |
| 2 | `vitest.config.ts` | `resolve.alias` becomes an **array** (`@`, `server-only`, `client-only` entries kept) plus `{ find: /^@repo\/platform\/current$/, replacement: <abs>/packages/platform/testing/current.ts }` |
| 2 | `scripts/guards/no-server-imports-in-client.test.ts` | `SERVER_ONLY_RE` also matches `@repo\/platform\/current` and `@repo\/platform-cloudflare(?:\/[^'"]*)?`; the self-test's `packages/db/client.ts` assertion holds through its own `import 'server-only'` |
| 3 | `lib/config/appConfig.ts`, `siteUrl.ts`, `lib/auth/requireAdmin.ts` | `getPlatform().config()` |
| 3 | `app/api/admin/login/route.ts` | `config.admin.*`, `config.turnstile.secretKey`, `ipKey(ip, config.hashSalt)`; `getPlatform().defer(pruneRateLimits())` |
| 3 | `login/route.test.ts` | `useTestPlatform({ db, env })` replaces `vi.mock('@opennextjs/cloudflare')`; `await flushDeferred()` |

### The test platform (`@repo/platform/testing`)

State on `globalThis`. `useTestPlatform({ db?, env?, blobs? })` installs: `config()` parses the given
`env` object **live on every call** (tests mutate it mid-test); `blobs` defaults to a fresh
`memoryBlobStore()`; `db()` throws `no test db: call useTestDb(testDb.db) or pass { db }` when none.
`defer(task)` attaches a handler at call time (no unhandled rejection) and records it;
`flushDeferred()` awaits all recorded tasks and rethrows the first rejection. Without
`useTestPlatform`, the platform has `env = {}`, a fresh memory store and no db. `useTestDb(db | null)`
sets or clears only the db and never throws. `resetTestPlatform()` clears everything (call it in
`afterEach` where `useTestPlatform` is used).

### Errors

| Case | Status | `errorCode` | Built with |
| --- | --- | --- | --- |
| Minting with no usable mode | 503 | `MEDIA_NOT_CONFIGURED` | `new AppError(msg, 'MEDIA_NOT_CONFIGURED', { status: 503 })` |
| Bad, expired or mismatched token | 403 | `BLOB_TOKEN_INVALID` | `new AppError(msg, 'BLOB_TOKEN_INVALID', { status: 403 })` |
| Cross-origin upload | 403 | `FORBIDDEN` | `forbiddenError({ reason: 'cross_origin' })` |
| Content type or length mismatch, length missing | 400 | `INVALID_PARAMS` | `invalidParamsError(msg, field)` |
| Over `MAX_DEV_UPLOAD_BYTES` | 413 | `PAYLOAD_TOO_LARGE` | `new AppError(msg, 'PAYLOAD_TOO_LARGE', { status: 413 })` |
| Key exists | 409 | `BLOB_EXISTS` | `new AppError(msg, 'BLOB_EXISTS', { status: 409 })` |
| Missing object | 404 | `NOT_FOUND` | `notFoundError()` |
| Dev route outside development | 404 | `NOT_FOUND` | `notFoundError()` |
| `blobUrls` input out of bounds (type, key, size, expiry) | — | — | throws `AppError` with code `INVALID_BLOB_REQUEST` (status 400): a programming error in the caller |

`platform-cloudflare` tests import their modules relatively, never `@repo/platform/current` (which is
the test platform under vitest). Test-platform state lives on `globalThis`.

### Blob URLs

`blobUrls(config, now = () => Math.floor(Date.now() / 1000))` (called only by server code; the module
has no `server-only` import so the `tsx` probe can use it). **Mode**, in order: S3 if `config.media.s3`;
else dev if `config.isDevelopment && config.media.devSigningSecret`; else none (minting throws
`MEDIA_NOT_CONFIGURED`, also in development without the secret).

- `uploadUrl(key, { contentType, size, expiresInSeconds = 600 }): Promise<{ url, method: 'PUT', headers: { 'content-type' } }>`.
  Checks first (throw `INVALID_BLOB_REQUEST`, never clamp): `isBlobKey(key)`, `contentType ∈ MEDIA_TYPES`,
  `0 < size ≤ MAX_UPLOAD_BYTES` (dev mode: `MAX_DEV_UPLOAD_BYTES`), `expiresInSeconds ≤ 900`. S3 mode:
  presigned PUT on `${endpoint}/${bucket}/${key}` (key segments not re-encoded: the charset is URL-safe),
  `allHeaders: true`, `X-Amz-Expires` set; signed headers `content-type;host`. Dev mode: the **relative**
  URL `/api/blobs/upload?t=…` (`siteUrl` may be null).
- `readUrl(key, { expiresInSeconds = 300, downloadName? }): Promise<string>` (≤ 86400 in S3 mode, ≤ 3600
  in dev): presigned GET with `response-content-disposition: contentDisposition(downloadName)` (V5 checks
  R2 honours it), or relative `/api/blobs/read?t=…`.
- `publicUrl(key): string | null` (sync) → `${publicBaseUrl}/${key}` or `null`.

`contentDisposition(name)`: `attachment; filename="<ASCII, no CR/LF/quote/backslash/slash/control,
≤ 150>"; filename*=UTF-8''<percent-encoded>`.

`isBlobKey(key)`: 1–512 chars of `[a-z0-9._/-]`, first segment in `BLOB_PREFIXES`, no leading `/`, no
`//`, no `.` or `..` segment. Keys are never URL-decoded after checking.

### Dev routes and the token

Token: `base64url(payload) + '.' + base64url(mac)`; payload `{ v: 1, op: 'put' | 'get', key, exp, ct?, size?, dn? }`;
MAC key = HMAC-SHA256(`MEDIA_DEV_SIGNING_SECRET`, `"memoria:blob:v1"`) (domain separation).
`signBlobToken(payload, secret)` and `verifyBlobToken(token, secret, now)`: `exp` and `now` are **Unix
seconds** (`number`). Verify: reject if longer than 2048 chars, then `crypto.subtle.verify` over the raw
payload bytes, then `JSON.parse`, then `v`, `op`, `exp > now`, `isBlobKey`, and for `put`
`ct ∈ MEDIA_TYPES`. Verify does **not** bound `size` (the route does, so a hand-minted token can test
the 413).

Both routes: `withErrorHandling`, in this **order**: (1) 404 unless `config.isDevelopment`; (2) token
(bad → 403 `BLOB_TOKEN_INVALID`, logged as `blob_token_invalid` without the token; never a 404 for a
bad token); (3) upload only: same-origin (`isSameOrigin`: a missing `Origin` without `sec-fetch-site`
fails); (4) headers and length. Responses carry `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, `Referrer-Policy: no-referrer` (Next also adds
the global CSP from `next.config.mjs`: tests assert the route's own response, V4 prints what the
browser gets). URLs and tokens are never logged.

- `PUT /api/blobs/upload?t=`: `Content-Type` = token `ct`; `Content-Length` present and = token `size`;
  `size ≤ MAX_DEV_UPLOAD_BYTES` (checked before reading; else 413); `await req.arrayBuffer()`; byte
  length = `size`; `blobs().put(key, bytes, { contentType, ifAbsent: true })`; `false` → 409
  `BLOB_EXISTS`; `{ data: { key, size, etag } }`.
- `GET /api/blobs/read?t=`: `head()` → 404 if missing; `If-None-Match` = `etag` → 304; else `get()` and
  stream with `Content-Type` (the stored type if in `MEDIA_TYPES`, else `application/octet-stream` +
  attachment), `Content-Length`, `ETag`, `Cache-Control: private, max-age=<seconds left>`,
  `Content-Disposition` from the token's `dn`.

Files: `src/lib/media/devBlobRequest.ts` (pure: the order above as `checkUpload(req, config, now)` /
`checkRead(…)` → a result or an error response) and `src/lib/media/blobResponseHeaders.ts` (pure).

The memory adapter: `etag` = quoted first 16 hex chars of the bytes' SHA-256; `list` cursor = the last
key returned. Contract suites: `describeDbContract(name, setup: () => Promise<{ db: Db; dispose(): Promise<void> }>)`
and `describeBlobStoreContract(name, setup: () => Promise<{ blobs: BlobStore; dispose(): Promise<void> }>)`.

### Configuration files

- `wrangler.jsonc`: `"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "memoria-media" }]`; vars
  `MEDIA_PUBLIC_BASE_URL: ""`, `MEDIA_S3_ENDPOINT: ""`, `MEDIA_S3_BUCKET: "memoria-media"`;
  `npm run cf-typegen`. Guard `wrangler-config` gains: `MEDIA_S3_BUCKET` equals `r2_buckets[0].bucket_name`;
  `NEXTJS_ENV` is never in `vars`.
- `.dev.vars.example`: `MEDIA_DEV_SIGNING_SECRET` (a ≥ 32-char local value), `MEDIA_S3_ACCESS_KEY_ID=`,
  `MEDIA_S3_SECRET_ACCESS_KEY=` (empty locally), each commented. Developers copy the new lines into
  their `.dev.vars`.
- `apps/web/r2-cors.json` in **wrangler's** format (`{ "rules": [{ "allowed": { "origins", "methods",
  "headers" }, "exposeHeaders", "maxAgeSeconds" }] }`; checked with `wrangler r2 bucket cors set --help`
  when written): origins `http://localhost:3210`, `http://localhost:8787` and the production origin
  (a placeholder replaced at setup); methods `PUT`, `GET`, `HEAD`; headers `content-type`; expose `ETag`,
  `Content-Length`, `Content-Disposition`; max age 3600.
- Root script `media:probe` (`tsx scripts/media-probe.ts <base-url>`): reads `apps/web/.dev.vars` (simple
  `KEY=value` lines, `#` comments), builds URLs with `blobUrls` in dev mode, PUTs a built-in 1×1 PNG to
  `dev/probe-<random>.png` with the `origin` header, GETs it back, compares bytes, prints the response
  headers and PASS/FAIL. Refuses to run without the dev secret. Probe objects live only in the local
  bucket; no cleanup.

Not in Phase 1 (recorded in the consumer plans): the CSP `connect-src`/`img-src` entries for the S3
endpoint and the media domain (Phase 5 / Phase 6), Phase 5's `head()` size check on registration and a
sweep of abandoned uploads, a cookieless media domain (index, open question 3).

## Workstreams

### A. The neutral package

- **T1.1** `npm install` with the two new workspaces and `aws4fetch` in root `dependencies`; commit the
  lock. `packages/platform`: `package.json`, `ports.ts`, `config.ts`, `media.ts`, `blobToken.ts`,
  `memory/blobStore.ts`, `testing/platform.ts`, `testing/current.ts`.
- **T1.2** `blobUrls.ts`.
- **T1.3** `contract/db.ts`, `contract/blobStore.ts`; the memory adapter passes the blob suite.

### B. The Cloudflare package and the database layer

- **T1.4** `packages/platform-cloudflare`: `d1.ts`, `env.ts`, `platform.ts`, `next.ts`, `testing/proxy.ts`;
  `packages/platform/current.ts`; the vitest alias; a sentinel test (`getPlatform().name === 'test'`).
- **T1.5** `@repo/db` on the ports (`client.ts`, `rows.ts`, `migrations.ts`, `test-utils.ts` and their
  tests); query modules, `session.ts`, `rateLimit.ts`, logout route, `routeHarness.ts`; the client-import
  guard update; the `Db` contract suite on D1.

### C. Config, auth and work after the response

- **T1.6** `appConfig.ts` (+ test: no secret field in `AppConfig`), `siteUrl.ts`, `requireAdmin.ts`, the
  login route and its test on the test platform.

### D. The boundary guard

- **T1.7** `scripts/guards/platform-boundary.test.ts` over `apps/web/src`, `apps/web/scripts`, `packages`,
  `scripts` (`.ts`, `.tsx`, `.mjs`; tests included):
  - module specifiers only: `from`/`import()`/`require()` of `@opennextjs/cloudflare`, `wrangler`,
    `@repo/platform-cloudflare` (any subpath), any `cloudflare:` specifier; a `getCloudflareContext(` call;
  - identifiers (`\b…\b`): `D1Database`, `D1PreparedStatement`, `D1Result`, `D1Meta`, `R2Bucket`,
    `R2Object`, `ExecutionContext`, `CloudflareEnv`, `KVNamespace`, `FixedLengthStream`;
  - `@repo/platform/contract/*` imported only from `*.test.ts`;
  - allowed files: `packages/platform-cloudflare/**`, `packages/platform/current.ts`,
    `packages/db/test-utils.ts`, `apps/web/worker.ts`, `next.config.mjs`, `open-next.config.ts`,
    `scripts/guards/platform-boundary.test.ts` and `scripts/guards/wrangler-config.test.ts` (their
    samples and regexes name the banned identifiers);
  - comments stripped; self-test: a bad sample per rule and a good one containing the string
    `"npx wrangler secret put"`; asserts the sentinel `apps/web/src/lib/auth/requireAdmin.ts` was scanned.

### E. R2 and the dev routes

- **T1.8** `wrangler.jsonc` binding and vars, `.dev.vars.example`, `cf-typegen`, the `wrangler-config`
  guard rows; `r2.ts`; `blobs()` wired; the blob contract suite on R2 through the proxy. First step: a
  spike test that `put(bytes)`, `get().body` and `onlyIf` work through the proxy; adjust `r2.ts` per D1.3's
  fallback before writing the rest.
- **T1.9** `src/lib/media/` (request checks), `app/api/blobs/upload/route.ts`, `app/api/blobs/read/route.ts`,
  route tests (memory blob store), `scripts/media-probe.ts`, `r2-cors.json`.

### Docs in the commit that changes the behaviour

The wiki rule ("update the doc in the same commit") applies inside this phase:

- commit 1: plan status `in-progress` (plan, index table, `docs/README.md`);
- commit 2: `AGENTS.md` → Data rules and Where to look (builders are pure and take no `opts`; the
  `Db` port; `@repo/db/test-utils` on the proxy; `rows.ts` stays pure);
- commit 3: `AGENTS.md` → Cloudflare rules (env and bindings only through `getPlatform()`, or
  `cloudflarePlatform(env, waitUntil)` in a Worker entry; never `getPlatform()` at import;
  `getPlatform().defer` instead of `ctx.waitUntil`); `docs/recipes.md` (a var/secret = a `Config`
  field + test);
- commit 4: `AGENTS.md` → Guards (`platform-boundary`);
- commit 5: `AGENTS.md` → API routes (the dev-route exception, D1.9) and the media rules (D1.8);
  `docs/deployment.md` (R2 bucket, CORS, R2 API token, `MEDIA_*`); `docs/recipes.md` (a binding = a port
  method in the adapter);
- commit 6: the rest below; plan status `done` after V1–V4.

### F. Docs

- **T1.10** (commit 6; the per-commit docs above are part of their commits) `docs/architecture.md`: the
  platform layer and package graph, media modes, the Docker path (alias `@repo/platform/current` with
  `turbopack.resolveAlias` to a Node platform; unproven, to verify in that phase). `docs/deployment.md`
  check: `MEDIA_S3_ENDPOINT` = `https://<account>.r2.cloudflarestorage.com`, a bucket-scoped R2 API token
  (object read/write). Index: Phase 1 decisions, ports list (Mailer/Jobs → Phase 3), verify-before-building
  rows moved to Phase 5. Consumer plans: p03 (`cloudflarePlatform(env, waitUntil)` in the relay), p05 (CSP for the S3
  endpoint, `head()` size check, sweep job, generated keys), p06 (`publicUrl` vs `worker.ts` protected
  path, CSP `img-src`), p09 (`readUrl` + `downloadName`, CORS exposes `Content-Length`).

## Tests

| Test | What |
| --- | --- |
| `platform/config.test.ts` | table: every field; trimming; empty → closed/null; email lower-cased; trailing slashes; `s3` only with all four; dev secret < 32 chars → null |
| `platform/media.test.ts` | `isBlobKey` table (valid; `..`, `.`, `//`, leading `/`, upper case, space, `%`, `\`, NUL, unknown prefix, 513 chars); `contentDisposition` table (CR/LF, quotes, slashes, Unicode, 200 chars) |
| `platform/blobToken.test.ts` | round trip; tampered payload or MAC; wrong secret; expired at `exp`; wrong op; bad key; disallowed type; > 2048 chars |
| `platform/blobUrls.test.ts` | dev URLs; S3 PUT: host, path, `X-Amz-Expires`, `X-Amz-SignedHeaders=content-type;host`, fixed-date signature; S3 GET with disposition; 900/901 and 86400/86401 boundaries throw; disallowed type, bad key, oversize throw; production without S3 → `MEDIA_NOT_CONFIGURED`; `publicUrl` |
| `platform/memory/blobStore.test.ts` | the blob contract |
| `platform/testing/current.test.ts` | sentinel: `getPlatform().name === 'test'`; an unflushed rejected `defer` fails `flushDeferred()` |
| `platform-cloudflare/d1.test.ts` | the `Db` contract on D1: all/first/run, `changes` > 0 with a trigger table (compare with 0), `lastRowId`, batch rollback, `null` round trip |
| `platform-cloudflare/r2.test.ts` | the blob contract on R2 (proxy): put/get/head, overwrite, `ifAbsent`, delete many, list prefix + paging, missing → null, quoted etag |
| `platform-cloudflare/platform.test.ts` | `stringEnv` drops bindings; `defer` calls the given `waitUntil` at call time; commits 2–4: `blobs()` → `MEDIA_NOT_CONFIGURED` (commit 5 replaces it with "returns the R2 store") |
| `db/client.test.ts`, `rows.test.ts`, `migrations.test.ts` | `statement()` rejects `undefined`/booleans; `batch([])`; helpers on the test DB; split tests moved |
| `lib/config/appConfig.test.ts` | no field of `AppConfig` holds a secret value from the env |
| `app/api/blobs/upload/route.test.ts` | happy path (stored, readable); 404 outside development; cross-origin 403 and missing `Origin` 403 (request built with `'sec-fetch-site': ''`); bad/expired/`get` token 403; `text/html` or SVG: `blobUrls` refuses to mint, and a hand-minted token is refused; type mismatch 400; missing or wrong length 400; > 32 MB 413 (hand-minted token, header only, no body sent); existing key 409 |
| `app/api/blobs/read/route.test.ts` | headers (nosniff, sandbox CSP, no-referrer, private cache, etag); download name; 304; missing 404; bad token 403 even for a missing key; `put` token 403; 404 outside development |
| `app/api/admin/login/route.test.ts` | the existing cases on the test platform |
| `guards/platform-boundary.test.ts`, `wrangler-config` rows | as T1.7 and T1.8 |

Every existing test keeps its assertions; changes to existing tests are mechanical (imports, `opts`,
fake `Db`).

## Risks and edge cases

- **Commit 2 is the widest** (every query module). It changes call shapes only; the existing D1 query
  tests are the net, plus the `Db` contract suite.
- **The proxy may not carry `get().body` or `onlyIf`.** T1.8 starts with a spike test and records the
  fallback in `r2.ts` and the port comment.
- **`next dev` vs workerd:** the R2 adapter uses only `put(bytes)` and `get().body`, both supported by
  the binding and the proxy; no `FixedLengthStream`.
- **Memory:** dev uploads are buffered (≤ 32 MB) in a Node process or a 128 MB isolate (preview).
- **Signed `content-length`** is not relied on; Phase 5 enforces size after upload.
- **Bundle size:** measured before and after (V2) against the current Workers limit.
- **Account setup:** R2 must be enabled on the Cloudflare account (the dashboard may ask for billing
  details); not needed for Phase 1 code, tests or CI.

## Verification

Git Bash, repo root.

1. `npm ci` (lock in sync); `npm run verify`; `npm run build:worker`.
2. `npm run build:worker && cd apps/web && npx wrangler deploy --dry-run --outdir ../../tmp/dry && ls -l ../../tmp/dry && gzip -c ../../tmp/dry/*.js | wc -c`:
   once **before commit 1** (baseline) and at commit 5; record both in commit 5's message.
3. `npm run db:migrate:local`, then `npm run preview` (with `.dev.vars` updated), then:

   ```sh
   curl -s -i -X POST http://localhost:8787/api/admin/login -H 'content-type: application/json' \
     -H 'origin: http://localhost:8787' \
     -d '{"email":"admin@example.local","password":"local-dev-password-2026","turnstileToken":"x"}' \
     | grep -iE '^HTTP|^set-cookie'
   ```

   → `200` and a `memoria_admin` cookie.
4. Same preview: `npm run media:probe -- http://localhost:8787` → `PASS`. Stop the preview by its process
   tree.
5. Manual, once an account exists (Phase 5's verify-before-building): presigned PUT and GET against the
   real bucket from a browser with the CORS rules; `response-content-disposition`; whether a wrong
   Content-Type fails.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(platform): ports, config, media rules, blob tokens and URLs` | T1.1–T1.3 | `npm ci` |
| 2 | `refactor(db): the database layer on the Db port` | T1.4–T1.5 | `build:worker` |
| 3 | `refactor: config and deferred work through the platform` | T1.6 | `build:worker`, V3 |
| 4 | `test(guards): the Cloudflare boundary` | T1.7 | — |
| 5 | `feat(media): R2 behind the BlobStore port, dev upload and read routes` (includes the regenerated `cloudflare-env.d.ts`) | T1.8–T1.9 | `build:worker`, V2, V4 |
| 6 | `docs: platform layer, media setup, the Docker path` | T1.10 | — |

## Checklist

- [x] T1.1 Workspaces linked, lock committed; ports, config, media rules, tokens, memory store, test platform
- [x] T1.2 `blobUrls`
- [x] T1.3 Contract suites; memory store passes
- [x] T1.4 `@repo/platform-cloudflare` (D1, env, platform, next, proxy); composition root; vitest alias
- [x] T1.5 `@repo/db` on the ports; call sites; client-import guard; `Db` contract on D1
- [x] T1.6 Config, auth, login on the platform
- [ ] T1.7 Guard `platform-boundary`
- [ ] T1.8 R2 binding, adapter, proxy spike, contract on R2, `wrangler-config` rows
- [ ] T1.9 Dev routes, `media:probe`, CORS file
- [ ] T1.10 Docs, index and consumer plans
- [ ] Verification 1–4

## Open questions

None blocking Phase 1. Before Phase 5 ships to production: enable R2 on the Cloudflare account, choose
the media domain (index, open question 3), run Verification 5.
