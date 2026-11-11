---
title: "Phase 6: Client gallery"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 6: Client gallery

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

Clients open a gallery (link or password) and browse it on desktop and phone, in the studio's branding.

- **Depends on:** Phase 5
- **Unblocks:** Phases 7, 9, 11
- **Mockups:** `ClientGallery.dc.html`, `ClientLightbox.dc.html` (viewing parts), `Mobile.dc.html`
- **Scope (feature IDs):** F1, F2, G1–G5, G7–G9

## Draft tasks

- [ ] T6.1 Access gate: password → signed cookie (HMAC over gallery id + password version); `noindex`; visitor cookie and `visitors` row
- [ ] T6.2 Gallery page: cover, welcome note, set tabs, masonry/justified/square grid, light/dark, accent and fonts from settings, expiry footer
- [ ] T6.3 Mobile layout: set chips, 2-column grid, favourites bar, bottom navigation
- [ ] T6.4 Lightbox: keyboard, filmstrip, compare side by side
- [ ] T6.5 Protected delivery: images served from `worker.ts` after a cookie check
- [ ] T6.6 Right-click deterrent, social share buttons
- [ ] T6.7 Tokens moved from Phase 0: lightbox colours (`bg` #0F1011, `panel` #17191B, `fg` #F1F0EC, `muted` #A9ABAF, `soft` #D4D3CF, `border` #34363A, `accent` #8FD3BF, `fav` #E08A5C, `favFg` #F4B190) as constants with `color-scheme: dark`; `display-cover` (clamp(56px, 9vw, 112px)); the photo text shadow; the `scrim` button variant

## Known open questions

- Loading strategy for large galleries (paging, virtualised grid) within the CPU budget.
- Which gallery fonts are preloaded (only the chosen pairing).
- Link previews: Phase 0 keeps `robots.txt` open for gallery paths and relies on `X-Robots-Tag: noindex`, so Facebook/WhatsApp can fetch Open Graph tags. Decide which preview (cover image, title) a shared link shows, given galleries are private.
- Focus ring in galleries uses `--g-ring` (Phase 0 `galleryAccentVars`).

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
