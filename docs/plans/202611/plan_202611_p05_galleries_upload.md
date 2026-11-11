---
title: "Phase 5: Galleries and upload"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 5: Galleries and upload

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

The photographer creates a gallery, uploads photos (processed in the browser) and manages sets, photos and sharing.

- **Depends on:** Phases 1, 4
- **Unblocks:** Phases 6, 9, 10
- **Mockups:** `NewGallery.dc.html`, `GalleryEditor.dc.html`
- **Scope (feature IDs):** C1, C3–C6, D1–D6, D10, E1–E7, F1, F2, F5–F8

## Draft tasks

- [ ] T5.1 Migration: `galleries`, `photo_sets`, `photos`
- [ ] T5.2 New gallery screen: preset, details, slug, access, delivery mode, downloads, PIN, watermark, sizes, proofing, expiry; draft autosave; checklist; email preview
- [ ] T5.3 Upload client: Web Worker pool, SHA-256 dedupe, EXIF (`exifr`), GPS strip, thumbnail/display/watermark, placeholder, presigned upload, IndexedDB resume, unsupported-format notice
- [ ] T5.4 Folder drop (subfolders → sets), auto-split by capture-time gaps
- [ ] T5.5 Gallery manager: sets add/rename/reorder, multi-select bulk bar (move, hide, cover, delete), sort, smart filters, badges, feature toggles
- [ ] T5.6 Replace with edited version (keeps favourites and comments)
- [ ] T5.7 Sharing panel: link, password, PIN, QR, view-only guest link, scheduled publish
- [ ] T5.8 Delete gallery: rows in one batch + an R2 cleanup job
- [ ] T5.9 Primitives moved from Phase 0: `scrim` colour token (`rgb(22 23 26 / <alpha-value>)`, count badges on photos) and the selectable `Chip` (`chip.tsx`, pill, 1.5 px border, 44 px; presets, set chips), Tabs (gallery manager tabs)

## Known open questions

- Gallery URLs at the root or under `/g/` (index, open question 2); custom domain (open question 3).
- Likely split into 5a (upload pipeline) and 5b (gallery manager) when detailed.
- Pipeline details: thumbnail size and quality, placeholder encoding, worker pool size, Safari support.
- From the Phase 0 review: responses answered in `worker.ts` (protected images) set `X-Robots-Tag` and the security headers themselves; the public R2 custom domain is a separate origin with no Next headers (Transform Rule for `X-Robots-Tag`). Email validation was deleted in Phase 0 (`lib/validation/email.ts`, recoverable from `a581b72`).

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
