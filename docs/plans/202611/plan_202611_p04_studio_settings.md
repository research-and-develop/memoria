---
title: "Phase 4: Studio settings"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 4: Studio settings

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

The photographer sets the studio's branding and the defaults every new gallery starts from.

- **Depends on:** Phases 2, 3
- **Unblocks:** Phase 5 (gallery creation reads the defaults and presets)
- **Mockups:** `Settings.dc.html` (Branding, Watermarks, Emails), `NewGallery.dc.html` (presets)
- **Scope (feature IDs):** B1–B8, C2 (presets)

## Draft tasks

- [ ] T4.1 Branding: logo light/dark (upload to R2), accent swatches, typography pairing, default theme, grid style
- [ ] T4.2 Gallery defaults: sizes, watermark image and position, download mode, expiry, proofing settings
- [ ] T4.3 Migration: `presets`; built-in presets (Wedding, Portrait, Event, Newborn, Commercial, Blank); save a gallery's settings as a preset
- [ ] T4.4 Email settings (sender name, reply-to) and template text; test email
- [ ] T4.5 Time zone and locale as studio settings (replacing the constants in `lib/dates.ts`)
- [ ] T4.6 Gallery theming system (moved from Phase 0): `packages/ui/galleryPalette.mjs` (light/dark hex, six accent swatches, four font pairings) read by a preset plugin that emits the CSS variables (`[data-gallery-theme]` light/dark/auto, `color-scheme`); `galleryTheme.ts` helpers (`hexToRgbTriplet`, `contrastText`, accent foreground/ring per theme incl. auto via `prefers-color-scheme`, checked against `bg` AND `surface`); explicit `exports` entries; `tokenHex` throws on non-hex colours; a test that renders the plugin through Tailwind
- [ ] T4.7 Gallery fonts (moved from Phase 0): `app/galleryFonts.ts` (Instrument Serif 400, Cormorant Garamond 500, Space Grotesk; `preload: false`, serif fallback Georgia), `[data-gallery-font]` → `--font-display`, `display-*` and `eyebrow-lg` sizes, `Display` primitive (never bold), studio logo mark; design page sections for both

## Known open questions

- Logo upload before the full upload pipeline exists: a simple single-file upload through the `BlobStore` port?
- Are built-in presets editable, or copy-on-edit?
- Cyrillic (from Phase 0): Instrument Serif (default display) and Space Grotesk have no Cyrillic. If titles or names are in Cyrillic, make Cormorant Garamond (`classic`) the default pairing or accept the Georgia fallback.
- Accent contrast (from the Phase 0 review): on the dark theme Pine 2.74 and Olive 2.67 fail 3:1 against `surface` `#1D1F21`; Navy, Plum and Ink fail against `bg` too. Rings and accent-coloured text fall back to `fg` where they fail.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
