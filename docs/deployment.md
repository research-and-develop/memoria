---
title: Deployment
type: reference
updated: 2026-11-11
related: [architecture.md, ../.gitlab-ci.yml, ../.github/workflows/ci.yml]
---

# Deployment

How the app gets to Cloudflare, and the runbooks for the things that go wrong. Run every `wrangler`
command from `apps/web` (the npm scripts do this for you).

## One-time setup

```sh
cd apps/web
npx wrangler login
npx wrangler d1 create my-app --location <hint>   # e.g. weur/eeur/enam: near your visitors; FIXED at creation
#   → paste the printed database_id into wrangler.jsonc
npm run cf-typegen                                 # after any wrangler.jsonc change
npm run admin:hash-password -- --generate          # → the ADMIN_PASSWORD_HASH secret
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put TURNSTILE_SECRET_KEY       # Dashboard → Turnstile → add a widget (site key → vars)
npx wrangler secret put HASH_SALT                  # openssl rand -base64 32
cd ../.. && npm run db:migrate:remote && npm run deploy
```

Then set `ADMIN_EMAIL` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc` `vars`, and `SITE_URL` once a
custom domain serves the Worker (never before: canonical URLs would point at a domain that does not
answer). Custom domain: Worker → **Settings → Domains & Routes → Add → Custom domain**; a `www`
redirect is a Redirect Rule (`www.example.com/*` → `https://example.com/$1`, 301).

The very first deploy runs from a terminal (`wrangler login`): a CI token with *Workers: Editor* can
update a Worker but not create it.

## How a change ships

1. Push / merge request → CI: `npm ci`, `ts-check`, `test`, `build:worker`.
2. Default branch → the same, then a **manual** `deploy` job: `npm run db:migrate:remote`, then
   `opennextjs-cloudflare deploy`. Manual by design — a push never goes live by itself.

### Migrations run before the code

The new code goes live only after its migrations are applied, so for a moment the OLD code runs
against the NEW schema. Every migration must be safe for the code that is still running: add
tables/columns (nullable or with a default) first; drop or rename only in a later release, once no
deployed code reads them.

### Preview versions

`opennextjs-cloudflare upload` makes a new version that is NOT live, on its own preview URL. **A
preview version uses the production bindings** — the same D1. Use it only for changes that do not
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

## Rollback

- **Code**: `cd apps/web && npx wrangler rollback` (or Dashboard → Worker → Deployments). Instant;
  does not touch data.
- **Data**: D1 Time Travel restores the database to a point in time (7 days on the free plan):
  `npx wrangler d1 time-travel info DB`, then
  `npx wrangler d1 time-travel restore DB --timestamp=<ISO time>`. This rewinds every write after that
  time — export first (`npx wrangler d1 export DB --remote --output=backup.sql`).
- A migration is never "rolled back" by editing it: write a new migration that undoes it.

## Backups

Time Travel plus a scheduled SQL export: the `backup` job in `.gitlab-ci.yml` (a pipeline schedule,
e.g. weekly at night — an export briefly blocks other queries) keeps a gzipped dump as an artifact.
Download one now and then and keep it outside CI. Rehearse a restore into a scratch database once:

```sh
npx wrangler d1 create my-app-restore-test
npx wrangler d1 execute my-app-restore-test --remote --file=backup.sql
npx wrangler d1 delete my-app-restore-test
```

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
npm run measure:cpu -- https://my-app.<account-subdomain>.workers.dev/ 20
```

It tails the Worker, sends the requests and prints median/p95/max CPU and wall time per group
(`--group-by <header>`, default `cf-cache-status`). `--version <id>` reaches a version deployed at 0%
(`npx wrangler versions upload`, then `npx wrangler versions deploy <live>@100% <new>@0%`).

## Logs

Workers Logs is on (`observability` in `wrangler.jsonc`): Dashboard → Worker → Logs (3 days on the
free plan). Live: `cd apps/web && npx wrangler tail`. The app logs JSON events — search by the
`event` field, e.g. `unhandled_route_exception` (its `reqId` is the one the user saw).
