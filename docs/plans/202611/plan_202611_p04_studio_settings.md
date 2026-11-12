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
- [ ] T4.6 Gallery theming system (moved from Phase 0): **reuse Phase 0's mechanism (p00 D0.11)**: the gallery themes are colour-role sets like `theme/studio.mjs`, emitted with `themeCssVars` on their own scope. `packages/ui/theme/gallery.mjs` (light/dark hex, six accent swatches) read by a preset plugin that emits the CSS variables (`[data-gallery-theme]` light/dark/auto, `color-scheme`); `galleryTheme.ts` helpers (`hexToRgbTriplet`, `contrastText`, accent foreground/ring per theme incl. auto via `prefers-color-scheme`, checked against `bg` AND `surface`); explicit `exports` entries; `tokenHex` throws on non-hex colours; a test that renders the plugin through Tailwind
- [ ] T4.7 **Selectable gallery fonts** (moved from Phase 0; user request 2026-11-12: "different font families for the galleries, so the user can choose"). Same principle as the theme (p00 D0.11): one registry, nothing else names a font.
  - **Font registry** `apps/web/src/app/galleryFonts.ts`: one `next/font` call per family (next/font needs static calls), each `preload: false`, `display: 'swap'`, its own variable (`--font-g-<id>`). Starting set from the design: Instrument Serif 400, Cormorant Garamond 500, Space Grotesk, plus Inter for text; serif fallback Georgia.
  - **Pairings as data** `packages/ui/theme/galleryFonts.mjs`: `{ id, label, display: <font id>, text: <font id>, scripts: ['latin', 'cyrillic'?] }`; the default pairing's id is exported. Adding a font = one `next/font` call + one registry entry; the picker and `/admin/design` list it without other edits.
  - **Choice:** a default pairing in Studio settings → Branding (T4.1), overridable per gallery (Phase 5 new gallery, Branding tab). Stored as the pairing id (TEXT); an unknown id falls back to the default, so removing a pairing never breaks a gallery.
  - **Rendering:** all gallery font variable classes go on the gallery layout; the gallery root sets `--font-display` / `--font-text` to the chosen pairing's variables (`data-gallery-font="<id>"` rules generated from the registry). Browsers download a `@font-face` only when text uses it, so a client loads only the chosen pairing however many exist.
  - **Picker:** live samples of each pairing (gallery title + body line) with the photographer's own gallery title; pairings without Cyrillic are marked when the title contains Cyrillic.
  - `display-*` and `eyebrow-lg` sizes, `Display` primitive (never bold), studio logo mark; design page sections for the pairings.

## Known open questions

- Logo upload before the full upload pipeline exists: a simple single-file upload through the `BlobStore` port?
- Are built-in presets editable, or copy-on-edit?
- Cyrillic (from Phase 0): Instrument Serif (default display) and Space Grotesk have no Cyrillic. The registry's `scripts` field lets the picker warn; still decide the DEFAULT pairing (Cormorant Garamond has Cyrillic) and whether to add a Cyrillic-capable display serif.
- How many pairings to ship, and whether the photographer may mix any display font with any text font (free choice) or only curated pairings (safer typography). Proposal: curated pairings.
- Accent contrast (from the Phase 0 review): on the dark theme Pine 2.74 and Olive 2.67 fail 3:1 against `surface` `#1D1F21`; Navy, Plum and Ink fail against `bg` too. Rings and accent-coloured text fall back to `fg` where they fail.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
