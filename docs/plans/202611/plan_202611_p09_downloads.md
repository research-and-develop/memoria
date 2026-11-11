---
title: "Phase 9: Downloads"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 9: Downloads

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

Clients download single photos or whole sets as ZIPs built in their browser, within the gallery's download rules.

- **Depends on:** Phase 6
- **Unblocks:** Phase 11 (download counts)
- **Mockups:** `NewGallery.dc.html` (Downloads), `ClientGallery.dc.html`, `ClientLightbox.dc.html`, `Mobile.dc.html`
- **Scope (feature IDs):** J1–J3, F4 (email at download), F5 (PIN)

## Draft tasks

- [ ] T9.1 Download API: checks mode, PIN, email; returns original keys
- [ ] T9.2 Single-photo download; share sheet ("Save to Photos") on phones
- [ ] T9.3 Browser ZIP: `client-zip`, stream to disk (`showSaveFilePicker`), ~500 MB parts elsewhere, progress, per set
- [ ] T9.4 `download_events` + counters

## Known open questions

- With public delivery and no display copy the lightbox already serves the original: the gallery form should say gating is cosmetic then.
- PIN brute-force limits per gallery.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
