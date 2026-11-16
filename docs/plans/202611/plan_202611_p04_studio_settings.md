---
title: "Phase 4: Studio settings"
type: plan
status: draft
updated: 2026-11-16
related: [plan_202611_mvp.md, plan_202611_p02b_settings_db.md, plan_202611_p03_relay_email.md, plan_202611_p05_galleries_upload.md, plan_202611_p06_client_gallery.md, ../../design/HANDOFF.md, ../../recipes.md, ../../../AGENTS.md]
---

# Phase 4: Studio settings

## Goal

The photographer sets the look every client gallery starts from (accent, light/dark theme, font
pairing, grid style), the defaults of a new gallery (purpose, the generated sizes and their quality,
access, image delivery) and the watermark that Phase 5 bakes into display copies. The gallery theme and
font systems exist as code, so Phase 6 renders a branded gallery with no new design work.

This phase is cut in two. **M1 is the minimum that Phases 5 and 6 need** for the first usable version
(upload a shoot → the client opens a branded gallery → favourites and submits). **M2 comes after the
first usable version**: the logo, presets, client-email text, time zone.

**Done when (M1):**

- **Settings → Branding** saves the default accent (one of six swatches), theme (light, dark, auto),
  font pairing (from a registry) and grid style (masonry, justified, square), with a live sample.
- **Settings → Galleries** (a new section) saves the new-gallery defaults: purpose (selection or
  sharing); per purpose the display copy's long edge and quality; the thumbnail's long edge and
  quality; whether selection galleries are watermarked; access (link or password); image delivery
  (public; protected listed as *Soon* until Phase 6 M2).
- **Settings → Watermarks** saves one watermark: an image (PNG or WebP with transparency, uploaded to R2
  through a presigned PUT) or a text, its position, size, opacity and margin, previewed live on a sample
  photo by **the same browser function Phase 5's pipeline calls** (`applyWatermark`).
- The **gallery theme** (`packages/ui/theme/gallery.mjs`) declares the studio's colour roles with the
  gallery values for light and dark, emitted as CSS variables on `[data-gallery-theme]`; an accent swatch
  becomes the accent roles with contrast-checked fallbacks; every pair is pinned in
  `colorContrast.test.ts`.
- The **font registry** (`app/galleryFonts.ts` + `theme/galleryFonts.mjs`) holds the four pairings of
  the design; adding one is one `next/font` call plus one entry; `/admin/design` shows the gallery
  themes, swatches and pairings.
- `npm run ts-check` and `npm run test` green; `/admin/design` and the three sections checked at 360 px
  and 1440 px.

**Done when (M2, after the first usable version):** the logo (light and dark) in Branding; the
`presets` table with built-in presets and "save as preset" (Phase 5's New gallery then starts from one);
the editable text of the client emails (Phase 5's gallery-ready email onwards) with the sender's name in
the sign-off; the studio time zone and locale replacing the constants in `lib/dates.ts`.

- **Depends on:** Phases 2 (settings shell), 2b (the settings store pattern), 3 (Settings → Emails, the
  email layout). **Unblocks:** Phase 5 (gallery defaults, watermark, font and theme ids), Phase 6 (the
  gallery theme and fonts).
- **Mockups:** `Settings.dc.html` (Branding: logo, accent, typography, theme, grid), `NewGallery.dc.html`
  (the fields whose defaults live here, the watermark toggle; presets in M2), `ClientGallery.dc.html`
  (the gallery colours). **There is no Watermarks or Galleries-defaults mockup** ("Watermarks" is only a
  label in the Settings sidebar): this plan designs both screens from `SettingsCard`s, checked with the
  owner at Verification 2.
- **Scope (feature IDs):** B1–B7 (B8, email settings, moved to Phase 3), C2 (presets, M2).

## Starting point (verified 2026-11-16 against master `e6ed219`: Phases 0–2b done, Phase 3 M1–M2 done)

- **Settings shell** (Phase 2): `/admin/settings/<section>`, sections in
  `components/admin/settings/nav.ts` (`SETTINGS_SECTIONS`): Studio, Security, then Branding, Watermarks
  and Emails with `soonPhase: 4`. Phase 3 M3 (in progress) builds Settings → Emails and drops its flag:
  **this phase owns no email settings screen**. A section is a stack of `SettingsCard`s
  (`components/admin/settings/SettingsCard.tsx`); `nav.test.ts` fails when a page and its entry
  disagree.
- **Settings store** (Phase 2b): `site_settings` (`key` `GLOB '[a-z]*'` ≤ 64, `value` JSON) with
  `getSiteSetting` / `upsertSiteSettingStatement` (`lib/db/queries/site_settings`). The model is the
  `studio` row: a pure parser (`lib/settings/parseStudioInput.ts`) shared by route, form and reader;
  `readStudio()` never throws (logs and falls back); `studio.cached.ts` is the `perRender` form; the route
  `api/admin/settings/studio` upserts and audits in one batch (docs/recipes.md → A studio setting). The
  settings of this phase have **no env default**, so `Config.bootstrap` and guard
  `settings-through-store` are untouched.
- **Theme mechanism** (Phase 0, D0.11): `packages/ui/theme/studio.mjs` holds the colour roles
  (`ground`, `surface`, `wash`, `ink.{DEFAULT,2,muted,faint,hover}`, `line.{DEFAULT,control,input}`,
  `accent.{DEFAULT,ink,tint}`, `focus`, `inverse`, `alert`, …); `theme/cssVars.mjs` has `flattenColors`,
  `hexToChannels` (throws on anything but `#RRGGBB`), `themeCssVars(colors)` → `{ '--color-<role>': 'r g b' }`
  and `tailwindColors`; its header already says Phase 4's gallery theme is "the same variables with
  other values on its own scope". `theme/tokens.mjs` has `tokenHex(token, colors = studio)` (the relay
  imports it for emails). `packages/ui/colorContrast.test.ts` pins text/surface pairs.
  **Nothing gallery-specific exists yet**: no `gallery.mjs`, no `galleryAccentVars` (named in the Phase
  6 placeholder; it was never built).
- **Fonts**: `apps/web/src/app/fonts.ts` loads Inter (`--font-text`, `subsets: ['latin']`, variable) and
  JetBrains Mono (`--font-mono`, `preload: false`); the root layout puts both classes on `<html>`. Other
  scripts render through Inter's `unicode-range` faces (Cyrillic included).
- **Root layout** `app/layout.tsx` is `force-dynamic` and reads `getAppConfig()` per request (Phase 6
  splits a gallery root layout off it; this phase does not touch it).
- **Media** (Phase 1): `blobUrls(config).uploadUrl(key, { contentType, size })` mints a presigned PUT (S3
  mode) or a signed dev route URL; `publicUrl(key)` is the public media domain or null; keys must pass
  `isBlobKey` (prefixes `galleries`, `branding`, `dev`); `MEDIA_TYPES` = JPEG, PNG, WebP;
  `getPlatform().blobs().head(key)` re-checks size and type. **No route mints an upload yet**: the
  watermark image is the first (Phase 5 reuses the pattern for photos).
- **Email** (Phase 3): `EmailContext = { studioName, siteUrl, link(path) }` (`lib/email/context.ts`);
  `renderEmail` is pure (`templates/registry.ts`, one template: `test`); the mail settings (`site_settings`
  row `mail`) already hold the **From name and reply-to** (D3.17). So the old T4.4 loses "test email" and
  "sender name and reply-to" as settings; what is left is the editable text of client emails and
  passing the From name into `EmailContext` for sign-offs (M2).
- **Dates**: `lib/dates.ts` has `APP_LOCALE = 'en-GB'`, `APP_TIME_ZONE = 'UTC'` as constants (M2).
- **Primitives available**: `Segmented`, `Toggle`, `Button`, the `@repo/ui/input` fields, `Dialog`. The
  selectable `Chip` and Tabs arrive in Phase 5 (T5.9); Branding uses `Segmented` and radio cards.
- **Migrations**: `0001`–`0005` are applied to the production D1 (smoke deploy 2026-11-16) and are
  forward-only. **M1 needs no migration** (rows in `site_settings`); M2's `presets` table takes the next
  free number when it lands.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D4.1 | **M1 = what Phases 5–6 consume; M2 after the first usable version.** M1: Branding (accent, theme, fonts, grid), Galleries (defaults), Watermarks, the gallery theme and font systems. M2: logo, presets, client-email text, time zone/locale. | The owner wants a usable version soon; none of M2 blocks uploading or viewing a gallery. A gallery without a logo shows the studio name in the display font (the mockup's header is text). |
| D4.2 | **Three `site_settings` rows, no table**: `branding`, `gallery_defaults`, `watermark`. Each has a pure parser shared by route, form and reader; an invalid stored row is ignored and logged, and the built-in default used (`readStudio`'s rule). No env defaults. | Phase 2b's store; a field added later (Phases 7, 9, 10 add proofing, download and expiry defaults to `gallery_defaults`) needs no migration. |
| D4.3 | **New galleries copy the defaults; nothing reads them afterwards.** Phase 5 snapshots `gallery_defaults`, the branding choices and the watermark into the gallery's own settings at creation. Changing a default never changes an existing gallery. | The watermark and sizes are baked into files at upload (index → Watermark); a gallery must look tomorrow as it did when it was shared. |
| D4.4 | **The gallery theme reuses the studio's role names.** `theme/gallery.mjs` exports `light` and `dark` maps with exactly the keys of `studio.colors` (a test compares the flattened key sets), values from HANDOFF → Client gallery: `ground` = bg, `surface` = bg (cards sit flat in a gallery), `wash` = the gallery surface, `ink` = fg, `ink-2`/`ink-muted` = muted, `line` = border; the rest derived per theme. The preset emits them with `themeCssVars` on `[data-gallery-theme="light"]`, `[data-gallery-theme="dark"]` and `[data-gallery-theme="auto"]` (light, then dark inside `@media (prefers-color-scheme: dark)`), each with `color-scheme`; plus a fixed **`lightbox`** map (Phase 6's T6.7 values) on `[data-gallery-theme="lightbox"]`. Roles a gallery does not use (status pills, `danger`, `alert`) keep the studio values; `ink-faint`, `ink-hover`, `line-control`, `line-input` are derived and listed in `gallery.mjs` with a comment each. Gallery rules are emitted **after** the `:root` rule (equal specificity) and the auto-dark media rule after the light one. | Every `@repo/ui` primitive (Button, inputs, Dialog) works inside a gallery unchanged; a gallery is "another set of values for the same roles" (cssVars.mjs). |
| D4.5 | **Accents are six curated swatches** (Pine `#1F6F5C`, Ink `#16171A`, Clay `#A4532E`, Navy `#2747A0`, Plum `#6B3A6E`, Olive `#5B6630`), stored by id. `galleryAccent(swatchId, theme)` (pure) returns the accent roles: **`accent`** (fills, rings, the heart: UI contrast) = the swatch if it reaches **3.2:1** (3:1 with a margin) against `ground` and `wash`, else the swatch mixed toward white (dark theme) or black (light) in sRGB in 5 % steps until it does; **`accent-ink`** (any accent-coloured text, links) = the same mixing until **4.5:1** against both; `focus` = `accent-ink`; `accent-tint` = the swatch at 12 % over `ground`; `inverse` by `contrastText` on `accent`. **Gallery text never uses `accent`, only `accent-ink`.** No free hex in M1. | Pre-checked swatches cannot produce an unreadable gallery. Computed (review 2026-11-16) against light bg / light surface / dark bg / dark surface: Pine 5.77/5.24/3.09/2.74, Ink 17.2/15.6/1.04/1.08, Clay 5.22/4.74/3.41/3.04, Navy 8.06/7.32/2.21/1.96, Plum 8.19/7.44/2.18/1.93, Olive 5.94/5.39/3.00/2.67: all but Clay are lightened on dark; Clay and Olive would pass a bare 3:1 by hundredths, hence 3.2. |
| D4.6 | **The accent is applied by attribute, not inline style**: the preset emits one rule per swatch × theme (`[data-gallery-theme="dark"][data-gallery-accent="pine"] { --color-accent: …; … }`, auto in its media query): 18 small rules. A gallery root carries `data-gallery-theme`, `data-gallery-accent` and `data-gallery-font`. | No flash of the wrong colour, no JavaScript to theme the page, works in the static shell Phase 6 serves. |
| D4.7 | **Fonts: curated pairings in a registry** (p00 D0.11, user 2026-11-12). `app/galleryFonts.ts` makes one `next/font/google` call per family (`preload: false`, `display: 'swap'`, `--font-g-<id>`, subsets `latin` + `cyrillic` where the family has it); `theme/galleryFonts.mjs` lists pairings `{ id, label, display, text, scripts }` and the default id. Pairings: **Editorial** (Instrument Serif + Inter), **Classic** (Cormorant Garamond + Inter), **Modern** (Space Grotesk + Inter), **Quiet** (Inter only). An unknown id reads as the default. No free mixing. | Typography stays good; the picker, the design page and the gallery read one list; a removed pairing never breaks a gallery. |
| D4.8 | **Default pairing: Classic** (Cormorant Garamond has Cyrillic), unless the owner says titles are never Cyrillic (index question 5). The picker marks pairings without Cyrillic when the sample title contains Cyrillic. | Instrument Serif and Space Grotesk have no Cyrillic: a Bulgarian couple's names would fall back to Georgia in the title. |
| D4.9 | **One watermark**, `kind: 'image' \| 'text'`. Image: PNG or WebP ≤ 2 MB, ≤ 4000 px, uploaded to `branding/watermarks/<uuid>.<ext>` (server-generated key) through a presigned PUT, registered by `head()`; its stored width and height are hints, re-read from the decoded bitmap, which is pre-scaled once per upload session to the largest size it can be drawn at (display long edge × size), so no worker holds a 64 MB bitmap. Text: ≤ 60 characters in a fixed font list (`Arial, Helvetica, sans-serif` or `Georgia, 'Times New Roman', serif`, never a generic keyword alone, so the main-thread preview and the worker resolve the same face; no web font inside a Web Worker). Position: nine anchors or `tiled`; **size = the mark's width as 5–60 % of the photo's long edge** (text: measured with `measureText` at a 100 px reference and scaled); opacity 10–100 %; margin 0–10 %. | Photographers have a signature PNG; a text watermark covers the rest without font loading in workers. Several named watermarks ("Northlight signature" in the mockup) can come with presets (M2). |
| D4.10 | **`applyWatermark` is shared browser code** in `apps/web/src/lib/images/watermark.ts`: pure geometry (`watermarkBox(photo, mark, placement)`, `mark` = the bitmap's size or the text's measured size at the reference; table-tested) plus the canvas drawing (works on `OffscreenCanvas` and `HTMLCanvasElement`). Settings → Watermarks previews with it on a bundled sample photo; Phase 5's worker calls the same function. | What the photographer previews is exactly what gets baked. |
| D4.11 | **Watermark images are never deleted in M1.** A gallery snapshots the watermark's key (D4.3); replacing the watermark uploads a new key. Orphans are a few hundred KB. | Deleting a key a gallery still references would break re-processing (Phase 5 M4) for no real saving. |
| D4.14 | **Reading the watermark back**: `GET /api/admin/settings/watermark` returns the settings and `imageUrl` = `publicUrl(key) ?? await readUrl(key, { expiresInSeconds: 3600 })` (the dev read route locally, a presigned GET before a public domain exists: one admin-only image, so a per-call URL is acceptable). Settings → Watermarks and Phase 5's upload session both take the URL from it; the worker receives it with the watermark settings. | Minting is the gate (AGENTS.md); without it neither the preview nor the pipeline can load the image. |
| D4.12 | **Saving these settings needs no code** (they cannot redirect links or lock anyone out) and is audited with the field names, not the values (recipe → A studio setting). | Phase 2b's rule: a code only for what can redirect or lock out. |
| D4.13 | **The image-delivery default offers `protected` only once Phase 6 M2 builds it**: until then the option shows *Soon* and the parser refuses it. | No setting may promise behaviour that does not exist. |

## Design

### Settings rows (pure parsers in `apps/web/src/lib/settings/`)

```ts
// parseBrandingInput.ts → site_settings 'branding'
type Branding = {
  accent: AccentId;             // 'pine' | 'ink' | 'clay' | 'navy' | 'plum' | 'olive'; default 'pine'
  theme: 'light' | 'dark' | 'auto';                // default 'auto'
  font: string;                 // a pairing id; unknown → DEFAULT_PAIRING ('classic', D4.8)
  grid: 'masonry' | 'justified' | 'square';        // default 'masonry'
  // M2: logo: { light: LogoRef | null; dark: LogoRef | null }
};

// parseGalleryDefaultsInput.ts → site_settings 'gallery_defaults'
type GalleryDefaults = {
  purpose: 'selection' | 'sharing';                // default 'selection'
  display: { selection: Size; sharing: Size };     // defaults { 1600, 75 } and { 2048, 82 }
  thumb: Size;                                     // default { 800, 70 }
  watermarkSelection: boolean;                     // default true (reads false while no watermark is saved)
  access: 'link' | 'password';                     // default 'link'
  delivery: 'public';                              // 'protected' accepted from Phase 6 M2 (D4.13)
  // Phases 7, 9, 10 add proofing, downloads and expiry defaults here
};
type Size = { longEdge: number; quality: number }; // longEdge 400–4096 (display > thumb), quality 40–95

// parseWatermarkInput.ts → site_settings 'watermark'
type Watermark =
  | ({ kind: 'image'; key: string; width: number; height: number; contentType: 'image/png' | 'image/webp' } & Placement)
  | ({ kind: 'text'; text: string; font: 'sans' | 'serif'; ink: 'light' | 'dark' } & Placement);
type Placement = { position: Anchor | 'tiled'; size: number; opacity: number; margin: number };
```

- `parse*Input(value)` → `{ ok: true, value } | { ok: false, message, field }` (messages in the
  product's language), shared by the form (inline errors) and the route.
- Readers `readBranding()`, `readGalleryDefaults()`, `readWatermark()` (`lib/settings/<thing>.ts`): the
  row, else the default; never throw; log `<thing>_settings_unavailable` / `_invalid`. React-free (the
  relay may read branding for email colours in M2). `*.cached.ts` `perRender` forms for server
  components.
- A text watermark's text is stripped of control and bidi characters (it is drawn into every photo).

### Routes

| Route | Body | Does |
| --- | --- | --- |
| `PATCH /api/admin/settings/branding` | `Branding` | parse → `batch([upsert, audit('update', 'branding', { fields })])` → `{ data }` |
| `PATCH /api/admin/settings/gallery-defaults` | `GalleryDefaults` | the same |
| `GET /api/admin/settings/watermark` | — | `{ data: { watermark, imageUrl } }` (D4.14), `Cache-Control: no-store` |
| `POST /api/admin/settings/watermark/upload` | `{ contentType, size }` | type PNG/WebP, size ≤ 2 MB; key `branding/watermarks/<uuid>.<ext>`; `blobUrls(config).uploadUrl(key, { contentType, size, expiresInSeconds: 600 })` → `{ data: { key, upload } }`; rate limit 20 an hour; `MEDIA_NOT_CONFIGURED` → 503 |
| `PATCH /api/admin/settings/watermark` | `Watermark` | parse; for `image`: the key must match `branding/watermarks/<uuid>.(png\|webp)` and `blobs().head(key)` must exist with that type and ≤ 2 MB (else 400 `UPLOAD_MISSING` / `UPLOAD_INVALID`); upsert + audit |

All follow the house pattern (`requireAdmin` first, `withErrorHandling`, `invalidParamsError`); writes are
`PATCH` like the reference route `api/admin/settings/studio`.

### Screens

- **Settings → Branding** (`/admin/settings/branding`): cards *Accent* (six swatch buttons, the selected
  one ringed; a note where a swatch is lightened on dark, D4.5), *Theme* (`Segmented` Light / Dark /
  Auto), *Gallery typography* (radio cards: the pairing's label, a sample title in its display font and a
  body line in its text font; the sample title is editable, so the photographer can type a Cyrillic
  name), *Grid style* (radio cards with a small diagram). One **Save**. A **preview panel** shows a
  miniature gallery header and grid in light and dark side by side, using the real attributes (D4.6).
- **Settings → Galleries** (`/admin/settings/galleries`, a new entry after Branding): *Purpose* (radio
  cards: "Selection — the client picks; only a low-resolution copy is shown" / "Sharing — full-resolution
  downloads"), *Generated sizes* (per purpose: long edge and quality; the thumbnail; a line "about N KB a
  photo" from a fixed table, no measurement), *Watermark* (Toggle "Watermark selection galleries",
  disabled with a link to Watermarks while none is saved), *Access* (Segmented Link / Password), *Image
  delivery* (Public; Protected *Soon*).
- **Settings → Watermarks** (`/admin/settings/watermarks`): kind (Segmented Image / Text); image: a file
  picker (PNG/WebP), uploaded on choice (mint → PUT; saved with **Save**); text: the text, font, light or
  dark ink; the placement controls; a **live preview** canvas on a bundled sample photo
  (`public/samples/watermark-sample.jpg`, 1600 px, licence-free) drawn by `applyWatermark` and redrawn on
  each change (debounced 100 ms).
- `SETTINGS_SECTIONS`: Branding and Watermarks drop `soonPhase`; Galleries is added; Emails is Phase 3's
  (Phase 3 M3 drops its flag and lands first; this phase rebases on it, so the two never edit the same
  `nav.ts` lines at once).

### The gallery theme (`packages/ui/theme/`)

```
gallery.mjs         light, dark: role maps (the keys of studio.colors, D4.4); SWATCHES: { id, label, hex }[]
contrast.mjs        relativeLuminance, contrastRatio (moved out of colorContrast.ts, which imports it)
galleryAccent.mjs   contrastText, mixToward, galleryAccent(id, theme) → accent roles (D4.5),
                    galleryThemeRules() → [{ selector, media?, vars }] (pure; the preset and tests read it)
tailwind-preset.mjs a plugin: addBase(galleryThemeRules()) — themes, accents, font pairings, color-scheme
galleryFonts.mjs    PAIRINGS, DEFAULT_PAIRING, pairing(id) (unknown → the default)
```

- `colorContrast.test.ts` gains rows: per theme, `ink`/`ink-2`/`ink-muted` on `ground` and `wash` (AA
  4.5); per swatch × theme, `accent` against `ground` and `wash` (3:1, UI) and `inverse` on `accent` (AA) —
  computed through `galleryAccent`, so the fallbacks are what is tested.
- No `exports` change: `./theme/*` → `./theme/*.mjs` already covers the new files.
- A preset test renders a fixture through Tailwind and asserts the dark rule, an auto media rule and
  an accent rule exist with channel values.

### The font registry

- `apps/web/src/app/galleryFonts.ts`: `Instrument_Serif({ weight: '400', subsets: ['latin'], preload: false, display: 'swap', variable: '--font-g-instrument' })`,
  `Cormorant_Garamond({ weight: '500', subsets: ['latin', 'cyrillic'], …, variable: '--font-g-cormorant' })`,
  `Space_Grotesk({ subsets: ['latin'], …, variable: '--font-g-space' })`; Inter is the studio's
  `--font-text`. Exports `GALLERY_FONT_CLASSES` (every `variable` class).
- The preset plugin emits, from `PAIRINGS`, `[data-gallery-font="<id>"] { --font-display: var(--font-g-…), Georgia, serif }`.
  A gallery root carries `GALLERY_FONT_CLASSES` and `data-gallery-font`; a browser downloads a face only
  when text uses it, so a client loads only the chosen pairing.
- `studio.fontFamily` gains `display: ['var(--font-display)', 'Georgia', 'serif']`; `globals.css`
  declares `--font-display: Georgia, serif` on `:root`, so `font-display` works outside a gallery (the
  design page, Branding's samples).
- `display-cover` (clamp(56px, 9vw, 112px)), `display-lg`, `display-md` and `eyebrow-lg` join
  `studio.mjs`'s type scale (tailwind-merge learns them from there); a `Display` component in
  `typography.tsx` (never bold).
- Admin pages that show samples (Branding, `/admin/design`) put `GALLERY_FONT_CLASSES` on their wrapper
  only.

### The watermark function (`apps/web/src/lib/images/watermark.ts`)

- `watermarkBox(photo: { w, h }, mark: { w, h }, placement)` → the boxes to draw (one, or a tiled grid),
  pure; a mark larger than the photo is scaled down.
- `applyWatermark(ctx, photo, watermark, assets)`: `globalAlpha` = opacity; image: `drawImage(bitmap, …box)`;
  text: `font` from the size, a 1 px shadow in the opposite ink for legibility. Only the 2D context, so
  it runs in a Web Worker on `OffscreenCanvas`.
- `loadWatermarkAssets(watermark, url)`: fetches the image (CORS from the public media domain, or the
  dev read route) and `createImageBitmap`s it once per upload session.

### M2 (after the first usable version)

- **T4.8 Logo**: `branding.logo.{light,dark}` through the same mint/`head()` flow under
  `branding/logos/`; shown in the gallery header (Phase 6) and the email layout (an `<img>` from the
  public domain, the studio name as `alt`).
- **T4.9 Presets**: `migrations/NNNN_presets.sql` (`presets`: id, name ≤ 60, `settings` JSON = the
  gallery settings shape of Phase 5, `builtin` 0/1, `position`, timestamps; `uq_presets_name`);
  built-ins seeded by the migration (Wedding, Portrait, Event, Newborn, Commercial, Blank) without any
  sales field; a built-in is **copy-on-edit** (editing it creates a studio copy; built-ins stay as
  shipped); "Save as preset" from a gallery's settings (Phase 5 M4 calls it).
- **T4.10 Client email text**: `site_settings` row `email_texts`: per client template (Phase 5's
  `gallery.ready` onwards) an optional subject, intro and sign-off with placeholders (`{client}`,
  `{gallery}`, `{studio}`), parsed and escaped like any parameter; `EmailContext` gains `senderName`
  (the mail settings' From name, else the studio name); Settings → Emails (Phase 3's page) gains a
  *Client emails* card with a preview through `renderEmail`.
- **T4.11 Time zone and locale**: the `studio` row gains `timeZone` (IANA, checked with
  `Intl.DateTimeFormat`) and `locale` (`en-GB`, `bg-BG`, …); `lib/dates.ts` takes them as arguments
  instead of constants; `AppProvider` hands them to `@repo/ui/date`; guard `no-host-locale-date`
  unchanged.

## Workstreams

### A. M1: theme and fonts (no UI dependency)

- **T4.1** (the placeholder's T4.6) `theme/gallery.mjs` (light, dark, lightbox), `contrast.mjs`, `galleryAccent.mjs`, the preset plugin, `exports`, contrast rows, the
  preset test; `/admin/design` section *Gallery themes* (light, dark, auto with each swatch).
- **T4.2** (the placeholder's T4.7) Font registry: `galleryFonts.ts`, `theme/galleryFonts.mjs`, the generated rules, the display
  tokens, `Display`; `/admin/design` section *Gallery typography* (every pairing, a Latin and a Cyrillic
  sample).

### B. M1: settings

- **T4.3** Branding: parser, reader, route, page, nav entry, preview panel.
- **T4.4** Galleries defaults: parser, reader, route, page, nav entry.
- **T4.5** Watermarks: `lib/images/watermark.ts` (+ tests), parser, reader, the two routes, the page,
  the sample photo, nav entry. The upload helper the page uses (`putToSignedUrl(file, upload, { onProgress, signal })`,
  PUT with the signed Content-Type) lives in `lib/images/upload.ts` for Phase 5 to reuse.

### C. M2 (after the first usable version)

- **T4.8** Logo · **T4.9** Presets · **T4.10** Client email text and `senderName` · **T4.11** Time
  zone and locale.

### D. Docs (each in its commit)

- `architecture.md` → Two kinds of settings (the branding, defaults and watermark rows); a *Gallery
  theme* paragraph.
- `recipes.md` → *A gallery font* (one `next/font` call + one pairing) and *A gallery colour* (one
  swatch entry; the contrast rows follow).
- AGENTS.md → Where to look (`theme/gallery.mjs`, `galleryFonts`, `lib/images/`); Client code (gallery
  roles reuse the studio role names; a gallery is themed by attributes, never by studio-only values).

## Tests

| Test | What |
| --- | --- |
| `theme/gallery.test.ts` | `light` and `dark` have exactly the flattened keys of `studio.colors`; every value is `#RRGGBB`; swatch ids unique |
| `theme/galleryAccent.test.ts` | table: swatch × theme → accent roles; `accent` ≥ 3.2 and `accent-ink` ≥ 4.5 against `ground` and `wash` in all 12 cases; mixing stops at the first passing step; a passing swatch is unchanged; `contrastText` picks the higher ratio; `galleryThemeRules()` yields light, dark, auto (with media), 6 × 3 accent rules and one rule per pairing |
| `colorContrast.test.ts` rows | gallery text pairs on `ground` and `wash` per theme (AA); accent 3:1 on both; `inverse` on `accent` AA — all through `galleryAccent` |
| preset test | Tailwind output contains `[data-gallery-theme="dark"]` with `--color-ground: 18 19 20` and `color-scheme: dark`, the auto media rule, an accent rule, a font rule |
| `galleryFonts.test.ts` | ids unique; every `display`/`text` names a registered family; `pairing('nope')` = the default; `scripts` agree with the subsets declared in `galleryFonts.ts` (read as source) |
| `parseBrandingInput.test.ts`, `parseGalleryDefaultsInput.test.ts`, `parseWatermarkInput.test.ts` | table-driven: each field's bounds, unknown enum values, display ≤ thumb refused, `protected` refused (D4.13), watermark key shape, text length and control/bidi characters |
| `settings/branding.test.ts` (and the other two) | reader on a test D1: no row → defaults; invalid row → defaults + one log line; valid row wins |
| route tests | watermark GET: `imageUrl` is the public URL when a domain is set, else a dev or presigned URL; 401; 403 cross-origin; 400 per invalid field; 200 → re-read via the reader equals the input; the audit row names fields only; watermark upload: type and size refused, key under `branding/watermarks/`, 429 at the 21st; watermark save: a key of another shape → 400, missing object → 400 `UPLOAD_MISSING`, wrong type or > 2 MB at `head()` → 400 `UPLOAD_INVALID` (the test platform's in-memory `blobs()`) |
| `lib/images/watermark.test.ts` | `watermarkBox` table: nine anchors × landscape/portrait, margin, size %, tiled count and spacing, a mark larger than the photo |
| component tests | Branding: choosing a swatch, theme or font updates the preview's attributes; a Cyrillic sample marks Editorial and Modern; Watermarks: the kind switch shows its fields, the upload states (mint → PUT → ready, failure message), Save disabled until the image is uploaded; nav: Branding, Galleries, Watermarks are links |

## Risks and edge cases

- **Contrast regressions** from a later theme edit are caught by the contrast rows (computed through
  `galleryAccent`, so a fallback change is tested too).
- **Font payload**: each pairing adds a few hundred bytes of `@font-face` CSS to pages that carry
  `GALLERY_FONT_CLASSES`; font files download only when used.
- **Cyrillic**: Cormorant Garamond covers it; Instrument Serif and Space Grotesk fall back to Georgia /
  the sans stack for Cyrillic glyphs (the picker warns, D4.8).
- **The first presigned upload of the app**: the dev routes (local) and presigned PUTs (production; needs
  Phase 1 Verification 5 with the real bucket and its CORS) are exercised here first. A PUT with another
  Content-Type fails the signature (presigned) or the token (dev).
- **Cross-origin watermark fetch** from Phase 5's worker: the public bucket's CORS must allow `GET` from
  the app origin (`apps/web/r2-cors.json` lists `GET`); verify on the custom domain.
- **Text watermark fonts** differ per OS (system stacks); the preview runs on the machine that uploads,
  so what the photographer sees is what is baked.
- **CPU**: small JSON writes, no hashing; the admin pages' own render cost is Phase 6's decision (index →
  To verify, the pages' CPU).

## Verification

1. `npm run verify`.
2. Local (`npm run dev`): save each section; a reload shows the saved values; an invalid row inserted
   with `npm run wrangler -- d1 execute DB --local …` is ignored with a log line. Upload a PNG watermark
   (dev routes), move it through the nine anchors and tiled; a text watermark in both inks.
3. `/admin/design`: gallery themes (light, dark, auto with the OS setting switched), six swatches, four
   pairings with Latin and Cyrillic samples, at 360 px and 1440 px; the three sections by keyboard only.
4. With the real bucket (once the owner has done deployment.md → Media and Phase 1 Verification 5): a
   watermark uploaded through a presigned PUT from `npm run preview`, then shown from the public media
   domain.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(ui): the gallery theme and accent swatches` | T4.1 | design page at 360/1440 |
| 2 | `feat(ui): gallery font pairings` | T4.2 | design page shows the Cyrillic samples |
| 3 | `feat(admin): Settings → Branding and Galleries` | T4.3, T4.4 | Verification 2 (those two) |
| 4 | `feat(admin): Settings → Watermarks` | T4.5 | Verification 2 (watermark) |
| 5 | `docs: Phase 4 M1 done` | docs | — |

Milestones: **M1** = commits 1–5 (Phase 5 can start; commits 1–2 can run in parallel with Phase 5's
first commits); **M2** (after the first usable version) = one commit each for T4.8–T4.11.

## Checklist

- [ ] T4.1 Gallery theme, accents, preset plugin, contrast rows
- [ ] T4.2 Font registry, display tokens, `Display`
- [ ] T4.3 Settings → Branding
- [ ] T4.4 Settings → Galleries (defaults)
- [ ] T4.5 Settings → Watermarks, `applyWatermark`, upload helper
- [ ] Verification 1–3 (4 once the bucket exists)
- [ ] M2: T4.8 logo · T4.9 presets · T4.10 client email text · T4.11 time zone and locale

## Open questions

For the owner:

1. **Cyrillic** (index question 5): will gallery titles or client names be in Cyrillic? Assumed yes, so
   the default pairing is Classic (D4.8). Should a Cyrillic-capable display serif replace Instrument
   Serif in Editorial?
2. **Accent**: six swatches only in M1 (D4.5), or a free colour too (with automatic fallbacks)?
3. **Watermark**: there is no mockup for Settings → Watermarks or → Galleries; this plan designs them
   from `SettingsCard`s: fine, or a mockup first? Image and text (D4.9), or image only? One watermark in M1 and several named ones with
   presets in M2: acceptable?
4. **Default sizes**: selection 1600 px / q75, sharing 2048 px / q82, thumbnail 800 px / q70: the right
   starting values?
5. **The M1 / M2 split** (D4.1): is a gallery header with the studio name in the display font (no logo)
   acceptable for the first usable version?

For the index (`plan_202611_mvp.md`, owned by the build session):

- Phase 4 row: "M1: gallery theme and fonts, Branding, Galleries defaults, Watermarks · M2 (after the
  first usable version): logo, presets, client email text, time zone"; status `draft`.
- Data model: Phase 4 M1 adds no table (rows `branding`, `gallery_defaults`, `watermark` in
  `site_settings`); `presets` moves to M2.
- Scope: B8 (email settings) is Phase 3's.
- Phase 5 M1–M3 start from the gallery defaults; the preset picker of p05 T5.2 waits for M2.
- Task numbers: the placeholder's T4.6 (theme) and T4.7 (fonts) are T4.1 and T4.2 here; the index's
  "T4.7" references should follow.
