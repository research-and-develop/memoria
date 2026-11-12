---
title: "Phase 3: Relay Worker and email"
type: plan
status: placeholder
updated: 2026-11-12
related: [plan_202611_mvp.md]
---

# Phase 3: Relay Worker and email

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

A second Worker, `memoria-relay`, runs background jobs from a D1 `jobs` table and sends email over SMTP.

- **Depends on:** Phase 1
- **Unblocks:** Phases 4 (test email), 7, 8, 10, 11
- **Mockups:** `Settings.dc.html` (Emails), `NewGallery.dc.html` (email preview)
- **Scope (feature IDs):** B8, F3 (if chosen), I5, K3; jobs for R2 cleanup and IP expiry

## Draft tasks

- [ ] T3.1 `apps/relay` Worker: shared D1, Cron Trigger, service binding from `memoria`
- [ ] T3.2 Migration: `jobs` (kind, payload, status, attempts, run_after, last_error, dedupe_key UNIQUE); `Jobs` port Cloudflare adapter (enqueue in the caller's batch + nudge)
- [ ] T3.3 Runner: claim with `UPDATE … WHERE status = 'pending'`, backoff, dead after N attempts, bounded work per run
- [ ] T3.4 SMTP `Mailer` (`worker-mailer`, 587 STARTTLS / 465 TLS); SMTP secrets in `.dev.vars.example`
- [ ] T3.5 Email templates (plain HTML in code, studio branding); "Send test email"
- [ ] T3.6 CI and `deployment.md`: two Workers, deploy order, a second app in the monorepo

## Known open questions

- SMTP provider and sending domain (index, open question 4).
- How the relay reaches shared code (packages vs. importing from `apps/web`).
- Local development of two Workers (wrangler dev with a service binding).
- From the Phase 0 review: the `wrangler-config` guard, `cf-typegen` and `scripts/measure-cpu.mjs` assume one Worker (`apps/web`); make them per-app. A second `services` entry (`memoria-relay`) must not trip the guard's "every hard-coded Worker name = name" check. Both Workers bind the same D1 (`database_id`, `migrations_dir`); only `apps/web` runs `db:migrate`. The relay sets `workers_dev: false` and `preview_urls: false`.

## From Phase 1

- The relay builds its platform with `cloudflarePlatform(env, ctx.waitUntil)` from
  `@repo/platform-cloudflare/platform` (no OpenNext import). Its env type extends `CloudflarePlatformEnv`.
- `Mailer` and `Jobs` are new ports in `packages/platform/ports.ts`, each with a contract suite in
  `packages/platform/contract/`, an in-memory adapter for the test platform and a `Platform` method
  (recipes.md → A binding). `useTestPlatform` grows the matching options.
- Guard `platform-boundary`: add `apps/relay/src` to its roots and the relay's Worker entry to its
  allowed files, as `apps/web/worker.ts` is.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
