---
title: "Phase 1: Core and adapters"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 1: Core and adapters

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

Domain code talks to ports, never to Cloudflare directly, so the app can later also run in Docker. R2 is added behind the `BlobStore` port.

- **Depends on:** Phase 0
- **Unblocks:** every later phase
- **Mockups:** none
- **Scope (feature IDs):** architecture (supports D2, D5, J3, K3)

## Draft tasks

- [ ] T1.1 Port interfaces (`Db`, `BlobStore`, `Mailer`, `Jobs`, `Config`) and in-memory test adapters
- [ ] T1.2 Neutral types in `packages/db` (`Statement`, `WriteResult` instead of `D1PreparedStatement`, `D1Meta`); D1 adapter behind `Db`
- [ ] T1.3 Cloudflare composition root chosen by a build-time alias; Node root stubbed
- [ ] T1.4 R2 bucket `memoria-media` + binding; `BlobStore` R2 adapter; presigned URLs via `aws4fetch` (R2 API token as secrets)
- [ ] T1.5 Guard `platform-imports`: only adapters import `@opennextjs/cloudflare`, `cloudflare:*` or call `getCloudflareContext`
- [ ] T1.6 AGENTS.md (env through the `Config` port), `architecture.md`, `recipes.md`

## Known open questions

- Where do ports live: a new `packages/platform`, or inside `packages/core`?
- How the build-time alias works with OpenNext's bundling, and with vitest.
- R2 CORS rules and presigned multipart: verify before Phase 5 depends on them.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
