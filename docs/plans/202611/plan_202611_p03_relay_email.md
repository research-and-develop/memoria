---
title: "Phase 3: Relay Worker and email"
type: plan
status: draft
updated: 2026-11-13
related: [plan_202611_mvp.md, plan_202611_p01_core_adapters.md, plan_202611_p02_admin_totp.md, plan_202611_p02b_settings_db.md, ../../architecture.md, ../../deployment.md, ../../../AGENTS.md]
---

# Phase 3: Relay Worker and email

## Goal

A second Worker, `memoria-relay`, runs background jobs from a D1 `jobs` table and sends email. The app
enqueues a job in the same `batch` as the change that causes it and nudges the relay; a Cron Trigger
runs what the nudge missed, retries and scheduled jobs. The photographer chooses how email is sent
(their own SMTP server, Brevo, Amazon SES or Microsoft 365) in Settings → Emails, sends a test email,
sees which emails went out, are retrying or failed, and retries a failed one. The admin is told by
email about sign-ins and security changes.

**Done when:**

- `apps/relay` deploys as `memoria-relay`: no public URL, the same D1 and R2 bucket as `memoria`, a
  Cron Trigger every minute, a service binding `RELAY` from `memoria`. It runs the **same domain
  code** as the app (query modules, job handlers, templates, settings) through its own composition root.
- A job enqueued by the app runs within seconds (nudge) or within a minute (cron) when the nudge is
  lost. A failing job retries with backoff and ends `failed` after its last attempt. At most one
  runner holds a job's lease; a runner that died is replaced after the lease, never sooner.
- Four adapters behind one `Mailer` port: **SMTP** (our client; 587 STARTTLS or 465 TLS, certificate
  checked), **Brevo** (HTTPS API), **Amazon SES** (HTTPS API, raw MIME), **Microsoft 365** (Graph,
  OAuth client credentials, raw MIME). Every message has a plain-text and an HTML part, Cyrillic
  subjects and names are encoded correctly, no header or SMTP command can be injected, no address
  reaches a log.
- **Settings → Emails**: the provider and its credentials (secrets encrypted at rest, never shown
  again), the From address and name, reply-to, the security-notice switch; saving needs a code; a
  test email reports its outcome live; the recent emails list (queued, sending, sent, retrying, failed
  with the reason; Retry on failed).
- **Security notices** to the account email: a new sign-in, an authenticator added or removed,
  recovery codes regenerated or one used, the email or the password changed (the old address told
  too), sign-in locked.
- Locally: `npm run dev` + `npm run dev:relay` share the local D1; Mailpit catches the email; the
  `.dev.vars` SMTP settings work until a provider is saved in the studio.
- CI checks and builds both Workers; deploy migrates, then ships the relay, then the app.
- **Email leaves Cloudflare's edge** through the chosen provider (Verification 4, after local
  verification and once the accounts exist). The phase is not `done` before that passes.

- **Depends on:** Phase 1, **Phase 2b** (the settings store pattern, the account email, the studio
  name and website address). **Unblocks:** Phases 4 (sender branding), 5 (R2 cleanup job, the email
  preview), 7 (submit email), 8 (delivery email), 10 (reminders, expiry jobs), 11 (IP expiry job).
- **Mockups:** `Settings.dc.html` (settings layout), `NewGallery.dc.html` (the email preview, Phase 5).
- **Scope (feature IDs):** B8 (email settings), A3/A4 (security notices), the infrastructure for I5,
  K3; the job runner for R2 cleanup and IP expiry.

## Starting point (verified 2026-11-13)

- One Worker: `apps/web` (`wrangler.jsonc` `name: memoria`, entry `worker.ts`, OpenNext,
  `compatibility_date` 2026-10-15, `nodejs_compat` + `global_fetch_strictly_public`). Its env type is
  the generated `cloudflare-env.d.ts` (`CloudflareEnv`, 16k lines with the runtime types), included by
  the root `tsconfig.json` and the app's. **It declares no `cloudflare:sockets` module** (only
  `cloudflare:email`, `cloudflare:node`, `cloudflare:durable-objects`; a global `interface Socket` exists).
- `cloudflarePlatform(env, waitUntil)` takes `{ DB, MEDIA }` and imports nothing from OpenNext;
  `next.ts` wraps it for Next code; `@repo/platform/current` exports only `getPlatform`; vitest aliases
  it to the test platform.
- `@repo/db/client` imports `server-only` and `@repo/platform/current`. Query modules import only
  `@repo/db/client` and their siblings (no `@/`); domain code in `lib/**` uses `@/`.
- `@repo/logger` reads `process.env` at module scope (filled by `nodejs_compat` from 2025-04-01).
- `tokenHex(role)` lives in `packages/ui/colorContrast.ts` (a test helper); the theme is
  `packages/ui/theme/studio.mjs`. Guard `no-raw-colors` scans `apps/web/src` and `packages/ui`.
- Guards that assume one app: `wrangler-config` (one config, `CloudflareEnv`, `measure-cpu.mjs`
  `WORKER`), `platform-boundary` (`ROOTS`, allowed `apps/web/worker.ts`), `file-size` (roots),
  `SOURCE_INDEX_ROOTS`, `GENERATED_FILES`; vitest `include`; `packages/platform-cloudflare/testing/proxy.ts`
  runs `getPlatformProxy` on `apps/web/wrangler.jsonc`.
- `audit_log.action` allows `create`, `update`, `delete`, `login`, `logout`; `conditionalAuditStatement`
  writes `WHERE <condition>`. `hitRateLimits(rules)` = fixed windows by upsert.
- Settings: `components/admin/settings/nav.ts` exports the type `SettingsSection` and lists Emails as
  *Soon* (phase 4); the card used by Security is `SecuritySection.tsx`, which Phase 2b promotes to
  `components/admin/settings/SettingsCard.tsx`. p04 T4.4 lists "test email".
- The email validator deleted in Phase 0 (`lib/validation/email.ts`, `a581b72`) is not coming back:
  `parseEmailAddress` (`@repo/core/email`, Phase 2b) replaces it.
- No production D1 or Worker exists (`database_id` all zeros): `0005` may be edited until the first
  `db:migrate:remote`.
- **Cloudflare facts** (docs, 2026-11-13): `cloudflare:sockets` blocks port 25, Cloudflare IPs,
  localhost and private IPs in production; `secureTransport` `off`/`on`/`starttls`, `startTls()` once
  (returns a new socket), sockets only inside a handler; 6 simultaneous connections per invocation.
  Free plan: 10 ms CPU per HTTP request **and** per Cron invocation (the whole invocation, `waitUntil`
  work included), cron wall 15 min, `waitUntil` ≤ 30 s after the response, 50 subrequests, 50 D1
  queries, **5 Cron Triggers per account**. A service binding call is a subrequest of the caller.
  Cloudflare Email Sending is beta and **not on the free plan** for arbitrary recipients. Queues
  (10k ops/day, 24 h retention) and Workflows are on the free plan. Local scheduled trigger:
  `/cdn-cgi/local/scheduled` (accepts `?time=`).
- **Spike** (2026-11-13, wrangler 4.160.1, throwaway `apps/relay-spike`, deleted):
  - wrangler's esbuild applies tsconfig `paths` **per nearest tsconfig**: the relay's `paths` do not
    reach files in `packages/*` (`server-only` unresolved; `@repo/platform/current` silently resolved
    to the Next root). The wrangler `tsconfig` field is cwd-sensitive. **wrangler `alias`** (paths
    relative to the config, run from the repo root) redirects both for every file: a 13 KB bundle
    with a query module, `@repo/db/client`, the logger and the D1/R2 adapters, and no
    `@opennextjs`, `getCloudflareContext` or `server-only`. `@/` in `apps/web/src` resolves through the
    app's own tsconfig.
  - `AsyncLocalStorage` (`node:async_hooks`, `nodejs_compat`) carries the platform across awaits in workerd.
  - On D1 (`getPlatformProxy`): `UPDATE … WHERE id = (SELECT … LIMIT 1) … RETURNING` returns the row
    through `.all()`; 12 parallel claims on 8 due rows returned 8 distinct jobs and 4 empty results;
    `ON CONFLICT (dedupe_key) DO NOTHING` ignores a duplicate (changes 0) and never a NULL key; the
    kind CHECK accepts `email`, `housekeeping`, `r2.sweep` and refuses `Email`, `a-b`, `''`;
    `DELETE … WHERE id IN (SELECT … LIMIT 500)` works.
  - Local workerd `connect()` to `127.0.0.1` works (a Node server's `220` greeting read back).
  - Two configs with the same `database_id` and the same persist path share one local D1 file.
  - Not tried (long-running): `wrangler dev` of the relay on the app's real `.wrangler/state`, and the
    dev-registry `RELAY` binding from `next dev`.
- **Phase 2b** (planned before this phase): `admin_account` in D1 (`getAdminAccount()`), the
  `studio` row in `site_settings` (`getStudio()`: name, website address), "effective value = D1, else
  env, else default", guard `settings-through-store`, `SettingsCard`, `@repo/core/email.ts`
  (`parseEmailAddress`), migration `0004`. This phase's migration is `0005`.
- **Provider APIs** (official docs, 2026-11-13): *Brevo* `POST https://api.brevo.com/v3/smtp/email`
  (`api-key` header; JSON `sender`, `to`, `replyTo`, `subject`, `htmlContent`, `textContent`,
  `headers`; 201 `{ messageId }`; **no raw MIME**; standard headers such as `Message-ID` cannot be set;
  an `idempotencyKey` header and a `duplicate_request` 400 exist; IP allow-listing on an account breaks
  a Worker). *SES v2* `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails` (SigV4,
  service `ses`; `Content.Raw.Data` = base64 MIME, `FromEmailAddress`, `Destination`; 200
  `{ MessageId }`; errors by `x-amzn-ErrorType`; SES replaces the Message-ID; sandbox until production
  access: verified recipients, 200/day). *Microsoft Graph* (app-only): token
  `POST https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token` (client credentials,
  `scope=https://graph.microsoft.com/.default`, ~1 h), `POST https://graph.microsoft.com/v1.0/users/<mailbox>/sendMail`
  with `Content-Type: text/plain` and the base64 MIME → 202 (a copy goes to Sent Items); application
  permission `Mail.Send`, scoped to one mailbox with **RBAC for Applications in Exchange Online**
  (replaces Application Access Policies), the tenant-wide grant removed. Exchange Online disables
  Basic-auth SMTP AUTH by default for existing tenants at the end of December 2026. *Google* (later):
  Gmail API `users.messages.send` with raw MIME, service account + domain-wide delegation.
- `worker-mailer@1.3.1` (MIT, no deps) was read and **not adopted** (D3.6): `cloudflare:sockets` at
  module scope; no CR/LF check in subjects, names, addresses or custom headers (header and SMTP
  command injection: `MAIL FROM: <${email}>`); RFC 2047 Q-words without the 75-character limit (long
  Cyrillic subjects break); no folding; errors are raw server text; an unanswered private security
  report (#56).

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D3.1 | **Jobs live in a D1 table**, not Cloudflare Queues or Workflows. | Portable (Docker = the same table), no 24 h retention, the job row joins the batch of its cause (a Queue send cannot), and the admin can list and retry it. Cost: about 15 D1 rows written per email. |
| D3.2 | **`apps/relay` is a second entry into the same domain code.** Handlers, query modules and templates live in `apps/web/src/lib/**`. The relay's `wrangler.jsonc` **`alias`** redirects `@repo/platform/current` to `packages/platform-cloudflare/relay.ts` and `server-only` to an empty module (spike); its `tsconfig.json` `paths` say the same for `tsc` and the editor (guard: they agree). Guard `relay-graph` walks the relay's imports with that alias map and refuses Next, React, OpenNext, `@repo/api`, `@repo/ui` (except `theme/`) and the Next composition root. | One place for SQL and templates (AGENTS.md); later phases add handlers without moving code; the boundary is checked, not hoped for. |
| D3.3 | **The relay's composition root is an `AsyncLocalStorage`** in `packages/platform-cloudflare/relay.ts`: `withPlatform(platform, fn)` per invocation; `getPlatform()` outside one throws. It exports every name `packages/platform/current.ts` exports (guard). | `getPlatform()` keeps its rule; overlapping invocations in one isolate cannot see each other's env; `apps/relay/src` stays one file. |
| D3.4 | **Only the relay runs jobs.** The app enqueues (a statement in its batch) and nudges (`getPlatform().jobs().nudge()` in `defer`). The relay drains on the nudge (`POST /run` through the service binding, answered `202` at once, the drain in `waitUntil`) and on a cron **every minute** (the drain awaited). | SMTP sockets never enter the Next bundle; one runner; the cron is the safety net, and runs retries and scheduled jobs. |
| D3.5 | **Claim with a lease, fence with the attempt number.** One `UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING` claims a due `pending` job, increments `attempts`, sets `status = 'running'` and `run_after` = the lease end (2 min). Every finishing write has `WHERE id = ? AND status = 'running' AND attempts = ?`. Each drain first turns expired leases back into `pending` **10 minutes later** (`LEASE_EXPIRED`), or `failed` when no attempt is left. Attempts count at claim, so a job that kills its invocation every time still ends. | No read-check-write; a stale runner cannot overwrite a newer attempt; a dead runner's job waits instead of re-running at once. |
| D3.6 | **Our own SMTP client and MIME builder**, platform-neutral in `@repo/platform/mail/*` over a small socket interface; the Cloudflare adapter only wraps `connect()`. Not `worker-mailer`, not nodemailer (Node sockets; unproven on Workers). | Injection refused by construction; correct RFC 2047; the protocol is tested in Node against a scripted server; a Docker adapter later wraps `node:tls` with the same code. ~500 lines with tests. |
| D3.7 | **SMTP**: STARTTLS on 587 or implicit TLS on 465; the certificate is checked against the SMTP host (a DNS name; an IP literal is refused outside development); `AUTH PLAIN` only, only after TLS; `SMTP_SECURITY=none` (Mailpit) only in development. One connection per email. **`send` resolves at the `250` reply to the message data**; the runner writes `done` at once; `QUIT` follows in the background, capped at 1 s, never delaying `done`. | Credentials never cross in clear; the window in which a delivered email is not yet recorded is one D1 write. |
| D3.8 | **Email jobs render at send time** in the relay from `{ v, template, to, params }` (the recipient fixed at enqueue, or `{ account: true }`, resolved by the relay when sending, D3.19). Templates are pure functions `render(params, ctx)` → `{ subject, text, html }` with `ctx: EmailContext = { studioName, siteUrl, link(path) }` from `getStudio()` (Phase 2b). The From address and name and the reply-to come from the mail settings (D3.17). Every parameter is escaped; colours come from the studio theme; links only through `ctx.link(path)` (the website address + a path starting with `/`; none → the job retries with `SITE_URL_MISSING`); dates through `lib/dates.ts`. The same functions render the New gallery preview (Phase 5) with no mailer. | One renderer for sending and previewing; the request stays cheap; branding read when sending. |
| D3.9 | **Errors and retries.** SMTP: 4xx, timeouts and dropped connections retry; 5xx fail at once, except 530/534/535 (authentication = configuration), which retry and log `mail_auth_failed` (error). A handler throws `JobError(code, { permanent })`; anything else is transient. Email: 6 attempts after 1, 5, 30, 120, 480 minutes. **The test email gets one attempt.** An unknown kind, an unknown template or a payload `v` newer than the code (version skew, a rollback) is put back 10 minutes later **without spending an attempt**, and fails `UNKNOWN_KIND` once it is more than 24 h past `created_at`; `JOB_INVALID` (permanent) only for a known kind and version whose payload does not parse. A pending job that has been due for 7 days fails `EXPIRED` (the relay was down). `MAIL_NOT_CONFIGURED` spends attempts like any transient error (a failed email can be retried from Settings). | A fixed password recovers queued email; a rejected address does not retry for 11 h; a rollback does not destroy queued email; nothing waits forever. |
| D3.10 | **Housekeeping is a job**: from 03:00 UTC the cron enqueues `housekeeping` with the key `housekeeping:<UTC date>`, by an `INSERT … SELECT … WHERE NOT EXISTS` (no write when present). It deletes jobs finished more than 30 days ago (≤ 500 per run) and fails `EXPIRED` ones (D3.9). Phases 5 and 11 add steps (R2 sweep, IP expiry). | Retries for free; one cron expression (the account has 5). |
| D3.11 | **Privacy.** `MailError.message` is a code (`SMTP_550`, `SMTP_TIMEOUT`, `SMTP_TLS`, …); the server's text goes only to `jobs.last_error` (admin only, ≤ 500 characters) after `maskAddresses` (every `\S+@\S+`, the job's recipient and `SMTP_USERNAME` replaced) and removal of control characters. Logs carry job ids, kinds, templates and codes, never an address, a name or a parameter; the SMTP client never logs a transcript. On `done`, `params` are dropped from the payload (the recipient stays for the 30-day list); audit rows hold `{ jobId, template }`. | AGENTS.md → never log a visitor's email; the database keeps no more than the admin list needs. |
| D3.12 | **Settings → Emails is built in Phase 3**: the provider form (D3.17), the security-notice switch, the test email, recent emails and retry. Phase 4 adds template text and branding. | The only way to configure and see email; the nav entry drops `soonPhase` here. |
| D3.13 | **The relay has no public URL**: `workers_dev: false`, `preview_urls: false`, no `routes` (guard), checked again in the dashboard on the first deploy. `fetch` answers `POST /run` and 404 otherwise; `/run` only drains due jobs. | No secret between the Workers; a leaked route could do nothing new. |
| D3.14 | **Deploy order: migrations → relay → app.** The relay must know a job kind or template before the app enqueues it. A kind or template is never removed while rows may use it: it stays as a handler that fails permanently with a reason for 30 days. | Version skew between two Workers built from one commit. |
| D3.15 | **Rules for emails to visitors** (Phases 7–10, recorded now): a public route that enqueues email to an address a visitor typed caps it per recipient (2 a day, `rate_limits`) and overall (a daily cap); visitor-typed names never go into a subject or a From/Reply-To header, and are stripped of control and bidi characters and limited to 60 characters; reminders carry `List-Unsubscribe` (Phase 10). | The studio's domain must not become a relay for strangers' phishing. |
| D3.16 | **Four adapters, one port** (user, 2026-11-13): SMTP, Brevo, Amazon SES, Microsoft 365. The HTTPS ones are plain `fetch` (no sockets, no TLS work in JavaScript) and are also the answer if SMTP cannot leave Cloudflare's edge. Google Workspace (Gmail API) is a later adapter. | The photographer uses what they already have; SMTP from Workers is unproven until Verification 4. |
| D3.17 | **Mail settings live in D1** (`site_settings` row `mail`, Phase 2b's rule): provider, its fields, From address and name (default: the studio name), reply-to. Only the chosen provider's block is kept. **A saved secret is kept only when every other field of that provider's block is unchanged**; changing a host, username, key id, tenant, client id or mailbox requires the secret again (`SECRET_REQUIRED`), so a saved credential can never be sent to a new destination. **Secrets** (SMTP password, Brevo key, SES secret key, Microsoft client secret) are AES-GCM under a key derived (HKDF, `info` `memoria:settings:secret:v1`) from a new deploy-level secret **`SETTINGS_ENCRYPTION_KEY`** (32 bytes, base64; both Workers), `v1:` + base64url(IV ‖ ciphertext), **AAD = `mail.<provider>.<field>`**. They are never sent to the browser (the form shows "Saved — leave empty to keep"). Without a `mail` row, the `.dev.vars` SMTP settings are used (development). | A photographer configures email without a deploy; a D1 export alone reveals no credential; the relay gets a key that cannot decrypt two-factor secrets (`TOTP_ENCRYPTION_KEY` stays on the app only). |
| D3.18 | **Saving mail settings needs a code** (the D2.9 window) and is audited without secrets. A save is followed by a test email offer, not an automatic send. The save also enqueues `security.mail-settings-changed` (provider and From domain only), **sent through the settings that were in force before the change** (a snapshot of the previous row, secrets still encrypted, in the job's `params`, dropped when the job ends, `done` or `failed`); with no previous settings it uses the new ones. | Whoever controls the mail settings can read or redirect the studio's email; a redirect must not swallow its own warning. |
| D3.19 | **Security notices** (user, 2026-11-13) go to the account email when notices are on (`site_settings` row `security_notices` = `{ enabled }`, absent = on) and email is configured; otherwise no job is written. Events: a new sign-in (device label, country, by app or recovery code), an authenticator added or removed, recovery codes regenerated, a recovery code used to confirm a change, the email changed (to the old **and** the new address), the password changed, the mail settings changed (D3.18), sign-in locked (the daily limit reached). The notice joins the event's own batch, conditioned on the event having happened. Recipient `{ account: true }` = the account email **resolved by the relay when sending** (`email-changed` carries both explicit addresses). No codes, secrets, counts or links that act; the text says what to do if it was not you (sign in and check Settings → Security; the installer can run `admin:mfa -- reset`). The CLI commands send none (the owner's local action). | An attacker who gets in is seen; a notice exists only if the event happened. |
| D3.20 | **The provider's message id is the delivery reference.** `Mailer.send` resolves with `{ providerMessageId }`, kept in the finished job's payload. Our Message-ID (the job id) survives only with SMTP and Microsoft 365; Brevo and SES assign their own. Brevo gets the job id as its `idempotencyKey`, and its `duplicate_request` counts as sent. | At-least-once delivery stays traceable whichever provider is used. |

## Design

### Topology

```
browser ─► memoria (apps/web)                         memoria-relay (apps/relay, no public URL)
             route: batch([change, audit, enqueue])     fetch POST /run → 202; waitUntil(drain('nudge'))
             defer(jobs().nudge()) ── RELAY binding ──►  scheduled * * * * * → await drain('cron')
                                                          drain: expire leases → claim → handler → finish
             D1 memoria  ◄──────────── shared ─────────►  D1 memoria
             R2 memoria-media ◄─────── shared ─────────►  R2 memoria-media (Phase 5 cleanup)
                                                          SMTP 587/465 ─► provider ─► recipient
```

### `apps/relay`

```
apps/relay/
  package.json        @repo/relay: scripts only (deps stay in the root)
  wrangler.jsonc      below
  tsconfig.json       paths: @repo/platform/current → ../../packages/platform-cloudflare/relay.ts,
                      server-only → ./src/empty.ts, @/* → ../web/src/*; includes relay-env.d.ts,
                      src/**, ../../packages/platform-cloudflare/sockets.d.ts
  relay-env.d.ts      GENERATED (cf-typegen): interface RelayEnv + the runtime types
  .dev.vars.example   NEXTJS_ENV=development, LOG_FORMAT=text; from commit 3 also SETTINGS_ENCRYPTION_KEY
                      and the Mailpit fallback: MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD
  src/index.ts        export default { fetch, scheduled }: builds the platform and the mailer, nothing else
  src/empty.ts        `export {}` (server-only)
```

```jsonc
{
  "name": "memoria-relay",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-15",                 // = the app's (guard)
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "workers_dev": false, "preview_urls": false,        // no public URL (D3.13, guard)
  "triggers": { "crons": ["* * * * *"] },
  "alias": {                                          // D3.2; = tsconfig paths (guard)
    "@repo/platform/current": "../../packages/platform-cloudflare/relay.ts",
    "server-only": "./src/empty.ts"
  },
  "d1_databases": [{ "binding": "DB", "database_name": "memoria", "database_id": "<= the app's>" }],  // no migrations_dir
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "memoria-media" }],
  "vars": { "APP_NAME": "Memoria", "SITE_URL": "", "LOG_LEVEL": "info", "LOG_FORMAT": "json" },
  // Mail settings come from D1 (Settings → Emails); SMTP_* in .dev.vars are the development fallback.
  "observability": { "enabled": true }
}
```

`src/index.ts` (sketch):

```ts
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/run') return new Response(null, { status: 404 });
    ctx.waitUntil(drain(env, ctx, { trigger: 'nudge' }));
    return new Response(null, { status: 202 });
  },
  async scheduled(controller, env, ctx) {
    await drain(env, ctx, { trigger: 'cron', scheduledAt: new Date(controller.scheduledTime) });
  },
} satisfies ExportedHandler<RelayEnv>;

async function drain(env: RelayEnv, ctx: ExecutionContext, run: DrainTrigger) {
  const platform = cloudflarePlatform(env, (t) => ctx.waitUntil(t));
  await withPlatform(platform, async () => {
    const mailer = await relayMailer({ background: (t) => ctx.waitUntil(t) }); // from the mail settings (D3.17)
    try {
      if (run.trigger === 'cron') await enqueuePeriodicJobs(run.scheduledAt);
      await runDueJobs({ mailer, trigger: run.trigger });
    } catch (error) {
      logger.error({ event: 'relay_drain_failed', trigger: run.trigger, code: errorCode(error) });
    }
  });
}
```

The periodic date comes from `scheduledTime` (so `/cdn-cgi/local/scheduled?time=` can test it); claims
always use the real clock.

### Shared code (D3.2)

- `wrangler.jsonc` `alias` is what wrangler uses; `tsconfig.json` `paths` is what `tsc` uses
  (`npm run ts-check:relay`); `wrangler-config` checks the two map `@repo/platform/current` and
  `server-only` to the same files.
- **Relay-safe modules** = everything reachable from `apps/relay/src/index.ts`. Guard `relay-graph`
  resolves specifiers over the source index: the relay's `alias` map first (read from its
  `wrangler.jsonc`), then relative paths, `@/` → `apps/web/src`, `@repo/<pkg>/<path>` →
  `packages/<pkg>/<path>(.ts|.tsx|.mjs|/index.ts)`; a third-party specifier is a leaf. It fails on
  `next`, `next/*`, `react`, `react-dom`, `@opennextjs/*`, `@repo/api/*`, `@repo/ui/*` except
  `@repo/ui/theme/*`, the files `packages/platform/current.ts` and `packages/platform-cloudflare/next.ts`,
  and prints the import chain. Self-test: a chain `@/lib/x` → `next/server` is caught; `@repo/db/client`
  passes with the alias map and fails without it; `@repo/ui/theme/studio.mjs` passes.
- Today the relay reaches `lib/jobs/**`, `lib/email/**`, `lib/settings/{studio,secrets,mail}.ts`,
  `lib/auth/account.ts`, `lib/db/queries/{jobs,site_settings,audit_log,admin_account}`, `lib/dates.ts`, `@repo/db/client`, `@repo/platform/*`, `@repo/platform-cloudflare/{platform,relay,smtp,d1,r2,env}`,
  `@repo/logger`, `@repo/core`, `@repo/ui/theme/*`.
- Email colours: `tokenHex` moves from `packages/ui/colorContrast.ts` to `packages/ui/theme/tokens.mjs`
  (it imports `flattenColors` from `cssVars.mjs` and the studio theme; `colorContrast.ts` re-exports
  it, so its tests stay), so templates reach it inside `theme/`.

### Data: `migrations/0005_jobs.sql`

```sql
CREATE TABLE jobs (
  id           TEXT NOT NULL,                     -- crypto.randomUUID(); also the email's Message-ID
  kind         TEXT NOT NULL,                     -- 'email' | 'housekeeping' | later phases
  payload      TEXT NOT NULL DEFAULT '{}',        -- JSON with a version `v`, parsed by the kind
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | failed
  priority     INTEGER NOT NULL DEFAULT 0,        -- 0 = someone is waiting (transactional), 1 = bulk (reminders)
  attempts     INTEGER NOT NULL DEFAULT 0,        -- incremented at claim (D3.5)
  max_attempts INTEGER NOT NULL,
  run_after    TEXT NOT NULL,                     -- pending: when due; running: when the lease ends
  ref          TEXT,                              -- what it is about, e.g. 'gallery:<id>': cancel/purge by it (indexed in Phase 5)
  dedupe_key   TEXT,                              -- system jobs only; one row per key while it exists
  last_error   TEXT,                              -- D3.11
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at  TEXT,
  CONSTRAINT pk_jobs PRIMARY KEY (id),
  CONSTRAINT uq_jobs_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT ck_jobs_kind CHECK (length(kind) BETWEEN 1 AND 40 AND kind NOT GLOB '*[^a-z0-9_.]*'),
  CONSTRAINT ck_jobs_payload CHECK (json_valid(payload) AND length(payload) <= 16384),
  CONSTRAINT ck_jobs_status CHECK (status IN ('pending', 'running', 'done', 'failed')),
  CONSTRAINT ck_jobs_priority CHECK (priority IN (0, 1)),
  CONSTRAINT ck_jobs_max_attempts CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT ck_jobs_attempts CHECK (attempts BETWEEN 0 AND max_attempts),
  CONSTRAINT ck_jobs_run_after CHECK (run_after GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  CONSTRAINT ck_jobs_finished CHECK ((status IN ('done', 'failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT ck_jobs_ref CHECK (ref IS NULL OR length(ref) BETWEEN 1 AND 100),
  CONSTRAINT ck_jobs_dedupe_key CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT ck_jobs_last_error CHECK (last_error IS NULL OR length(last_error) <= 500)
);
CREATE INDEX ix_jobs_due ON jobs (status, priority, run_after);
CREATE INDEX ix_jobs_kind_created_at ON jobs (kind, created_at);
CREATE INDEX ix_jobs_finished_at ON jobs (finished_at);
```

`ix_jobs_ref` waits for Phase 5, the first reader of `ref` (each index costs a row written per write).

Every timestamp bound by the code is `new Date(…).toISOString()` (the CHECK holds them to that
shape, so string comparison is time comparison).

Query module `lib/db/queries/jobs/`: `types.ts` (`JobRow`, `JobStatus`, columns, `toJobRow`),
`write.ts` (pure builders `enqueueJobStatement`, `upsertScheduledJobStatement`,
`cancelPendingJobsStatement({ ref, kind? })`, `retryFailedEmailStatement`; executing
`expireLeases`, `claimDueJob`, `completeJob`, `rescheduleJob`, `failJob`, `pruneFinishedJobs`,
`expireStaleJobs`), `read.ts` (`getJob`, `getEmailJob`, `listRecentEmailJobs(limit)`), `index.ts`,
`jobs.test.ts`.

### Writes that must not race

| Write | SQL | Guarantee |
| --- | --- | --- |
| Enqueue (in the caller's batch) | `INSERT INTO jobs (id, kind, payload, priority, max_attempts, run_after, ref, dedupe_key) VALUES (…) ON CONFLICT (dedupe_key) DO NOTHING` | with a key: once while the row exists. Keys only for system jobs (`<kind>:<entity id>:<variant>`), never for a send a person asked for |
| Schedule or move (Phase 10) | `INSERT … ON CONFLICT (dedupe_key) DO UPDATE SET run_after = excluded.run_after, payload = excluded.payload, updated_at = excluded.updated_at WHERE jobs.status = 'pending'` (only those three columns) | a pending reminder moves with the expiry date; a sent one stays sent |
| Cancel (Phase 5/10) | `UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'CANCELLED', dedupe_key = NULL, updated_at = ? WHERE ref = ? AND status = 'pending' [AND kind = ?]` | a running job finishes; nothing new starts; the key is free for a new schedule |
| Expire leases (drain start) | `UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END, finished_at = CASE WHEN attempts >= max_attempts THEN ?now END, run_after = ?now+10min, last_error = 'LEASE_EXPIRED', updated_at = ?now WHERE status = 'running' AND run_after <= ?now` | a dead runner's job waits 10 min, or ends |
| Claim | `UPDATE jobs SET status = 'running', attempts = attempts + 1, run_after = ?lease, updated_at = ?now WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND run_after <= ?now AND attempts < max_attempts ORDER BY priority, run_after LIMIT 1) AND status = 'pending' AND run_after <= ?now AND attempts < max_attempts RETURNING id, kind, payload, attempts, max_attempts, created_at` | one holder per job (spike: 12 parallel claims, no duplicate); never breaks `ck_jobs_attempts`, so one bad row cannot jam the queue |
| Defer (version skew) | `UPDATE jobs SET status = 'pending', attempts = attempts - 1, run_after = ?now+10min, last_error = ?code, updated_at = ?now WHERE id = ? AND status = 'running' AND attempts = ?` | the attempt is given back |
| Done | `UPDATE jobs SET status = 'done', finished_at = ?, updated_at = ?, last_error = NULL, payload = ? WHERE id = ? AND status = 'running' AND attempts = ?` (payload without `params`, D3.11) | `changes = 0` → `job_lease_lost` (warn) |
| Retry later | `UPDATE jobs SET status = 'pending', run_after = ?next, last_error = ?, updated_at = ? WHERE id = ? AND status = 'running' AND attempts = ?` (only while `attempts < max_attempts`; else *Failed*) | as above |
| Failed | `UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ?, payload = ?, updated_at = ? WHERE id = ? AND status = 'running' AND attempts = ?` (payload without `params`, as for Done) | as above; no snapshot of old settings survives a failed job |
| Admin retry | `UPDATE jobs SET status = 'pending', attempts = 0, run_after = ?now, finished_at = NULL, last_error = NULL, updated_at = ?now WHERE id = ? AND kind = 'email' AND status = 'failed'` → `conditionalAuditStatement(update 'email' { jobId, template } WHERE changes() > 0)` | only a failed email (the route's rate limit bounds how often); audited once |
| Expire stale (housekeeping) | `UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'EXPIRED', updated_at = ? WHERE status = 'pending' AND run_after < ?now−7d` | nothing waits forever; a retried old email is not caught (its `run_after` is new) |
| Prune (housekeeping) | `DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE finished_at < ?now−30d ORDER BY finished_at LIMIT 500)` | bounded |
| Periodic (each cron) | `INSERT INTO jobs (…) SELECT … WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE dedupe_key = ?)` | no write when present |

An admin retry of a running job changes nothing (`status = 'failed'` in the `WHERE`). A drain on an idle
queue runs two indexed statements (expire, claim), three on a cron after 03:00 (plus the periodic
insert), writing nothing. `LEASE_EXPIRED` in `last_error` is replaced by the next attempt's outcome; the
`job_reclaimed` log line is its lasting trace.

### Ports (`packages/platform/ports.ts`)

```ts
/** Wakes the job runner. A hint: never throws, may be lost (the cron is the safety net). */
export interface Jobs { nudge(): Promise<void> }

export type MailAddress = { email: string; name?: string };
export type MailMessage = {
  /** The job id: Message-ID `<id@From domain>`, kept across retries (SMTP, Microsoft 365; D3.20). */
  id: string;
  from: MailAddress; to: MailAddress; replyTo?: MailAddress;
  subject: string; text: string; html: string;
};
/**
 * Sends one message; resolves when the provider accepted it (SMTP `250`, HTTP 2xx) with the
 * provider's id. Rejects with MailError (`code`: an enumerated string, e.g. SMTP_550, BREVO_401,
 * SES_MessageRejected, GRAPH_403; `permanent`; `configuration` (auth/permission: retried, logged as
 * an error); `retryAfterSeconds` (from `Retry-After`); `detail`: masked provider text). `signal` aborts (the request or socket is closed:
 * MAIL_ABORTED, transient).
 */
export interface Mailer {
  send(message: MailMessage, opts: { signal: AbortSignal }): Promise<{ providerMessageId: string | null }>;
}

export interface Platform { /* … */ jobs(): Jobs }
```

- `Jobs` adapters: Cloudflare with `env.RELAY` → `RELAY.fetch('https://relay/run', { method: 'POST' })`,
  a throw or a non-2xx logged `relay_nudge_failed` (warn) and swallowed; without `RELAY` (the relay
  itself) → a no-op. Test platform → counts (`nudgeCount()`). `CloudflarePlatformEnv` gains
  `RELAY?: Fetcher`.
- `Mailer` is **not** a `Platform` method: only the relay sends; its entry builds the mailer from the
  mail settings and passes it to `runDueJobs`. Adapters: `smtpMailer(smtp, connect, background)`,
  `brevoMailer(brevo, fetch)`, `sesMailer(ses, fetch)`, `microsoft365Mailer(m365, fetch)` (all
  `@repo/platform/mail/*`), `memoryMailer()` (`@repo/platform/memory/mailer`: records, can be told to
  fail with a `MailError`), `unconfiguredMailer(problem)` (rejects `MAIL_NOT_CONFIGURED`, transient).
- Contract suite `@repo/platform/contract/mailer`, run against `memoryMailer`, `smtpMailer` over the
  scripted server, and the three HTTPS adapters over a scripted `fetch`: a message is delivered once; a subject or name with CR/LF or another
  control character and an address with `<`, `>`, a space or a non-ASCII character are refused before
  anything is written (permanent `MAIL_INVALID_HEADER` / `MAIL_INVALID_ADDRESS`); a 5xx is permanent, a
  4xx and an abort are not.

### SMTP and MIME (`packages/platform/mail/`)

- `address.ts` re-exports `parseEmailAddress` from `@repo/core/email` (Phase 2b: ASCII only, local part
  `[A-Za-z0-9._+-]` 1–64, labels 1–63, a 2+ letter TLD, ≤ 254); the rules and their tests live there.
- `mime.ts` (pure): `buildMessage(message, { date, domain, boundary })` → CRLF text. `From`, `To`,
  optional `Reply-To`: ASCII names quoted with `\` and `"` escaped; other names, and any containing
  `=?`, as RFC 2047 `=?UTF-8?B?…?=` words of ≤ 75 characters, split on character boundaries of the NFC
  text, folded with CRLF + space. `Subject` the same. `Date` RFC 5322 in `+0000`;
  `Message-ID: <id@domain>`; `MIME-Version: 1.0`; `Auto-Submitted: auto-generated`;
  `multipart/alternative` (boundary from `crypto.randomUUID()` by default, injectable for tests) with a
  `text/plain` and a `text/html` part, `charset=utf-8`, quoted-printable. A subject or name with a C0
  control, DEL, a C1 control, U+2028/2029 or a bidi control (U+202A–202E, U+2066–2069), or an invalid
  address, throws (permanent). Every line ≤ 998 octets.
- `smtp.ts` (pure protocol over
  `SmtpSocket { read(): Promise<Uint8Array | null>; write(bytes): Promise<void>; startTls(): Promise<SmtpSocket>; close(): void }`):
  - Replies: lines ≤ 512 octets, ≤ 100 lines and ≤ 8 KB per reply, ASCII only, one code for all
    lines of a reply, CRLF split across chunks; a timer (15 s) covers the whole reply.
  - `EHLO <From domain>`; with `starttls`: `STARTTLS` must answer exactly `220`; **no byte may be
    buffered after that reply** (else `SMTP_TLS_INJECTION`, transient); `startTls()`; the pre-TLS
    capabilities are discarded; `EHLO` again; AUTH mechanisms only from the post-TLS list. A server
    without STARTTLS fails `SMTP_STARTTLS_UNAVAILABLE` (transient: configuration), never falls back to clear text.
  - `AUTH PLAIN` (a server without it: `SMTP_AUTH_UNSUPPORTED`), never before TLS unless `none`; `MAIL FROM:<…>`, `RCPT TO:<…>` (addresses
    already parsed: no CR/LF can reach a command), `DATA`, the message dot-stuffed and ended with
    `\r\n.\r\n`; resolve on `250`; then `QUIT` through `background`, capped at 1 s; bytes after it are ignored.
  - Timeouts (injectable timers): 10 s to connect, 15 s per reply, **18 s** for the whole send (so it
    fires before the runner's 20 s cap and gives a deterministic `SMTP_TIMEOUT`); the signal or a
    timeout closes the socket, so a send cannot complete afterwards.
  - Any reply is classified by its first digit (4 transient, 5 permanent, except 530/534/535),
    including the reply to `DATA` and to the message end.
  - Codes: `SMTP_<3 digits>`, `SMTP_TIMEOUT`, `SMTP_CONNECTION`, `SMTP_TLS`, `SMTP_TLS_INJECTION`,
    `SMTP_STARTTLS_UNAVAILABLE`, `SMTP_AUTH_UNSUPPORTED`, `SMTP_ABORTED`, `SMTP_PROTOCOL` (malformed reply).
  - `maskAddresses(text, { also: [recipient, username] })` (pure) for `detail`.
- `testing/scriptedSmtpServer.ts`: an in-memory `SmtpSocket` driven by a script (expected command →
  reply, extra bytes, delays), recording what the client wrote.
- `packages/platform-cloudflare/smtp.ts`: `cloudflareSmtpConnect(smtp)` → `connect({ hostname, port },
  { secureTransport: 'on' | 'starttls' | 'off', allowHalfOpen: false })` wrapped as an `SmtpSocket`;
  `startTls()` **releases the reader and writer locks first**, calls `socket.startTls({ expectedServerHostname: host })`
  once and wraps the new socket; `relayMailer` uses it for the `smtp` provider and logs
  `mail_insecure_dev` (warn) when `none` (development) is used.
  `packages/platform-cloudflare/sockets.d.ts` declares `module 'cloudflare:sockets'` (`connect`,
  `SocketOptions`, `SocketAddress`, `StartTlsOptions`, `Socket` — module-scoped, so the global
  `Socket` is untouched); both the root tsconfig and the relay's include it. Under vitest,
  `cloudflare:sockets` is aliased to a stub that throws on `connect`.

### HTTPS adapters (`packages/platform/mail/`)

Each takes its settings and a `fetch` (injected; the global one in production), sends one request (two
for Microsoft without a cached token), honours `signal` and an 18 s timeout, and maps the answer:

| Adapter | Request | Accepted | Permanent | Configuration (retried, `mail_auth_failed`) | Transient |
| --- | --- | --- | --- | --- | --- |
| `brevo.ts` | `POST https://api.brevo.com/v3/smtp/email`, `api-key`, JSON from the `MailMessage` (sender, to, replyTo, subject, textContent, htmlContent, `headers: { idempotencyKey: <job id>, "Auto-Submitted": "auto-generated" }`) | 201/202 → `messageId`; 400 `duplicate_request` → sent | other 400, 404 | 401, 402, 403 (key, credits, IP allow-list) | 429 (`Retry-After` honoured as the next attempt's minimum), 5xx, network |
| `ses.ts` | `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails`, SigV4 via `aws4fetch` (`service: 'ses'`), `{ Content: { Raw: { Data: base64(MIME) } }, FromEmailAddress, Destination: { ToAddresses: [to] } }` | 200 → `MessageId` | `MessageRejected`, `BadRequestException`, `NotFoundException` | `MailFromDomainNotVerifiedException`, `AccountSuspendedException`, `SendingPausedException`, 403, `UnrecognizedClientException`, `SignatureDoesNotMatch` | `TooManyRequestsException`, `LimitExceededException`, `ThrottlingException`, 5xx, network |
| `microsoft365.ts` | token (client credentials) cached per isolate on `globalThis`, key `sha256(tenant|clientId|secret)`, value the in-flight `Promise` (dropped on rejection), until 5 min before expiry; `POST https://graph.microsoft.com/v1.0/users/<mailbox>/sendMail`, `Content-Type: text/plain`, base64(MIME) | 202 → null (Graph returns no id; our Message-ID is the reference **if Verification 2b shows Exchange keeps it**, else the job id alone) | 400 (`ErrorMimeContent…`), 404 (mailbox), 413 | token 400/401 (`invalid_client`, `invalid_scope`), 401 after one token refresh, 403 (`ErrorAccessDenied`: permission or scope) | 429 (`Retry-After`), 500/502/503/504, 409/423 (mailbox busy), network |

Values that reach a URL or a socket, all checked by `parseMailSettings`:
- SES region: one of a fixed list (`mail/sesRegions.ts`).
- Microsoft tenant: `^[0-9a-f-]{36}$` or a domain `^[A-Za-z0-9.-]{1,253}$`; the mailbox passes
  `parseEmailAddress` and goes into the path through `encodeURIComponent`.
- SMTP host: a DNS name ≤ 253 characters, labels `[A-Za-z0-9-]`, not an IP literal, not `localhost`,
  `*.local`, `*.internal` (development: the env fallback may use `127.0.0.1`); port 465 (`tls`), 587 or
  2525 (`starttls`). Any public host is accepted: the edge blocks private and Cloudflare ranges, a
  change needs a code, and the secret must be entered again (D3.17).

Error bodies are parsed for the code only; `detail` is masked like SMTP text, plus every configured
id and secret value and any `Bearer …` string. Unproven until the first live send (Verification 2b):
whether Brevo accepts `Auto-Submitted` as a custom header (dropped if refused) and whether Exchange
keeps our Message-ID. SES "sender not verified" arrives as a permanent `MessageRejected`: the runbook
says to Retry after fixing it.

### Mail settings (`lib/settings/mail.ts`)

`site_settings` row `mail` (Phase 2b's store), parsed by a pure `parseMailSettings` shared with the
form:

```ts
type MailSettings = {
  provider: 'smtp' | 'brevo' | 'ses' | 'microsoft365';
  from: { email: string; name: string | null };   // name null = the studio name
  replyTo: string | null;
  smtp?: { host: string; port: number; security: 'starttls' | 'tls'; username: string; password: Secret };
  brevo?: { apiKey: Secret };
  ses?: { region: SesRegion; accessKeyId: string; secretAccessKey: Secret };
  microsoft365?: { tenantId: string; clientId: string; clientSecret: Secret; mailbox: string };  // mailbox default = from
};
type Secret = string;                              // 'v1:…' ciphertext at rest (D3.17)
```

- `readMailSettings(opts)` (server-only, no React; `getMailSettings` is its `cache()`d wrapper for the
  app, in `mail.cached.ts`): the row, else the development fallback from env
  (`MAIL_FROM` + `SMTP_*`, provider `smtp`, `security: 'none'` allowed only when `isDevelopment`), else
  null. The source is reported (`database` / `env`).
- `lib/settings/secrets.ts`: `encryptSetting(plain, aad)` / `decryptSetting(cipher, aad)` with the
  HKDF-derived key; a wrong key or a moved ciphertext → null → the job fails `MAIL_SECRET_UNREADABLE`
  (configuration; logged `settings_key_mismatch`), the form says the secret must be entered again.
- `relayMailer({ background })` (`packages/platform-cloudflare/smtp.ts` for SMTP; the HTTPS adapters
  are platform-neutral): builds the adapter for the effective settings with decrypted secrets, or
  `unconfiguredMailer`.
- `Config` gains `settingsKey: Uint8Array | null` (`SETTINGS_ENCRYPTION_KEY`, 32 bytes base64, the
  same parser as `TOTP_ENCRYPTION_KEY`) and `devMail` (the env fallback: `{ configured: MAIL_FROM &&
  SMTP_HOST, from, smtp: … | null }` — the app only needs `configured`; the relay needs the full SMTP
  set; host a DNS name unless development, port 1–65535, `none` only in development). `toAppConfig`
  exposes neither. `npm run admin:mfa -- key --settings` prints a settings key without the
  authenticator warning.
- Guard `settings-through-store` (Phase 2b) gains `config().devMail` (only `lib/settings/mail.ts`).

| Name | Kind | Worker | Notes |
| --- | --- | --- | --- |
| `SETTINGS_ENCRYPTION_KEY` | secret | both | `npm run admin:mfa -- key --settings`; losing it = re-enter the mail secrets |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD` | `.dev.vars` only | relay (and `MAIL_FROM`, `SMTP_HOST` in the app's, so it can say email is configured) | development fallback (Mailpit) |
| `APP_NAME`, `SITE_URL`, `LOG_LEVEL`, `LOG_FORMAT` | vars | both (equal, guard) | defaults only (Phase 2b) |

### The runner (`apps/web/src/lib/jobs/`)

- `types.ts`: `JobKind<P> = { kind; version; maxAttempts; priority; backoff: readonly number[]; parse(payload: unknown): P | null; run(payload: P, ctx: JobContext): Promise<void> }`;
  `JobContext = { jobId; attempt; maxAttempts; now: Date; signal: AbortSignal; mailer: Mailer; config: Config }`;
  `JobError(code, { permanent, detail? })`.
- `registry.ts`: `JOB_KINDS` — commit 2: `housekeeping`; commit 3 adds `email`. `runDueJobs` takes
  `registry = JOB_KINDS`, so tests register test-only kinds (`test.ok`, `test.transient`,
  `test.permanent`, `test.hang`).
- `backoff.ts` (pure): `nextRunAfter(attempt, now, schedule, minDelayMs?)` = `max(schedule step,
  min(retryAfter, 1 h))`; the last value repeats. `JobError` and `MailError` carry `retryAfterSeconds`.
- `enqueue.ts`: `jobStatement(kind, payload, { ref?, dedupeKey?, runAfter?, now })` (pure: validates
  with the kind's `parse`, adds `v`, refuses a JSON payload over 8 KB) and `emailJobStatement(input)`;
  `nudgeRelay()` = `getPlatform().defer(getPlatform().jobs().nudge())`. A route: `await
  batch([...change, emailJobStatement(…)])`, then `nudgeRelay()`.
- `runner.ts`: `runDueJobs({ mailer, trigger, clock?, registry? }, opts?)`:
  - limits: **nudge** — 1 job, 25 s budget; **cron** — **1** job, 60 s budget. The cron goes to 3 only
    if Verification 4 shows a sending cron run at ≤ 5 ms CPU. The budget is measured from the start of
    the drain (expire included). Claims, leases and backoff use `clock` (default the real one);
    `scheduledAt` is only for `periodic`;
  - expire leases; then while under the limit: stop if less than 20 s of budget remain; claim; parse
    (unknown kind/template/newer `v` → *Defer*, or `UNKNOWN_KIND` after 24 h; bad payload →
    `JOB_INVALID`); `await Promise.race([kind.run(payload, ctx), rejectOnAbort(signal)])` with `signal`
    aborted at `min(20 s, remaining budget)` — a handler that ignores the signal cannot hold the
    runner, and its late result is ignored; done / retry / failed (fenced);
  - logs `job_done`, `job_retry`, `job_failed`, `job_reclaimed` (attempt after `LEASE_EXPIRED`),
    `job_lease_lost` — `{ jobId, kind, attempt, code }` — and one `relay_drain` summary when anything ran.
- `periodic.ts`: `enqueuePeriodicJobs(at)`: from 03:00 UTC of `at`, the `housekeeping:<date>` job.
- `housekeeping.ts`: expire stale (due for 7 days), prune finished (30 days, ≤ 500).
- Commit 2's relay entry passes `unconfiguredMailer('MAIL_NOT_CONFIGURED')`; commit 3 swaps in `relayMailer`.

### Email (`apps/web/src/lib/email/`)

- `context.ts`: `emailContext(studio)` → `EmailContext` (D3.8) with `link(path)`, from `getStudio()`.
- `layout.ts` (pure): the HTML shell (a 600 px table, system fonts, inline styles, colours by
  `tokenHex(role)`, the studio name as a text header, a footer) and the matching plain-text shell;
  `escapeHtml`.
- `templates/test.ts`: subject "Test email from {studioName}"; body: it was queued at {time, UTC} from
  Settings → Emails, and replies are not read.
- `templates/registry.ts`: `EMAIL_TEMPLATES = { test }`, each `{ id, label, version, parse(params), render(params, ctx) }`;
  `renderEmail(id, params, ctx)` — pure, no `server-only`, importable by the app for previews.
- `job.ts`: the `email` kind (payload `{ v: 1, template, to: { email, name? } | { account: true }, params }`;
  6 attempts, priority 0); `run` reads `readStudio()`, `readMailSettings()` and, for `{ account: true }`,
  `readAdminAccount()` (the relay never imports React), renders, builds the `MailMessage`
  (id = job id; From = the settings' address and name, else the studio name; reply-to), sends with
  `ctx.signal`, and returns `{ providerMessageId }` for the done payload. No settings →
  `MAIL_NOT_CONFIGURED`.
- `templates/security.ts`: the notice templates (D3.19): `security.sign-in`, `security.authenticator-added`,
  `security.authenticator-removed`, `security.recovery-codes-regenerated`, `security.recovery-code-used`,
  `security.email-changed`, `security.password-changed`, `security.mail-settings-changed`,
  `security.locked`; params are labels, a country code and an ISO time, never a code, a count or a
  link that acts (a plain link to Settings → Security is allowed).
- `notices.ts` (server-only): `securityNoticeStatement(event, params, condition)` → a conditional
  `INSERT … SELECT … WHERE <condition>` job statement with `to: { account: true }`, or `null` when
  notices are off or no mail settings exist (both read once per request, `cache()`d); callers append it
  to the event's batch and call `nudgeRelay()` after it.
- `views.ts` (pure, no imports but types; client components import it): `EmailView = { id, template,
  templateLabel, to (the account label when `account: true`), status: 'queued' | 'sending' | 'sent' | 'retrying' | 'failed', attempts,
  maxAttempts, lastError, createdAt, finishedAt, nextAttemptAt, canRetry }`; `toEmailView(job)`
  (`pending` + 0 attempts = queued, `pending` + more = retrying, `running` = sending; `nextAttemptAt` =
  `run_after` when pending, else null; `canRetry` = failed); `EMAIL_STATUS_LABELS` and a sentence per
  `last_error` code.

### Settings → Emails (`/admin/settings/emails`)

- `SETTINGS_SECTIONS.emails` drops `soonPhase`. Cards (`SettingsCard`, Phase 2b):
  1. **Sending**: the source line ("From the server configuration (development)" for the env fallback;
     nothing when saved in the studio); **Provider** (a `Segmented` or select: SMTP server, Brevo,
     Amazon SES, Microsoft 365) and its fields: SMTP host, port, security (STARTTLS/TLS), username,
     password · Brevo API key · SES region, access key id, secret access key · Microsoft tenant, client
     id, client secret, mailbox. A saved secret shows "Saved — leave empty to keep"; switching provider
     needs its secrets. **From** address, **From name** (placeholder: the studio name), **Reply-to**.
     Above the provider control: "Already use Microsoft 365: choose it. Starting fresh: Brevo has a
     free tier. Amazon SES is cheapest at volume but needs a request for production access. SMTP
     server for anything else." A short help line per provider (what to create there, the DNS
     records; deployment.md anchors). **Save** → `PUT /api/admin/settings/mail` through `SecondFactorProvider` (D3.18).
  2. **Test email**: an email field (default: the account email), Send. After sending,
     `EmailStatusLine` (`key={id}`, its own `useApi` on `/api/admin/emails/<id>`, `role="status"`
     `aria-live="polite"`) polls every 2 s: *Queued* → *Sending* → *Sent* or *Failed: <reason>*. It
     stops on a final state, after 60 s ("Still queued: the relay has not picked it up. Is it deployed
     and running?"), on a 401 (the session ended) or a 404; a network error keeps trying until 60 s. A
     final state calls `router.refresh()`.
  3. **Security notices**: a `Toggle` "Email me about sign-ins and security changes" →
     `PUT /api/admin/settings/security-notices` `{ enabled }`; turning them **off** needs a code and
     enqueues one last notice in the same batch; turning them on does not.
  4. **Recent emails**: the last 20: when, what (template label), to, a status pill, the reason and the
     next attempt for retrying/failed, **Retry** when `canRetry` (`RetryEmailButton`, its own `useApi`,
     then `router.refresh()`). "No emails yet." Stacked rows at 360 px. `lastError` is rendered as text.
- **Not sending banner**: when the oldest `pending` email job with `attempts = 0` has been due for more
  than 10 minutes, the page (and the dashboard) shows "Emails are not being sent: the background worker
  is not running." (one indexed read).
- Routes (all: `requireAdmin` first, `isUuid` before SQL, `no-store`):
  - `PUT /api/admin/settings/mail` `{ provider, fields…, from, replyTo }` →
    `parseMailSettingsInput` (an empty secret keeps the saved one only when the provider and every
    other field of its block are unchanged, else 400 `SECRET_REQUIRED` with `field`) → confirm window → encrypt secrets → `batch([upsert
    'mail', audit update 'settings' { key: 'mail', provider }])` → `{ data: MailSettingsView }` (no
    secrets: `{ …, secrets: { password: 'saved' } }`), plus the D3.18 notice. Without
    `SETTINGS_ENCRYPTION_KEY`: 503 `SETTINGS_KEY_MISSING`.
  - `PUT /api/admin/settings/security-notices` `{ enabled }` → (off: confirm window) → upsert + audit
    (+ the last notice when turning off).
  - `POST /api/admin/emails/test` `{ to }` → `parseTestEmailInput` → rate limit **3 per hour**
    (`email_test`) → `batch([enqueue test email (1 attempt), audit create 'email' { jobId, template }])`
    → `nudgeRelay()` → `202 { data: EmailView }`.
  - `GET /api/admin/emails/[id]` → 404 unless an `email` job → `{ data: EmailView }`.
  - `POST /api/admin/emails/[id]/retry` → rate limit 20 per hour (`email_retry`) → `batch([retry, audit])`
    → nothing changed: re-read → 404 (missing or not email) or 409 `EMAIL_NOT_FAILED` →
    `nudgeRelay()` → `{ data: EmailView }`.

### Security notices (D3.19)

Rules for placing a notice in an existing batch (read the batch first): append it **after** the
statements whose `results[n]` the code reads; a `changes() > 0` condition only right after the
statement it is about, and if an audit already chains on that statement, the notice goes between them
so the audit then reads the notice's `changes()` (1 when the event happened, 0 when not — the audit
stays correct).

| Event | Where (batch) | Condition | Recipient |
| --- | --- | --- | --- |
| sign-in (code, recovery code, first enrolment) | `secondFactor.ts`: appended after the existing statements | `EXISTS (SELECT 1 FROM admin_sessions WHERE id = ?)` (the sign-in audit's condition); `method` in params | account |
| authenticator added | `securitySettings.ts` | `EXISTS (that authenticator)` | account |
| authenticator removed | `securitySettings.ts`: right after `deleteAuthenticatorStatement`, before its audit | `changes() > 0` | account |
| recovery codes regenerated | `securitySettings.ts` | `EXISTS (a new code id)` | account |
| recovery code used to confirm | `confirm.ts`, recovery branch, after the window `open` statement | `changes() > 0` (chained like `open`) | account |
| email changed | `api/admin/account/email` (2b) | `EXISTS (admin_account with the new email)` | old and new address (both known to the route) |
| password changed | `api/admin/account/password` (2b) | `EXISTS (admin_account with the new hash)` | account |
| mail settings changed | `settings/mail` route | `EXISTS (the new mail row)` | account, via the previous settings (D3.18) |
| notices turned off | `settings/security-notices` route | `EXISTS (the row with enabled = false)` | account |
| sign-in locked | `codeStep.ts`, only when this failure reaches the daily limit (`failuresToday + 1 === limit`, known from the lockout check) | the lockout audit's condition | account |

A recovery-code sign-in sends one notice (the sign-in, method "recovery code"), not two. Each notice is
one `email` job (priority 0, 6 attempts); route tests assert the job row and that a failed event writes
none.

### Errors

| Code | Status | When |
| --- | --- | --- |
| `INVALID_PARAMS` | 400 | a field fails its parser (`field`): the test address, a mail setting |
| `SECRET_REQUIRED` | 400 | a saved secret would be kept although another field of its provider changed (`field`) |
| `SECOND_FACTOR_REQUIRED` | 403 | saving mail settings or turning notices off without a code in the last 5 minutes |
| `NOT_FOUND` | 404 | no email job with that id |
| `EMAIL_NOT_FAILED` | 409 | retry of an email that is not failed |
| `RATE_LIMITED` | 429 | test emails over 3/hour; retries over 20/hour |
| `SETTINGS_KEY_MISSING` | 503 | saving a secret while `SETTINGS_ENCRYPTION_KEY` is not set |
| `MAIL_NOT_CONFIGURED`, `MAIL_SECRET_UNREADABLE`, `SITE_URL_MISSING`, `SMTP_*`, `BREVO_*`, `SES_*`, `GRAPH_*`, `JOB_INVALID`, `UNKNOWN_KIND`, `LEASE_EXPIRED`, `EXPIRED`, `CANCELLED` | — | a job's `last_error` code (shown in Recent emails with a sentence from `views.ts`) |

### Local development

- `npm run dev:relay` → `scripts/relay-dev.mjs`: starts
  `node node_modules/wrangler/bin/wrangler.js dev -c apps/relay/wrangler.jsonc --port 8790 --persist-to apps/web/.wrangler/state`
  (node directly, not `npx`: no orphans on Windows), POSTs `/run` every 10 s (the local cron and the
  nudge `next dev` may not deliver), and kills the process tree on exit.
- One local D1 for both (same `database_id`, same persist directory: spike); `db:migrate:local` once,
  from the app.
- The app's nudge in `next dev`: the `RELAY` binding through wrangler's dev registry when the relay
  runs (T3.2 records whether it works); otherwise it fails quietly and the 10 s loop delivers.
- **Mailpit** (a binary or `docker run axllent/mailpit`; SMTP 1025, UI 8025) through the `.dev.vars`
  fallback (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_SECURITY=none`), or a provider saved in
  Settings → Emails (the real provider's sandbox or free tier). To see a `535`, start Mailpit with an
  auth file (`--smtp-auth-file`) and use a wrong password.
- Before Settings → Emails exists (commit 3), a test email is enqueued with the `INSERT INTO jobs`
  documented in deployment.md → *Local email* through `wrangler d1 execute DB --local`.
- The cron locally: `curl "http://127.0.0.1:8790/cdn-cgi/local/scheduled?time=<epoch ms>"`.

### CI and deployment

- Root scripts: `dev:relay`, `build:relay` (`wrangler deploy --dry-run --outdir apps/relay/dist -c apps/relay/wrangler.jsonc`),
  `deploy:relay` (`wrangler deploy -c apps/relay/wrangler.jsonc`), `cf-typegen` for both
  (`wrangler types --env-interface RelayEnv apps/relay/relay-env.d.ts -c apps/relay/wrangler.jsonc --env-file apps/relay/.dev.vars.example`),
  `ts-check:relay` (`tsc -p apps/relay/tsconfig.json`; `ts-check` runs it). The root tsconfig never
  includes `relay-env.d.ts` (two generated runtime-type files conflict). `.gitignore`: `apps/relay/dist`.
- `ci.yml`: `check` adds `build:relay`; `deploy`: `db:migrate:remote` → `deploy:relay` → `deploy`.
- `deployment.md`:
  - First deploy from a terminal, **relay first** (the app's `RELAY` binding needs it to exist), after
    the migrations; then check in the dashboard that the relay has no `workers.dev` route.
  - `SETTINGS_ENCRYPTION_KEY` on both Workers (`admin:mfa -- key --settings`), then the provider in
    Settings → Emails.
  - Per provider: SMTP (host, port, an app password); Brevo (an API key; **IP allow-listing off**, since
    Workers have no fixed IPs); SES (production access requested, the domain identity verified, an IAM
    user with `ses:SendEmail` on that identity only); Microsoft 365 (an Entra app registration with a
    client secret, the application permission `Mail.Send` granted **only through RBAC for Applications**
    on the sending mailbox, the tenant-wide grant removed; up to 2 h to take effect).
  - The sending domain verified at the provider; DNS: the provider's **DKIM** keys (DMARC passes
    through DKIM aligned with the From domain, since providers rewrite the envelope sender), its SPF
    include, a DMARC record (`p=none` to start); the From address on that domain in Settings → Emails.
  - Runbooks: email not arriving (Settings → Emails reason; `npx wrangler tail memoria-relay`); a
    permanent failure that is really configuration (SMTP "sender not verified", SES `MessageRejected`
    for an unverified sender) → fix, then Retry; rotating a provider secret; losing
    `SETTINGS_ENCRYPTION_KEY` (re-enter the secrets); a stuck queue (the SQL to inspect); the relay not
    deployed.

### Guards

- `wrangler-config`, per app (`apps/web`: `cloudflare-env.d.ts`/`CloudflareEnv`; `apps/relay`:
  `relay-env.d.ts`/`RelayEnv`): fresh types, no secrets in `vars`, no `NEXTJS_ENV` var. Across apps: the
  app's `RELAY` service = the relay's `name`; same `compatibility_date` and flags; the same D1
  (`database_name`, `database_id`) and `MEDIA` bucket; `migrations_dir` only in the app; equal shared
  vars (`APP_NAME`, `SITE_URL`, `LOG_LEVEL`, `LOG_FORMAT`); from commit 3, `SETTINGS_ENCRYPTION_KEY` in
  both `.dev.vars.example`; the relay: `workers_dev: false`, `preview_urls: false`, no `routes`, exactly
  one cron, `alias` = its tsconfig `paths` for `@repo/platform/current` and `server-only`; `relay.ts`
  exports every name `current.ts` exports.
- `platform-boundary`: roots + `apps/relay`; allowed + `apps/relay/src/index.ts`; `Fetcher`,
  `ScheduledController`, `ExportedHandler` in the type list and its self-test table.
- New `relay-graph` (above). `SOURCE_INDEX_ROOTS`, `file-size` roots + `apps/relay`; `GENERATED_FILES`
  + `relay-env.d.ts`; vitest `node` include + `apps/relay/**/*.test.ts`, alias `cloudflare:sockets`.
- `settings-through-store` (Phase 2b) gains `config().devMail` (only `lib/settings/mail.ts`).

## Workstreams

### A. The relay Worker

- **T3.1** (done: the spike, recorded under *Starting point*.)
- **T3.2** (`CloudflarePlatformEnv.RELAY?: Fetcher` lands here with the binding, so the generated types and
  `platform.ts` agree) `apps/relay` (package, `wrangler.jsonc`, tsconfig, `.dev.vars.example`, `relay-env.d.ts`,
  `src/index.ts` draining nothing yet, `src/empty.ts`); `packages/platform-cloudflare/relay.ts` (ALS)
  and `sockets.d.ts`; scripts; `SOURCE_INDEX_ROOTS`, `file-size`, vitest include and alias; guards
  (`wrangler-config`, `platform-boundary`, `relay-graph`); CI `build:relay`; `scripts/relay-dev.mjs`;
  the app's `RELAY` binding + `cf-typegen`; **check that `createTestDb()` still starts quickly with the
  `RELAY` binding in the app's config** (else `testing/proxy.ts` drops `services` from the config it
  passes); record whether `next dev` reaches the relay through the binding.

### B. Jobs

- **T3.3** Migration `0005_jobs.sql`; query module `jobs` with its race tests.
- **T3.4** Ports: `Jobs` (Cloudflare `RELAY`, test), `Mailer` + `MailError` (types only),
  `memoryMailer`, `unconfiguredMailer`; `CloudflarePlatformEnv.RELAY`; `nudgeCount()`.
- **T3.5** `lib/jobs`: types, registry (`housekeeping`), backoff, enqueue + `nudgeRelay`, runner,
  periodic, housekeeping; the relay entry drains for real.

### C. Mail

- **T3.6** `mail/address.ts` (re-exports `@repo/core/email`), `mail/mime.ts`, `mail/smtp.ts`, the
  scripted server, the contract suite; `platform-cloudflare/smtp.ts`.
- **T3.7** `mail/brevo.ts`, `mail/ses.ts` (+ `sesRegions.ts`), `mail/microsoft365.ts` (token cache), a
  scripted `fetch` for their tests, each run through the contract suite.
- **T3.8** Mail settings: `Config.settingsKey` + `Config.devMail` + `parseConfig` + tests; `admin:mfa
  -- key --settings`; `security_notices` row and its reader;
  `lib/settings/secrets.ts`, `lib/settings/mail.ts` (`parseMailSettings`, `getMailSettings`),
  `relayMailer`; `SETTINGS_ENCRYPTION_KEY` and the dev fallback added to both `.dev.vars.example` (commit
  1's relay example has only `NEXTJS_ENV` and `LOG_FORMAT`; the guard rule arrives with them);
  `cf-typegen`; the guard's `devMail` rule.
- **T3.9** `tokenHex` to `theme/tokens.mjs`; `lib/email` (context, layout, `test` template, registry,
  the `email` kind, views).

### D. Settings → Emails and notices

- **T3.10** Routes (`settings/mail`, `emails/test`, `emails/[id]`, `emails/[id]/retry`), their parsers;
  the page: `MailProviderForm`, `TestEmailForm`, `EmailStatusLine`, `SecurityNoticesToggle`,
  `RecentEmails`, `RetryEmailButton`; the nav entry; contrast rows for any new pair.
- **T3.11** Security notices: `templates/security.ts`, `notices.ts`, the statements in
  `secondFactor.ts`, `securitySettings.ts`, `confirm.ts`, `codeStep.ts` and the 2b account routes.

### E. Docs (each in its commit)

- Commit 1: AGENTS.md (where to look: `apps/relay`, `platform-cloudflare/relay.ts`; commands:
  `dev:relay`, `build:relay`, `deploy:relay`; rule: relay-safe modules and `relay-graph`; guards list),
  `architecture.md` (the relay replaces *Planned*; layout; its composition root), `recipes.md`
  (*A second app*: the relay as the example).
- Commit 2: `architecture.md` → Jobs; `recipes.md` → *A job kind*; AGENTS.md → Data rules (a job is
  enqueued in the batch of its cause, then `nudgeRelay()`).
- Commit 3: `architecture.md` → Email (adapters, mail settings, the settings key); `recipes.md` → *An
  email template* (replaces the Email Routing note) and *A mail adapter*; D3.15 in AGENTS.md (emails to
  visitors); `deployment.md` (`SETTINGS_ENCRYPTION_KEY`, each provider's setup, DNS, runbooks, *Local
  email*: Mailpit and the `wrangler d1 execute --local` INSERT that enqueues a test email).
- Commit 4: `architecture.md` → Admin (Settings → Emails, security notices).
- **T3.12** Commit 5: index status and *To verify* items; plan `done` (after Verification 4); wiki
  index; p04 T4.4 loses "test email" and gains "sender name and reply-to into `EmailContext`";
  "From Phase 3" notes in p05 (cleanup job, `ref`, the preview through `renderEmail`), p07 and p08
  (email templates, D3.15), p10 (`upsertScheduledJobStatement`, `cancelPendingJobsStatement`, keys
  that include the expiry date, priority 1, `List-Unsubscribe`), p11 (an IP-expiry housekeeping step).

## Tests

| Test | What |
| --- | --- |
| `queries/jobs/jobs.test.ts` | enqueue with and without a key (second ignored); upsert moves a pending job, leaves a done one; cancel by `ref` (and kind) only pending; claim order (priority, then `run_after`); claim skips not-due, running, done, failed; parallel claims return distinct jobs; expire leases: back to pending +10 min, or failed when exhausted; fenced done/retry/fail with a stale `attempts` change nothing; done drops `params`; admin retry only on a failed email (audit row only when changed); expire stale when due for 7 days, and a retried 8-day-old email stays pending; cancel clears the key and a new schedule with it inserts; a claim never selects a row with `attempts = max_attempts`, and the skew *Defer* gives the attempt back; prune bounded, finished only; periodic insert writes nothing when present; every CHECK refuses its bad row (kind, payload, status, priority, attempts > max, `run_after` shape, finished without `finished_at`) |
| `jobs/backoff.test.ts` | table: attempt → minutes; the last repeats |
| `jobs/runner.test.ts` | test D1, `memoryMailer`, a fake clock: success → done; transient → pending at the backoff with `last_error`; permanent → failed; last attempt → failed; unknown kind / template / newer `v` → +10 min without spending an attempt, `UNKNOWN_KIND` after 24 h, and a job deferred 7 times never breaks the CHECK while the next job still runs; bad payload → `JOB_INVALID`; nudge 1 job, cron 1 (test-only kinds through `registry`); no job started with < 20 s left; a hanging handler is aborted at its cap, retried, and its late completion writes nothing; a reclaimed job logs `job_reclaimed`; a stale finish logs `job_lease_lost`; two drains at once share the queue without duplicates; a drain error is logged, not thrown; idle → no log, no write; logs never contain an address (logger spy) |
| `jobs/periodic.test.ts` | before 03:00 UTC nothing; after, one job per UTC day however many ticks |
| `jobs/enqueue.test.ts` | the builder refuses a bad payload and one over 8 KB; adds `v`; `nudgeRelay` defers one nudge |
| `mail/mime.test.ts` | ASCII subject verbatim; Cyrillic subject → B-words ≤ 75 that decode to the original, with 2-, 3- and 4-byte characters at a word boundary, 200 characters, an emoji; NFC; names quoted with escapes, `=?` encoded; each forbidden character class refused; Message-ID from the id; `Auto-Submitted`; injected boundary; quoted-printable parts decode to the input; every line ≤ 998 |
| `mail/smtp.test.ts` | scripted: 587 flow; 465 flow; no PLAIN → `SMTP_AUTH_UNSUPPORTED`; multi-line replies split across chunks; reply limits (513-octet line, 101 lines, mixed codes, non-ASCII) → `SMTP_PROTOCOL`; STARTTLS answered 454 → transient, no AUTH sent; bytes after the `220` → `SMTP_TLS_INJECTION`; capabilities re-read after TLS; AUTH never before TLS; dot-stuffing; 550/552 on RCPT → permanent with code; 451 → transient; 535 → transient; the connection lost after DATA → transient; resolve at `250` before QUIT; the 18 s send timeout fires `SMTP_TIMEOUT` and timeouts and abort close the socket (fake timers); a 4xx/5xx to `DATA` and to the message end classified by the first digit; `detail` masked (recipient, username, any address) and free of CR/LF |
| `contract/mailer` | run by `memory/mailer.test.ts` and `mail/smtp.test.ts` |
| `platform/config.test.ts` rows | `SETTINGS_ENCRYPTION_KEY` 32 bytes → key, else null; `devMail`: complete → config; missing password → null + problem; port default per security; `none` and an IP host refused outside development, accepted inside; bad port; `problem` never contains a value |
| `mail/brevo.test.ts`, `ses.test.ts`, `microsoft365.test.ts` | scripted `fetch`: the exact request (URL, headers, body; SES signed; Graph base64 MIME with our Message-ID); each row of the classification table; `Retry-After` surfaced; `duplicate_request` = sent; Graph token cached across two sends and refreshed once on a 401; a region or tenant outside the allowed shapes refused before any request; abort and the 18 s timeout; `detail` masked |
| `settings/secrets.test.ts` | round trip; wrong key, tampered, another field's AAD → null |
| `settings/mail.test.ts` | `parseMailSettings` table per provider (required fields, port, region list, tenant shape, mailbox address, From/reply-to addresses); a row wins over env; env fallback only with `MAIL_FROM` + `SMTP_HOST`; `none` only in development; the source reported |
| `api/admin/settings/mail/route.test.ts` | 401/403; no code → 403 `SECOND_FACTOR_REQUIRED`; changing the host, username, key id, tenant, client id or mailbox with an empty secret → 400 `SECRET_REQUIRED`; the mail-settings notice carries the previous settings; SMTP port outside {465, 587, 2525}, an IP or `localhost` host, a bad tenant → 400; saves encrypted (the stored row has `v1:` secrets, never the plain value); an empty secret keeps the saved one; switching provider without its secrets → 400; the response never contains a secret; audit without secrets; no key → 503 `SETTINGS_KEY_MISSING` |
| `email/notices.test.ts` + the touched route tests | each event writes one email job with the right template and recipient; a recovery-code sign-in → one notice; removing an already-removed authenticator → no notice and the audit unchanged; the batches' `results[n]` reads still hold; email change → two jobs (old and new address); notices off or no mail settings → no job; turning notices off → a last notice and a code required; a failed event (wrong code, stale challenge) → no job; the lockout notice once, without extra reads on ordinary failures |
| `jobs/backoff.test.ts` rows | `Retry-After: 99999` capped at 1 h; a smaller one than the step ignored |
| `microsoft365.test.ts` rows | the token cache keyed by tenant, client and secret (a new secret fetches a new token); two concurrent sends share one token request |
| `config/appConfig.test.ts` | `mail` not exposed |
| `platform-cloudflare/platform.test.ts` | `nudge()` POSTs `/run` through `RELAY`; a rejecting or 500 fetcher is swallowed and logged; no `RELAY` → no-op |
| `platform-cloudflare/relay.test.ts` | `getPlatform()` outside `withPlatform` throws; overlapping `withPlatform` calls each see their own platform across awaits |
| `email/*.test.ts` | the security templates contain no code, secret or acting link; escaping of `<script>` and quotes in params; `link()` refuses a path not starting with `/` and fails `SITE_URL_MISSING` when the studio has no website address and no bootstrap `siteUrl`; text and HTML present; no hex literal (only `tokenHex`); `toEmailView` table; `renderEmail` is pure (no `server-only` import in `lib/email/templates`) |
| route tests | test email: 401, 403 cross-origin, 400 bad address, 202 + email job (1 attempt) + audit without the address + one nudge; 429 at the 4th in an hour; `GET` 404 for a missing, non-email or non-uuid id; retry: failed → pending, attempts 0, audit, nudge; not failed → 409; 21st in an hour → 429; `no-store` |
| component tests | `TestEmailForm` + `EmailStatusLine` with `vi.advanceTimersByTimeAsync`: default address, states, failed reason, 60 s hint, stop on 401/404, keep on a network error, `router.refresh()` at the end, cleanup on unmount; `RecentEmails` (pills, Retry only when `canRetry`, empty state, `lastError` as text); nav: Emails no longer *Soon* |
| guards | `relay-graph` self-test; `wrangler-config` cross-app rules on samples; `platform-boundary` relay entry allowed, another relay file importing `cloudflare:sockets` flagged |

## Risks and edge cases

- **SMTP from the edge** (587/465) and **its CPU** are unproven: Verification 4; the HTTPS adapters
  are the fallback (D3.16).
- **`SETTINGS_ENCRYPTION_KEY` lost or rotated**: every saved secret is unreadable; jobs fail
  `MAIL_SECRET_UNREADABLE`; the form asks for the secrets again. Two-factor is unaffected (its own key).
- **Provider quirks**: Brevo IP allow-listing (off, deployment.md); SES sandbox (verified recipients
  only until production access); Microsoft RBAC takes up to 2 h; Graph keeps a copy in Sent Items.
- **Notices about the attacker's own actions** reach the account email, which the attacker can change
  only with the password and a code (2b), and the old address is told. A mail-settings change is
  announced through the previous settings (D3.18). The CLI commands send no notice (the owner's local
  action).
- **Relay not running**: notices and tests queue; the *not sending* banner after 10 minutes; `EXPIRED`
  after 7 days.
- **TLS certificate checking** by `cloudflare:sockets` is not documented explicitly: Verification 4
  connects to a host with a wrong name and expects a failure; if it cannot be shown, recorded as a risk.
- **At-least-once**: a send accepted (`250`) whose `done` write fails, or whose invocation dies in
  between, is sent again after the lease and 10 minutes. Same Message-ID (receivers may drop it).
- **Lost nudges**: the cron (production) or the dev loop (10 s) delivers. The nudge path runs one job;
  more wait for the cron (≤ 1 min, 1 per run = 60 an hour, more with each nudge).
- **Relay not deployed**: jobs queue; Settings → Emails says so after 60 s; after 7 days they fail `EXPIRED`.
- **Wrong SMTP password**: retries for ~11 h with `mail_auth_failed`; after the fix, Retry.
- **Abuse with a stolen admin session**: 3 test emails an hour; retries 20 an hour.
- **Version skew / rollback**: D3.9, D3.14.
- **Budgets** (free plan, per day): requests — 1,440 cron + one per nudge + ≤ 30 polls per test
  email; Workers Logs — 1,440 invocation lines + a few per job (200k allowed); D1 written — ~15 rows
  per email (each write also updates the key, the unique key and three indexes), 0 for an idle drain; D1 read — two indexed
  statements per idle drain; D1 queries per invocation ≤ ~12 (50 allowed); subrequests — one per nudge
  in the app.
- **Two Workers, one D1**: migrations only from the app; the relay never runs `db:migrate`.
- **`waitUntil` CPU** of the nudge invocation counts against its 10 ms: measured in Verification 4.
- **File size**: `smtp.ts`, `mime.ts`, the runner and their tests stay under the limits; route tests per route.

## Verification

1. `npm run verify`; `npm run build:worker`; `npm run build:relay`.
2. **Local, Mailpit**: `npm run db:migrate:local`; `npm run dev` + `npm run dev:relay`; with the
   `.dev.vars` fallback, then with SMTP saved in Settings → Emails (code asked; the stored secret is
   `v1:`), a test email reaches Mailpit: multipart, a 120-character Cyrillic subject reads correctly,
   Message-ID = the job id, `Auto-Submitted` present. Stop the relay → *Queued* and the 60 s hint; start
   it → *Sent*. Mailpit with an auth file and a wrong password → *Failed* `SMTP_535` (one attempt).
   Retry from Recent emails. Sign in → a sign-in notice in Mailpit; add and remove an authenticator →
   two notices; turn notices off → none.
2b. **Local, HTTPS adapters** (with the accounts the developer creates): Brevo and SES (sandbox, a
   verified recipient) and Microsoft 365 (a test tenant, if available) each deliver a test email from
   the local relay; a wrong key → *Failed* with the configuration reason.
3. **Local cron**: `/cdn-cgi/local/scheduled?time=<03:05 UTC today>` enqueues and runs housekeeping;
   a second call adds nothing.
4. **Production** (the first deploy, after 2 and 2b, once the Cloudflare and provider accounts exist):
   `SETTINGS_ENCRYPTION_KEY` on both Workers; relay, then app; the provider saved in Settings → Emails; the dashboard shows no
   relay URL; a test email through the provider on 587 (and 465 if offered) arrives; the headers show
   `dkim=pass header.d=<From domain>` and DMARC pass; a test with the SMTP host set to a name whose
   certificate does not match fails; `npx wrangler tail memoria-relay --format json` gives `cpuTime`
   for an idle cron run, a cron run that sends and a nudge that sends (each ≤ 10 ms, else D3.16).
5. Settings → Emails at 360 px and 1440 px; keyboard only; the status line is announced.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(relay): the relay Worker` | T3.2 | `build:relay`; `dev:relay` boots against the app's local D1 |
| 2 | `feat(jobs): the jobs table, the runner and the nudge` | T3.3–T3.5 | `db:migrate:local`; Verification 3 |
| 3 | `feat(mail): SMTP, Brevo, SES and Microsoft 365 adapters, mail settings, the email job` | T3.6–T3.9 | a test email enqueued with the documented `wrangler d1 execute --local` INSERT (deployment.md → Local email) reaches Mailpit through a local drain |
| 4 | `feat(admin): Settings → Emails and security notices` | T3.10, T3.11 | Verification 2, 5 (2b per adapter as accounts exist; scripted-fetch tests until then) |
| 5 | `docs: Phase 3 done` | T3.12 | Verification 2b (at least the chosen provider) and 4 |

Milestones: **M1** = commits 1–2 (jobs run locally on nudge and cron), **M2** = commit 3 (email
leaves the relay through every adapter), **M3** = commit 4, **M4** = Verification 4 (the first
production deploy) and commit 5.

## Checklist

- [x] T3.1 Spike: bundling, ALS, D1 claim semantics, local connect, shared local D1
- [ ] T3.2 `apps/relay`, composition root, socket types, scripts, guards, CI build, dev script, `RELAY` binding
- [ ] T3.3 Migration and `jobs` query module
- [ ] T3.4 Ports and adapters (`Jobs`, `Mailer` types, memory and unconfigured mailers)
- [ ] T3.5 Runner, backoff, enqueue, periodic, housekeeping, relay entry
- [ ] T3.6 Address, MIME, SMTP, Cloudflare socket adapter, contract
- [ ] T3.7 Brevo, SES, Microsoft 365 adapters
- [ ] T3.8 Mail settings, secrets, settings key, `relayMailer`
- [ ] T3.9 Theme tokens, context, layout, templates, the email job, views
- [ ] T3.10 Settings → Emails and its routes
- [ ] T3.11 Security notices
- [ ] T3.12 Docs and status
- [ ] Verification 1–5

## Open questions

None blocking. Decided with the user on 2026-11-13: the four adapters (D3.16), settings in D1 (Phase
2b, D3.17), security notices in this phase (D3.19), local verification before the first deploy
(Verification 2, 2b → 4). Still the developer's to provide before Verification 4: the Cloudflare
account and at least one provider account with a verified sending domain (index question 4).
