# Memoria

A client-gallery app for one photographer: upload a shoot, share a branded gallery, let the client
favourite, comment, request retouches and submit a selection, then deliver the edits and control
downloads and expiry.

Next.js 16 (App Router) + React 18 + TypeScript strict + Tailwind v3, deployed as a **Cloudflare
Worker** with [OpenNext](https://opennext.js.org/cloudflare), inside Cloudflare's free tier. Data in
**D1**, files in **R2** (planned), spam protection with **Turnstile**, a single admin with D1 sessions.
vitest, with **guard tests standing in for a linter**.

- Build plan and status: [docs/plans/202611/plan_202611_mvp.md](docs/plans/202611/plan_202611_mvp.md)
- Product spec and mockups: [docs/design/HANDOFF.md](docs/design/HANDOFF.md)
- Rules for humans and agents: [AGENTS.md](AGENTS.md) · wiki: [docs/README.md](docs/README.md)

## Quick start

```sh
npm ci
cp apps/web/.dev.vars.example apps/web/.dev.vars   # local secrets (test keys, a local admin password)
npm run db:migrate:local       # create the local D1 (apps/web/.wrangler/state)
npm run dev                    # http://localhost:3000 — admin: /admin, admin@example.local / local-dev-password-2026
```

No database server or Docker is needed: D1 and the other bindings run locally inside wrangler.

## Verify

```sh
npm run verify                 # ts-check (both tsconfigs) + test (D1 tests start an in-memory D1 themselves)
npm run build:worker           # the OpenNext Worker build
npm run preview                # the real Worker, locally, at http://localhost:8787
```

## Deploy

```sh
npm run db:migrate:remote      # apply new migrations to the production D1 first
npm run deploy
```

The first deploy runs from a terminal; after that, GitHub Actions checks every push to `master` and
deploys only when you run it by hand. One-time setup, secrets, rollback, backups, logs:
[docs/deployment.md](docs/deployment.md).

## What's where

See the table in [AGENTS.md](AGENTS.md#where-to-look) and [docs/architecture.md](docs/architecture.md).
