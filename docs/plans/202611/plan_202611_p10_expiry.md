---
title: "Phase 10: Expiry and lifecycle"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 10: Expiry and lifecycle

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

Galleries publish on schedule, warn the client before they expire and act on expiry.

- **Depends on:** Phases 3, 5
- **Unblocks:** —
- **Mockups:** `NewGallery.dc.html` (Expiry), `Main.dc.html` (Expiring, Extend)
- **Scope (feature IDs):** F8, K1, K2 (hide, delete web sizes), K3, K4

## Draft tasks

- [ ] T10.1 Expiry date, Extend action, scheduled publish (`publish_at`)
- [ ] T10.2 Relay jobs: reminders 14 and 2 days before expiry (dedupe per gallery per kind)
- [ ] T10.3 After-expiry actions: hide, delete web sizes; archive

## Known open questions

- Status stored, or derived from `publish_at` / `expires_at` at read time?

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
