---
title: "Phase 7: Proofing"
type: plan
status: placeholder
updated: 2026-11-12
related: [plan_202611_mvp.md]
---

# Phase 7: Proofing

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

Clients favourite photos into lists, comment, request retouches and submit a selection; the studio is notified.

- **Depends on:** Phases 3, 6
- **Unblocks:** Phase 8
- **Mockups:** `ClientGallery.dc.html` (favourites bar), `ClientLightbox.dc.html` (lists, retouch, comments), `ClientSelection.dc.html`
- **Scope (feature IDs):** H1–H9, C6 (approve/reject)

## Draft tasks

- [ ] T7.1 Migration: `favorite_lists`, `favorites`, `photo_comments`, `retouch_requests`
- [ ] T7.2 Favourites with progress against the included number; named lists; share a list
- [ ] T7.3 Comment thread (client ↔ studio); retouch request chips
- [ ] T7.4 Review and submit: remove with undo, count against the included number (no price), note, submit, confirmation, reopen; lock after submit
- [ ] T7.5 Commercial mode: approve/reject instead of hearts
- [ ] T7.6 Email to the studio on submit
- [ ] T7.7 `Progress` primitive (moved from Phase 0): `role="progressbar"`, `aria-valuenow`/`min`/`max`, accent fill, over-limit tone

## Known open questions

- Client identity across devices (index, open question 1).
- Write budget: rapid favourite toggles → debounce or batch on the client.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
