---
title: "Phase 9: Downloads"
type: plan
status: placeholder
updated: 2026-11-12
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
- **Scope (feature IDs):** J1–J3, F4 (name or email at download), F5 (PIN)

## Draft tasks

- [ ] T9.1 Download API: checks mode, PIN and the downloader's name or email (required: no anonymous downloads); returns original keys
- [ ] T9.2 Single-photo download; share sheet ("Save to Photos") on phones
- [ ] T9.3 Browser ZIP: `client-zip`, stream to disk (`showSaveFilePicker`), ~500 MB parts elsewhere, progress, per set
- [ ] T9.4 `download_events` + counters

## Known open questions

- With public delivery and no display copy the lightbox already serves the original: the gallery form should say gating is cosmetic then.
- PIN brute-force limits per gallery.

## From Phase 1

- Single downloads: `blobUrls(config).readUrl(key, { downloadName, expiresInSeconds })`, a presigned
  GET with `response-content-disposition` (the client's original filename, from D1); expiry ≤ 1 day.
- The download API is public, so it is the minting gate: Turnstile and a rate limit before any URL.
- Browser ZIPs fetch presigned GETs cross-origin: the bucket's CORS rules (`apps/web/r2-cors.json`)
  allow `GET` from the app's origin and expose `Content-Length` (progress) and `Content-Disposition`.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
