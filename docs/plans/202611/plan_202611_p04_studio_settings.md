---
title: "Phase 4: Studio settings"
type: plan
status: ready
updated: 2026-11-17
related: [plan_202611_mvp.md, plan_202611_p02b_settings_db.md, plan_202611_p03_relay_email.md, plan_202611_p05_galleries_upload.md, plan_202611_p06_client_gallery.md, ../../design/HANDOFF.md, ../../recipes.md, ../../../AGENTS.md]
---

# Phase 4: Studio settings

## Goal

Phases 5 and 6 need a look and a watermark that exist as code: the gallery colour themes, the accent
swatches, the font pairings, the watermark Phase 5 bakes into display copies, and a CSP that lets the
browser upload to R2 and load images from the public media domain. The photographer sets the watermark
in Settings → Watermarks. Studio-wide defaults for new galleries (accent, theme, font, grid, purpose,
sizes) are read from built-in values in M1 and become editable screens in M2: the New gallery form
(Phase 5) already chooses all of them per gallery.

This phase is cut in two. **M1 is the minimum Phases 5 and 6 consume** for the first usable version
(upload a shoot → the client opens a branded gallery → favourites and submits). **M2 comes after the
first usable version**: Settings → Branding and → Galleries, the logo, presets, client-email text, time
zone.

**Done when (M1):**

- The **gallery theme** (`packages/ui/theme/gallery.mjs`) declares the studio's colour roles with the
  gallery values for light and dark, emitted as CSS variables on `[data-gallery-theme]`; an accent swatch
  becomes the accent roles with contrast-checked fallbacks (D4.5); every pair is pinned in
  `colorContrast.test.ts`.
- The **font registry** (`app/galleryFonts.ts` + `theme/galleryFonts.mjs`) holds the four pairings of
  the design; adding one is one `next/font` call plus one entry; `/admin/design` shows the gallery
  themes, swatches and pairings.
- `RadioCards` and `SwatchPicker` primitives exist in `packages/ui` (Phase 5's New gallery uses them).
- The `branding` and `gallery_defaults` parsers and readers return the built-in defaults (no screen, no
  write route yet), so Phase 5 reads them through one function that M2 later backs with a saved row.
- **Settings → Watermarks** saves one watermark (an image — PNG or WebP with transparency, uploaded to R2
  through a presigned PUT — or a text, or none), its position, size, opacity and margin, previewed live on
  a sample photo by **the same browser function Phase 5's pipeline calls** (`applyWatermark`).
- **The CSP carries the media origins** (D4.15): presigned PUTs to the S3 endpoint and images from the
  public media domain work in `npm run preview` and production, in a studio profile (Next pages) and a
  gallery profile (Phase 6's `worker.ts` responses).
- `npm run ts-check` and `npm run test` green; `/admin/design` and Settings → Watermarks checked at 360 px
  and 1440 px.

**Done when (M2, after the first usable version):** Settings → Branding (default accent, theme, font,
grid; the logo light and dark) and Settings → Galleries (new-gallery defaults) save rows that the M1
readers then return; the `presets` table with built-in presets and "save as preset"; the editable text of
the client emails (Phase 5's gallery-ready email onwards) with the sender's name in the sign-off; the
studio time zone and locale replacing the constants in `lib/dates.ts`.

- **Depends on:** Phases 2 (settings shell), 2b (the settings store pattern), 3 (Settings → Emails, the
  email layout). **Unblocks:** Phase 5 (watermark, defaults readers, theme/accent/font ids, `RadioCards`,
  the media CSP), Phase 6 (the gallery theme, fonts and the gallery CSP profile).
- **Mockups:** `Settings.dc.html` (Branding: logo, accent, typography, theme, grid — M2),
  `NewGallery.dc.html` (the fields whose defaults live here, the watermark toggle), `ClientGallery.dc.html`
  (the gallery colours). **There is no Watermarks or Galleries-defaults mockup** ("Watermarks" is only a
  label in the Settings sidebar): this plan designs both screens from `SettingsCard`s; the owner reviews
  Watermarks at Verification 2 (and Galleries in M2).
- **Scope (feature IDs):** B1–B7 (B8, email settings, moved to Phase 3), C2 (presets, M2). M1 covers
  the watermark, the defaults readers, the gallery theme and the fonts; M2 the logo, the Branding and
  Galleries screens, presets, client-email text and the time zone.

## Starting point (verified 2026-11-16 against master `2b6972a`: Phases 0–2b done, Phase 3 M1–M3 done)

- **Settings shell** (Phase 2): `/admin/settings/<section>`, sections in
  `components/admin/settings/nav.ts` (`SETTINGS_SECTIONS`): Studio, Security, Emails (live since Phase 3
  M3), then Branding and Watermarks with `soonPhase: 4`. **This phase owns no email settings screen.** A
  section is a stack of `SettingsCard`s (`components/admin/settings/SettingsCard.tsx`); `nav.test.ts`
  fails when a page and its entry disagree (it reads pages under `app/admin/(panel)`).
- **Settings store** (Phase 2b): `site_settings` (`key` `GLOB '[a-z]*'` ≤ 64, `value` JSON) with
  `getSiteSetting` / `upsertSiteSettingStatement` (`lib/db/queries/site_settings`). The model is the
  `studio` row: a pure parser (`lib/settings/parseStudioInput.ts`) shared by route, form and reader;
  `readStudio()` never throws (logs and falls back); `studio.cached.ts` is the `perRender` form; the
  reference route `api/admin/settings/studio` exports `PATCH`, upserts and audits in one batch
  (docs/recipes.md → A studio setting). The settings of this phase have **no env default**, so
  `Config.bootstrap` and guard `settings-through-store` are untouched.
- **Theme mechanism** (Phase 0, D0.11): `packages/ui/theme/studio.mjs` holds the colour roles
  (`ground`, `surface`, `wash`, `ink.{DEFAULT,2,muted,faint,hover}`, `line.{DEFAULT,control,input}`,
  `accent.{DEFAULT,ink,tint}`, `focus`, `inverse`, `alert`, …) and `fontFamily` (`sans`, `mono` only);
  `theme/cssVars.mjs` has `flattenColors`, `hexToChannels` (throws on anything but `#RRGGBB`),
  `themeCssVars(colors)` → `{ '--color-<role>': 'r g b' }` and `tailwindColors`; its header already says
  the gallery theme is "the same variables with other values on its own scope". `theme/tokens.mjs` has
  `tokenHex(token, colors = studio)` (the relay imports it for emails). `packages/ui/colorContrast.ts`
  keeps a private `luminance` and exports `contrastRatio`; `colorContrast.test.ts` pins text/surface
  pairs. `packages/ui/package.json` exports `./theme/*` → `./theme/*.mjs` (new theme files need no
  entry). **Nothing gallery-specific exists yet**: no `gallery.mjs`, no `galleryAccentVars` (named in the
  Phase 6 placeholder; it was never built).
- **Fonts**: `apps/web/src/app/fonts.ts` loads Inter (`--font-text`, `subsets: ['latin']`, variable) and
  JetBrains Mono (`--font-mono`, `preload: false`); the root layout puts both classes on `<html>`. Other
  scripts render through Inter's `unicode-range` faces (Cyrillic included). `next/font` data: Instrument
  Serif 400 only, latin/latin-ext; Cormorant Garamond 300–700 with cyrillic; Space Grotesk variable,
  latin/latin-ext/vietnamese (no Cyrillic).
- **Root layout** `app/layout.tsx` is `force-dynamic` and reads `getAppConfig()` per request. Phase 6
  makes it static and moves the config into a new `app/admin/layout.tsx`; this phase does not touch it.
- **Media** (Phase 1): `blobUrls(config).uploadUrl(key, { contentType, size, expiresInSeconds ≤ 900 })`
  mints a presigned PUT (S3 mode) or a signed dev route URL; `readUrl` is a presigned GET (S3) or the dev
  read route (dev); `publicUrl(key)` is the public media domain or null; keys must pass `isBlobKey`
  (prefixes `galleries`, `branding`, `dev`); `MEDIA_TYPES` = JPEG, PNG, WebP;
  `getPlatform().blobs().head(key)` returns `size` and `contentType`. **No route mints an upload yet**:
  the watermark image is the first (Phase 5 reuses the pattern for photos). AGENTS.md → Media: presigned
  GETs are for downloads only.
- **CSP** (`lib/security/headers.mjs`, applied by `next.config.mjs` at build): `img-src 'self' data: blob:`,
  `connect-src 'self' https://cloudflareinsights.com`. `MEDIA_PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT` are
  plain `vars` in `apps/web/wrangler.jsonc` (both empty today), so build-time code can read them; guard
  `wrangler-config` already parses that file as JSONC with `typescript`'s `parseConfigFileTextToJson`.
- **Email** (Phase 3 as built): `EmailContext = { studioName, siteUrl, link(path) }`
  (`lib/email/context.ts`); `renderEmail` is pure; `EMAIL_TEMPLATES` = `[testTemplate, ...SECURITY_TEMPLATES]`
  (`templates/registry.ts`, no template `version`); templates render through `renderLayout(ctx, { heading,
  paragraphs, action })`. The mail settings (`site_settings` row `mail`) already hold the **From name and
  reply-to** (D3.17), so the old T4.4 loses "test email" and "sender name and reply-to" as settings; what
  is left is the editable text of client emails and the From name in `EmailContext` for sign-offs (M2).
- **Dates**: `lib/dates.ts` has `APP_LOCALE = 'en-GB'`, `APP_TIME_ZONE = 'UTC'` as constants (M2).
- **Primitives available**: `Segmented`, `Toggle`, `Button`, the `@repo/ui/input` fields, `Dialog`. No
  radio-card or swatch primitive. The selectable `Chip`, `Tabs` and the `scrim` token arrive in Phase 5
  (T5.9).
- **Guard `no-raw-colors`** scans `apps/web/src` and `packages/ui`: no colour literal outside
  `packages/ui/theme/*`.
- **Migrations**: `0001`–`0005` are applied to the production D1 (smoke deploy 2026-11-16) and are
  forward-only; Phase 3 M3 added none. **M1 needs no migration** (rows in `site_settings`); M2's `presets`
  table takes the next free number when it lands.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D4.1 | **M1 = what Phases 5–6 consume; M2 after the first usable version.** M1: gallery theme and accents, font registry, `RadioCards`/`SwatchPicker`, the `branding` and `gallery_defaults` readers (built-in defaults), Settings → Watermarks, the media CSP. M2: Settings → Branding and → Galleries (screens and write routes), logo, presets, client-email text, time zone/locale. | The owner wants a usable version soon. The New gallery form (Phase 5) chooses accent, theme, font, grid, purpose and sizes per gallery, so studio-wide default screens are a convenience; the watermark and the CSP are not. A gallery without a logo shows the studio name in the display font (the mockup's header is text). |
| D4.2 | **M1: three `site_settings` rows, no table** (M2 adds the `presets` table and the `email_texts` row): `branding`, `gallery_defaults`, `watermark`. Each has a pure parser shared by route, form and reader; an invalid stored row is ignored and logged, and the built-in default used (`readStudio`'s rule). No env defaults. In M1 only `watermark` has a write route. | Phase 2b's store; a field added later (Phases 7, 9, 10 add proofing, download and expiry defaults to `gallery_defaults`) needs no migration; Phase 5 calls the same readers before and after M2. |
| D4.3 | **New galleries copy the defaults; nothing reads them afterwards.** Phase 5 snapshots `gallery_defaults`, the branding choices and the watermark (**the whole parsed `Watermark` object**: an image's key, dimensions and type, or a text's text, font and ink, plus the placement; or `null`) into the gallery's own settings at creation (`galleries.settings.processing.watermark`, and each photo's `processing.watermark`). Changing a default (or removing the watermark) never changes an existing gallery. | The watermark and sizes are baked into files at upload (index → Watermark); a gallery must look tomorrow as it did when it was shared. |
| D4.4 | **The gallery theme reuses the studio's role names.** `theme/gallery.mjs` exports `light` and `dark` maps with exactly the keys of `studio.colors` (the test iterates **every** role map `gallery.mjs` exports, so Phase 6's `lightbox` map is checked too), values from HANDOFF → Client gallery: `ground` = bg, `surface` = bg (cards sit flat in a gallery), `wash` = the gallery surface, `ink` = fg, `ink-2` = `ink-muted` = muted (the design has one secondary text colour: intended), `line` = border. Roles a gallery does not use (status pills, `danger`, `alert`) keep the studio values; `ink-faint`, `ink-hover`, `line-control`, `line-input` are derived and listed in `gallery.mjs` with a comment each. The preset emits them with `themeCssVars` on `[data-gallery-theme="light"]`, `[data-gallery-theme="dark"]` and `[data-gallery-theme="auto"]` (light, then dark inside `@media (prefers-color-scheme: dark)`), each with `color-scheme`; gallery rules come **after** the `:root` rule (equal specificity) and the auto-dark media rule after the light one. `galleryThemeRules()` emits **one rule set per exported role map** (a map named `x` → `[data-gallery-theme="x"]`), so the lightbox palette — Phase 6 T6.7's third map in this file, same role names — gets its rules without editing the function. | Every `@repo/ui` primitive (Button, inputs, Dialog) works inside a gallery unchanged; a gallery is "another set of values for the same roles" (cssVars.mjs). |
| D4.5 | **Accents are twelve curated swatches**, in picker order Pine `#1F6F5C`, Teal `#1E6A78`, Olive `#5B6630`, Ochre `#94650F`, Clay `#A4532E`, Rose `#B0476A`, Wine `#7A2E3A`, Plum `#6B3A6E`, Indigo `#4B3F8C`, Navy `#2747A0`, Slate `#4A5866`, Ink `#16171A` (owner, 2026-11-17: more than six), stored by id. A swatch is added by one `SWATCHES` entry; the tests iterate the array. `galleryAccent(swatchId, theme)` (pure) returns the accent roles. **Mixing**: in sRGB channel space, `mix(c, target, t) = round(c + (target − c) · t)` per channel, t = 0.05, 0.10, … 1.00, target white on dark, black on light; the first t that passes wins. **`accent`** (fills, rings, the heart: UI contrast) = the swatch if it reaches **3.2:1** against `ground` **and** `wash`, else mixed until it does. **`accent-ink`** (any accent-coloured text, links) = mixed until **4.5:1** against both. `focus` = `accent-ink`. `accent-tint` = the swatch at 12 % over `ground` (`mix(ground, swatch, 0.12)`). **`inverse`** = `contrastText(accent)`: white or `#16171A`, whichever is higher; if neither reaches 4.5, `#FFFFFF` or `#000000`, whichever is higher; if still below, `accent` keeps mixing (same direction) until one does. **Gallery text never uses `accent`, only `accent-ink`.** No free hex in M1. | Pre-checked swatches cannot produce an unreadable gallery. Computed (review 2026-11-16) against light bg / light surface / dark bg / dark surface: Pine 5.77/5.24/3.09/2.74, Ink 17.2/15.6/1.04/1.08, Clay 5.22/4.74/3.41/3.04, Navy 8.06/7.32/2.21/1.96, Plum 8.19/7.44/2.18/1.93, Olive 5.94/5.39/3.00/2.67, Teal 5.94/5.39/3.00/2.67, Ochre 4.87/4.43/3.66/3.25, Rose 5.09/4.62/3.50/3.11, Wine 8.83/8.02/2.02/1.79, Indigo 8.42/7.65/2.12/1.88, Slate 6.99/6.35/2.55/2.27 (review 2026-11-17): on dark every `accent` except Ochre's is lightened (Clay is 3.04 and Rose 3.11 against the dark wash, under 3.2) and every `accent-ink` is; on light every swatch passes as is except Ochre's `accent-ink` (4.43 on the light wash), which is darkened one step — the one case where a swatch is mixed towards black; Clay and Olive would pass a bare 3:1 by hundredths, hence 3.2. After mixing, the dark accents stay distinct (e.g. Wine `#9B626B`, Rose `#B45071`, Plum `#89618B`; Pine `#357D6C`, Teal `#347986`). Ink text on an accent near luminance 0.2 reaches only ~4.24, hence the black/white step. |
| D4.6 | **The accent is applied by attribute, not inline style**: the preset emits one rule per swatch × theme (`[data-gallery-theme="dark"][data-gallery-accent="pine"] { --color-accent: …; … }`, auto in its media query): 36 small rules. **The gallery root element carries `GALLERY_FONT_CLASSES` and all three attributes** (`data-gallery-theme`, `data-gallery-accent`, `data-gallery-font`): in Phase 6 that is the `<div data-gallery-root>` rendered by `app/gallery-shell/layout.tsx` (`next/font` variables exist only where their class is), with `data-gallery-theme` repeated on `<html>` so the page background and `color-scheme` match. | No flash of the wrong colour, no JavaScript to theme the page, works in the static shell Phase 6 serves. |
| D4.7 | **Fonts: curated pairings in a registry** (p00 D0.11, user 2026-11-12). `app/galleryFonts.ts` makes one `next/font/google` call per family (`preload: false`, `display: 'swap'`, `--font-g-<id>`, subsets `latin` + `cyrillic` where the family has it); `theme/galleryFonts.mjs` lists pairings `{ id, label, display, text, scripts }` and the default id. Pairings: **Editorial** (Instrument Serif + Inter), **Classic** (Cormorant Garamond + Inter), **Modern** (Space Grotesk + Inter), **Quiet** (Inter only). An unknown id reads as the default. No free mixing. | Typography stays good; the picker, the design page and the gallery read one list; a removed pairing never breaks a gallery. |
| D4.8 | **Default pairing: Classic** (Cormorant Garamond has Cyrillic), unless the owner says titles are never Cyrillic (index question 5). Every picker marks pairings without Cyrillic when the sample title contains Cyrillic. | Instrument Serif and Space Grotesk have no Cyrillic: a Bulgarian couple's names would fall back to Georgia in the title. |
| D4.9 | **One watermark**, `kind: 'image' \| 'text' \| 'none'` (default `none`; saving `none` removes it). Image: PNG or WebP ≤ 2 MB, ≤ 4000 px, uploaded to `branding/watermarks/<uuid>.<ext>` (server-generated key) through a presigned PUT, registered by `head()`; its stored width and height are hints, re-read from the decoded bitmap, which is pre-scaled once per upload session to the largest size it can be drawn at (display long edge × size), so no worker holds a 64 MB bitmap. Text: ≤ 60 characters in a fixed font list (`Arial, Helvetica, sans-serif` or `Georgia, 'Times New Roman', serif`, never a generic keyword alone, so the main-thread preview and the worker resolve the same face; no web font inside a Web Worker), ink light or dark from `theme/watermark.mjs` (`WATERMARK_INKS`). Placement: one of nine anchors or `tiled`; **size** = the mark's width as 5–60 % of the photo's long edge (height by the mark's aspect; text measured with `measureText` at a 100 px reference and scaled); **opacity** 10–100 %; **margin** 0–10 % of the photo's short edge, from the anchored edges. | Photographers have a signature PNG; a text watermark covers the rest without font loading in workers. Several named watermarks ("Northlight signature" in the mockup) can come with presets (M2). |
| D4.10 | **`applyWatermark` is shared browser code** in `apps/web/src/lib/images/watermark.ts`: pure geometry (`watermarkBox(photo, mark, placement)` → `{ x, y, w, h }[]`, `mark` = the bitmap's size or the text's measured size at the reference; table-tested) plus the canvas drawing (works on `OffscreenCanvas` and `HTMLCanvasElement`). Settings → Watermarks previews with it on a sample photo generated on a canvas; Phase 5's worker calls the same function. | What the photographer previews is exactly what gets baked. |
| D4.11 | **Watermark images are never deleted in M1.** A gallery snapshots the watermark (the whole object, its image key included: D4.3); replacing or removing the studio's watermark leaves the old object. Orphans are a few hundred KB. | Deleting a key a gallery still references would break reprocessing (Phase 5 M5) for no real saving. |
| D4.12 | **Saving these settings needs no code** (they cannot redirect links or lock anyone out) and is audited with the field names, not the values (recipe → A studio setting). Writes are `PATCH`, like the reference route. | Phase 2b's rule: a code only for what can redirect or lock out. |
| D4.13 | **The image-delivery default offers `protected` only once Phase 6 M2 builds it**: until then the parser refuses it and any screen shows it as *Soon*. | No setting may promise behaviour that does not exist. |
| D4.14 | **Reading the watermark image back**: `watermarkImageUrl(key, config)` (`lib/settings/watermark.ts`, server-only) = `publicUrl(key)` in production, the dev read route URL (`readUrl` in `dev` mode) in development, else null. **No presigned GET** (AGENTS.md → Media). `GET /api/admin/settings/watermark` returns the settings and `imageUrl`; Phase 5's `GET /api/admin/galleries/[id]` calls the same helper for the gallery's **snapshot** key, so a gallery keeps its own watermark after the studio's changes. Without `MEDIA_PUBLIC_BASE_URL` in production an image watermark cannot be chosen (the card says "needs the public media domain"; a text watermark works), consistent with Phase 5 D5.15. | Minting is the gate (AGENTS.md); without it neither the preview nor the pipeline can load the image. |
| D4.15 | **The CSP learns the media origins here.** `next.config.mjs` reads `MEDIA_PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT` from `apps/web/wrangler.jsonc` `vars` at build time (JSONC parsed with `typescript`'s `parseConfigFileTextToJson`, as guard `wrangler-config` does). `headers.mjs` takes a profile: **`securityHeaders({ dev, profile: 'studio' \| 'gallery', media })`** and `contentSecurityPolicy({ dev, profile, media })`, `media = { publicBaseUrl, s3Endpoint }`. **studio** (applied by `next.config.mjs`): today's policy plus the media domain in `img-src` and `connect-src` and the S3 endpoint in `connect-src`. **gallery** (Phase 6's `worker.ts` responses; D6.13 cites it by this name): the studio policy **minus** the Cloudflare beacon and the S3 endpoint, **keeping** Turnstile in `script-src` and `frame-src` (the password gate) and `'unsafe-inline'` scripts (Next's inlined RSC payload; a static shell cannot carry a nonce); `img-src` gains the media domain. `headers.test.ts` gains rows for both; guard `wrangler-config` checks both vars are origins (scheme + host, no path) or empty. Phase 5 adds no origin (both buckets share the S3 endpoint). **The values are baked at `next build`**: changing either var needs a rebuild and deploy (deployment.md → Media, Phase 5's owner checklist). | The watermark is the first presigned PUT and the first public-domain image the browser loads: without this, production blocks both (development works only because the dev routes are same-origin). Client pages never need the upload endpoint or the beacon. |

## Design

### Settings rows (pure parsers in `apps/web/src/lib/settings/`)

```ts
// parseBrandingInput.ts → site_settings 'branding' (write route: M2)
type Branding = {
  accent: AccentId;             // default 'pine'
  theme: 'light' | 'dark' | 'auto';                // default 'auto'
  font: string;                 // a pairing id; unknown → DEFAULT_PAIRING ('classic', D4.8)
  grid: 'masonry' | 'justified' | 'square';        // default 'masonry'
  // M2: logo: { light: LogoRef | null; dark: LogoRef | null }
};

// parseGalleryDefaultsInput.ts → site_settings 'gallery_defaults' (write route: M2)
type GalleryDefaults = {
  purpose: 'selection' | 'sharing';                // default 'selection'
  display: { selection: Size; sharing: Size };     // defaults { 1600, 75 } and { 2048, 82 }
  thumb: Size;                                     // default { 800, 70 }
  watermarkSelection: boolean;                     // default true (reads false while the watermark is 'none')
  access: 'link' | 'password';                     // default 'link'
  delivery: 'public';                              // 'protected' accepted from Phase 6 M2 (D4.13)
  // Phases 7, 9, 10 add proofing, downloads and expiry defaults here
};
type Size = { longEdge: number; quality: number }; // longEdge 400–4096 (display > thumb), quality 40–95

// parseWatermarkInput.ts → site_settings 'watermark'
type Watermark =
  | { kind: 'none' }
  | ({ kind: 'image'; key: string; width: number; height: number; contentType: 'image/png' | 'image/webp' } & Placement)
  | ({ kind: 'text'; text: string; font: 'sans' | 'serif'; ink: 'light' | 'dark' } & Placement);
type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
type Placement = { position: Anchor | 'tiled'; size: number /* 5–60 */; opacity: number /* 10–100 */; margin: number /* 0–10 */ };
```

- `AccentId` is a JSDoc `@typedef` derived from the frozen `SWATCHES` array in `gallery.mjs`
  (`/** @typedef {typeof SWATCHES[number]['id']} AccentId */`), so TypeScript sees the twelve literals.
- `parse*Input(value)` → `{ ok: true, value } | { ok: false, message, field }` (messages in the
  product's language), shared by the form (inline errors) and the route.
- Readers `readBranding()`, `readGalleryDefaults()`, `readWatermark()` (`lib/settings/<thing>.ts`): the
  row, else the default; never throw; log `<thing>_settings_unavailable` / `_invalid`. React-free (the
  relay may read branding for email colours in M2). `*.cached.ts` `perRender` forms for server
  components. In M1 no route writes `branding` or `gallery_defaults`, so their readers return the
  built-in defaults unless a row was inserted by hand.
- A text watermark's text is stripped of control and bidi characters (it is drawn into every photo).

### Routes (M1)

| Route | Body | Does |
| --- | --- | --- |
| `GET /api/admin/settings/watermark` | — | `{ data: { watermark, imageUrl } }` (D4.14; `imageUrl` null for text/none, or without a public domain in production); `Cache-Control: no-store` |
| `POST /api/admin/settings/watermark/upload` | `{ contentType, size }` | type PNG/WebP, size ≤ 2 MB; refuses 409 `MEDIA_DOMAIN_REQUIRED` in production without `MEDIA_PUBLIC_BASE_URL` (D4.14); key `branding/watermarks/<uuid>.<ext>`; `blobUrls(config).uploadUrl(key, { contentType, size, expiresInSeconds: 600 })` → `{ data: { key, upload } }`; rate limit 20 an hour; `MEDIA_NOT_CONFIGURED` → 503 |
| `PATCH /api/admin/settings/watermark` | `Watermark` | parse; for `image`: the key must match `branding/watermarks/<uuid>.(png\|webp)` and `blobs().head(key)` must exist with that type and ≤ 2 MB (else 400 `UPLOAD_MISSING` / `UPLOAD_INVALID`); `none` removes it; `batch([upsert, audit('update', 'watermark', { fields })])` |

All follow the house pattern (`requireAdmin` first, `withErrorHandling`, `invalidParamsError`). M2 adds
`PATCH /api/admin/settings/branding` and `PATCH /api/admin/settings/gallery-defaults` (parse → upsert +
audit in one batch → `{ data }`).

### Screens

- **Settings → Watermarks** (`/admin/settings/watermarks`, M1): kind (`Segmented` None / Image / Text);
  image: a file picker (PNG/WebP), uploaded on choice (mint → PUT; saved with **Save**), disabled with the
  "needs the public media domain" line when D4.14 applies; text: the text, font (`RadioCards` Sans /
  Serif), ink (Light / Dark); placement: a 3 × 3 anchor grid plus *Tiled*, size, opacity and margin
  sliders; a **live preview** canvas on a sample photo **generated at runtime** (a neutral gradient with
  a few shapes, 1600 × 1067 and 1067 × 1600, switchable; no binary asset) drawn by `applyWatermark` and
  redrawn on each change (debounced 100 ms). No mockup exists: built from `SettingsCard`s.
- **Settings → Branding** (`/admin/settings/branding`, M2): cards *Accent* (`SwatchPicker`, a note where
  a swatch is lightened on dark, D4.5), *Theme* (`Segmented` Light / Dark / Auto), *Gallery typography*
  (`RadioCards`: the pairing's label, a sample title in its display font and a body line in its text
  font; the sample title is editable, so the photographer can type a Cyrillic name), *Grid style*
  (`RadioCards` with a small diagram), *Logo* (T4.8). One **Save**. A **preview panel** shows a miniature
  gallery header and grid in light and dark side by side, using the real attributes (D4.6).
- **Settings → Galleries** (`/admin/settings/galleries`, M2): *Purpose* (`RadioCards` with Phase 5's
  copy: selection = smaller watermarked previews, no full-size downloads; sharing = final photos),
  *Generated sizes* (per purpose: long edge and quality; the thumbnail; a line "about N KB a photo" from a
  fixed table), *Watermark* (Toggle "Watermark selection galleries", disabled with a link to Watermarks
  while it is `none`), *Access* (Segmented Link / Password), *Image delivery* (Public; Protected *Soon*).
- `SETTINGS_SECTIONS`: in M1, Watermarks drops `soonPhase` (Studio, Security, Emails, Branding *Soon*,
  Watermarks); M2 adds Galleries after Branding and Branding drops `soonPhase` in the same commit as its
  page (`nav.test.ts`). Until then Branding keeps `soonPhase: 4` (the registry holds a phase number, not a
  milestone).

### Primitives (`packages/ui`)

- `radioCards.tsx` — `RadioCards<T>({ name, value, options: { value, label, description?, preview? }[], onChange })`:
  native `<input type="radio">` inside labels (arrow-key movement by the browser), a 44 px minimum
  target on coarse pointers, the selected card ringed with `ring-focus`, `aria-describedby` for the
  description. Used by Watermarks (font), Phase 5's New gallery (purpose, access, look) and M2's screens.
- `swatchPicker.tsx` — `SwatchPicker({ value, swatches, onChange })`: a radio group of colour circles
  (the colour from `--color-*` variables set by `data-gallery-accent` on each, never an inline literal),
  44 px targets, the label visible as text under each; it wraps onto rows (twelve swatches: about three
  rows at 360 px, two from `sm`) and arrow keys move in reading order.
- Both on `/admin/design` with keyboard checks; `primitives.test.tsx` rows.

### The gallery theme (`packages/ui/theme/`)

```
gallery.mjs         light, dark: role maps (the keys of studio.colors, D4.4); SWATCHES: { id, label, hex }[] (frozen)
contrast.mjs        relativeLuminance, contrastRatio (moved out of colorContrast.ts, which imports them)
galleryAccent.mjs   mix, contrastText, galleryAccent(id, theme) → accent roles (D4.5),
                    galleryThemeRules() → [{ selector, media?, vars }] (pure; one rule set per exported role
                    map of gallery.mjs, plus auto, accents and pairings; the preset and tests read it)
watermark.mjs       WATERMARK_INKS = { light: { fill, shadow }, dark: { fill, shadow } } (guard no-raw-colors)
galleryFonts.mjs    PAIRINGS, DEFAULT_PAIRING, pairing(id) (unknown → the default)
tailwind-preset.mjs a plugin: addBase(galleryThemeRules()) — themes, accents, font pairings, color-scheme
```

- `colorContrast.test.ts` gains rows: per theme, `ink`/`ink-2`/`ink-muted` on `ground` and `wash` (AA
  4.5); per swatch × theme, `accent` against `ground` and `wash` (3:1, UI), `accent-ink` against both (AA)
  and `inverse` on `accent` (AA) — computed through `galleryAccent`, so the fallbacks are what is tested.
- No `exports` change: `./theme/*` → `./theme/*.mjs` already covers the new files.
- A preset test renders a fixture through Tailwind and asserts the dark rule, an auto media rule (after
  the light one), an accent rule and a font rule exist with channel values, and that gallery rules come
  after `:root`.

### The font registry

- `apps/web/src/app/galleryFonts.ts`: `Instrument_Serif({ weight: '400', subsets: ['latin'], preload: false, display: 'swap', variable: '--font-g-instrument' })`,
  `Cormorant_Garamond({ weight: '500', subsets: ['latin', 'cyrillic'], …, variable: '--font-g-cormorant' })`,
  `Space_Grotesk({ subsets: ['latin'], …, variable: '--font-g-space' })`; Inter is the studio's
  `--font-text`. Exports `GALLERY_FONT_CLASSES` (every `variable` class).
- The preset plugin emits, from `PAIRINGS`, `[data-gallery-font="<id>"] { --font-display: var(--font-g-…), Georgia, serif }`.
  The gallery root element carries `GALLERY_FONT_CLASSES` **and** `data-gallery-font` on the same element
  (D4.6: the `--font-g-*` variables exist only where their class is, so the attribute on another element
  would resolve to nothing); a browser downloads a face only when text uses it, so a client loads only
  the chosen pairing.
- `studio.fontFamily` gains `display: ['var(--font-display)', 'Georgia', 'serif']`; `globals.css`
  declares `--font-display: Georgia, serif` on `:root`, so `font-display` works outside a gallery (the
  design page, pickers).
- `display-cover` (clamp(56px, 9vw, 112px)), `display-lg`, `display-md` and `eyebrow-lg` join
  `studio.mjs`'s type scale (tailwind-merge learns them from there); a `Display` component in
  `typography.tsx` (never bold).
- Admin pages that show samples (pickers, `/admin/design`) put `GALLERY_FONT_CLASSES` on their wrapper
  only.

### The watermark function (`apps/web/src/lib/images/watermark.ts`)

```ts
type WatermarkAssets = { bitmap: ImageBitmap | null };      // null for text
function watermarkBox(photo: { w: number; h: number }, mark: { w: number; h: number }, placement: Placement): { x: number; y: number; w: number; h: number }[];
function applyWatermark(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, photo: { w: number; h: number }, watermark: Exclude<Watermark, { kind: 'none' }>, assets: WatermarkAssets): void;
function loadWatermarkAssets(watermark: Watermark, url: string | null): Promise<WatermarkAssets>;
```

- **Geometry** (pure): `L` = long edge, `S` = short edge. Mark width `w = round(L · size / 100)`, height
  `h = round(w · mark.h / mark.w)`; if `w > photo.w` or `h > photo.h`, scale both down to fit. Margin
  `m = round(S · margin / 100)`. Anchors: x = `m` (left), `(photo.w − w) / 2` (centre), `photo.w − w − m`
  (right); y the same with heights; all rounded. **Tiled**: a grid of marks of size `w × h`, step
  `sx = 2w` horizontally and `sy = 2.5h` vertically, every other row offset by `w`, starting at
  `(−w, −h)` so the edges are covered, no rotation, margin ignored, at most 200 boxes (beyond that the
  mark is scaled up until the count fits).
- **Drawing**: `globalAlpha = opacity / 100`; image: `drawImage(bitmap, x, y, w, h)`; text: `font =
  ${fontPx}px <list>` with `fontPx` scaled from the 100 px measurement so the text width equals `w`, fill
  `WATERMARK_INKS[ink].fill`, shadow colour `WATERMARK_INKS[ink].shadow`, shadow offset `max(1,
  round(fontPx / 24))` px, `textBaseline = 'top'`. Only the 2D context, so it runs in a Web Worker on
  `OffscreenCanvas`.
- `loadWatermarkAssets`: fetches the image (CORS from the public media domain, or the dev read route) and
  `createImageBitmap`s it once per upload session, pre-scaled per D4.9.

### M2 (after the first usable version)

- **T4.4 Branding and Galleries screens**: the two write routes, the pages above, the nav entries.
- **T4.8 Logo**: `branding.logo.{light,dark}` through the same mint/`head()` flow under
  `branding/logos/`; shown in the gallery header (Phase 6) and the email layout (an `<img>` from the
  public domain, the studio name as `alt`).
- **T4.9 Presets**: `migrations/NNNN_presets.sql` (`presets`: id, name ≤ 60, `settings` JSON = the
  gallery settings shape of Phase 5, `builtin` 0/1, `position`, timestamps; `uq_presets_name`);
  built-ins seeded by the migration (Wedding, Portrait, Event, Newborn, Commercial, Blank) without any
  sales field; a built-in is **copy-on-edit** (editing it creates a studio copy; built-ins stay as
  shipped); "Save as preset" from a gallery's settings (Phase 5 T5.10 calls it).
- **T4.10 Client email text**: `site_settings` row `email_texts`: per client template (Phase 5's
  `gallery.ready` onwards) an optional subject, intro and sign-off with placeholders (`{client}`,
  `{gallery}`, `{studio}`), parsed and escaped like any parameter; `EmailContext` gains `senderName`
  (the mail settings' From name, else the studio name); Settings → Emails (Phase 3's page) gains a
  *Client emails* card with a preview through `renderEmail`.
- **T4.11 Time zone and locale**: the `studio` row gains `timeZone` (IANA, checked with
  `Intl.DateTimeFormat`) and `locale` (`en-GB`, `bg-BG`, …); `lib/dates.ts` takes them as arguments
  instead of constants; `AppProvider` hands them to `@repo/ui/date`, and Phase 6's `GalleryView.studio`
  carries them to the gallery (which has no `AppProvider`; `en-GB`/`UTC` until then); guard
  `no-host-locale-date` unchanged.

## Workstreams

### A. M1: theme and fonts (no UI dependency)

- **T4.1** (the placeholder's T4.6) `theme/gallery.mjs` (light, dark), `contrast.mjs` (and
  `colorContrast.ts` importing it), `galleryAccent.mjs`, the preset plugin, contrast rows, the preset
  test; `/admin/design` section *Gallery themes* (light, dark, auto with each swatch).
- **T4.2** (the placeholder's T4.7) Font registry: `galleryFonts.ts`, `theme/galleryFonts.mjs`, the
  generated rules, `fontFamily.display` and the `:root` fallback, the display tokens, `Display`;
  `/admin/design` section *Gallery typography* (every pairing, a Latin and a Cyrillic sample).

### B. M1: settings and primitives

- **T4.3** `RadioCards`, `SwatchPicker` (+ design page, tests); the `branding` and `gallery_defaults`
  parsers and readers (built-in defaults, `*.cached.ts`), with their tests.
- **T4.5** Watermarks: `theme/watermark.mjs`, `lib/images/watermark.ts` (+ tests), the watermark parser
  and reader, `watermarkImageUrl`, the three routes, the page, the generated sample, the nav entry;
  **the CSP media origins (D4.15)**: `headers.mjs` profiles, `next.config.mjs` reading the vars,
  `headers.test.ts` rows, the `wrangler-config` origin check. The upload helper the page uses
  (`putToSignedUrl(file, upload, { onProgress, signal })`, a PUT with the signed Content-Type through
  `XMLHttpRequest` for progress) lives in `lib/images/upload.ts` for Phase 5 to reuse.

### C. M2 (after the first usable version)

- **T4.4** Branding and Galleries screens · **T4.8** Logo · **T4.9** Presets · **T4.10** Client email
  text and `senderName` · **T4.11** Time zone and locale.

### D. Docs (each in its commit)

- Commit 1: AGENTS.md → Client code (gallery roles reuse the studio role names; a gallery is themed by
  `data-gallery-*` attributes, never by studio-only values; gallery text uses `accent-ink`, never
  `accent`); Where to look (`theme/gallery.mjs`, `galleryAccent.mjs`).
- Commit 2: `recipes.md` → *A gallery font* (one `next/font` call + one pairing) and *A gallery colour*
  (one swatch entry; the contrast rows follow).
- Commit 4: `architecture.md` → Two kinds of settings (the branding, defaults and watermark rows) and
  Media (the CSP media origins and their two profiles); AGENTS.md → Where to look (`lib/images/`).

## Tests

| Test | What |
| --- | --- |
| `theme/gallery.test.ts` | every role map `gallery.mjs` exports has exactly the flattened keys of `studio.colors`; every value is `#RRGGBB`; swatch ids unique |
| `theme/galleryAccent.test.ts` | `mix` table (channel rounding, t = 0 and 1); swatch × theme → accent roles; `accent` ≥ 3.2 and `accent-ink` ≥ 4.5 against `ground` and `wash` in all 24 cases (12 swatches × 2 themes); Ochre's light `accent-ink` is darkened and its dark `accent` unchanged (the two directions of the rule); mixing stops at the first passing step; a passing swatch is unchanged; `contrastText` picks the higher ratio, falls back to black/white, and `inverse` on `accent` ≥ 4.5 in all 24 cases; `galleryThemeRules()` yields a rule set for **every** role map `gallery.mjs` exports (the test iterates the exports, so a fixture with an extra map gets its `[data-gallery-theme="<name>"]` rule), auto (with media, after light), 12 × 3 accent rules and one rule per pairing |
| `theme/contrast.test.ts` | luminance and ratio against known pairs (white/black 21, the studio pairs already pinned) |
| `colorContrast.test.ts` rows | gallery text pairs on `ground` and `wash` per theme (AA); accent 3:1 and accent-ink AA on both; `inverse` on `accent` AA — all through `galleryAccent` |
| preset test | Tailwind output contains `[data-gallery-theme="dark"]` with `--color-ground: 18 19 20` and `color-scheme: dark`, the auto media rule after the light rule, an accent rule, a font rule; all after `:root` |
| `galleryFonts.test.ts` | ids unique; every `display`/`text` names a registered family; `pairing('nope')` = the default; `scripts` agree with the subsets declared in `galleryFonts.ts` (read as source) |
| `parseBrandingInput.test.ts`, `parseGalleryDefaultsInput.test.ts`, `parseWatermarkInput.test.ts` | table-driven: each field's bounds, unknown enum values, display ≤ thumb refused, `protected` refused (D4.13), every anchor and `tiled`, `none`, watermark key shape, text length and control/bidi characters |
| `settings/branding.test.ts`, `galleryDefaults.test.ts`, `watermark.test.ts` | reader on a test D1: no row → defaults; invalid row → defaults + one log line; valid row wins; `watermarkSelection` reads false while the watermark is `none`; `watermarkImageUrl`: public URL with a domain, dev route in development, null otherwise (never a presigned URL) |
| route tests | watermark GET: `imageUrl` per the helper; 401; 403 cross-origin; 400 per invalid field; 200 → re-read via the reader equals the input; `none` removes it; the audit row names fields only; upload: type and size refused, 409 `MEDIA_DOMAIN_REQUIRED` in production without a domain, key under `branding/watermarks/`, 429 at the 21st; save: a key of another shape → 400, missing object → 400 `UPLOAD_MISSING`, wrong type or > 2 MB at `head()` → 400 `UPLOAD_INVALID` (the test platform's in-memory `blobs()`) |
| `security/headers.test.ts` rows | studio profile with a media domain and an S3 endpoint: both in `connect-src`, the domain in `img-src`; gallery profile: the domain in `img-src`, Turnstile in `script-src` **and** `frame-src`, `'unsafe-inline'` in `script-src`, no beacon, no S3 endpoint anywhere; empty vars → today's policy unchanged |
| guard `wrangler-config` rows | `MEDIA_PUBLIC_BASE_URL` / `MEDIA_S3_ENDPOINT` with a path, a trailing slash or no scheme → fail; empty → pass |
| `lib/images/watermark.test.ts` | `watermarkBox` table: nine anchors × landscape/portrait, margin from the short edge, size % of the long edge, a mark larger than the photo, tiled count, step and row offset, the 200-box cap; `applyWatermark` with a recording fake 2D context: alpha, `drawImage` boxes, text font size, fill and shadow from `WATERMARK_INKS`, shadow offset |
| component tests | Watermarks: the kind switch shows its fields, the upload states (mint → PUT → ready, failure message), Save disabled until the image is uploaded, the domain-required line; `RadioCards` and `SwatchPicker` (arrow keys, selection, labels); nav: Watermarks is a link, Branding still *Soon* |

The canvas preview itself (generated sample, `OffscreenCanvas`) is checked by hand (Verification 2):
jsdom has neither `OffscreenCanvas` nor `createImageBitmap`.

## Risks and edge cases

- **Contrast regressions** from a later theme edit are caught by the contrast rows (computed through
  `galleryAccent`, so a fallback change is tested too).
- **Font payload**: each pairing adds a few hundred bytes of `@font-face` CSS to pages that carry
  `GALLERY_FONT_CLASSES`; font files download only when used.
- **Cyrillic**: Cormorant Garamond covers it; Instrument Serif and Space Grotesk fall back to Georgia /
  the sans stack for Cyrillic glyphs (the pickers warn, D4.8).
- **The first presigned upload of the app**: the dev routes (local) and presigned PUTs (production; needs
  Phase 1 Verification 5 with the real bucket and its CORS) are exercised here first. A PUT with another
  Content-Type fails the signature (presigned) or the token (dev). Without D4.15 production would block it.
- **Cross-origin watermark fetch** from Phase 5's worker: the public bucket's CORS (one policy per bucket,
  for S3 and custom-domain access alike) must allow `GET` from the app origin (`apps/web/r2-cors.json`
  lists `GET`); verified on the custom domain (Verification 4).
- **No public domain yet**: an image watermark cannot be chosen in production until
  `MEDIA_PUBLIC_BASE_URL` is set (D4.14); a text watermark works.
- **Text watermark fonts** differ per OS: the fixed lists (D4.9) resolve to the same face on Windows and
  macOS for Arial and Georgia; in practice the preview and the upload run on the same machine. A gallery
  uploaded from two machines could differ slightly in the text's shape (accepted).
- **CSP vars read at build**: changing `MEDIA_PUBLIC_BASE_URL` or `MEDIA_S3_ENDPOINT` needs a rebuild and
  deploy, not just a var change in the dashboard (D4.15; one line in deployment.md → Media and in Phase
  5's owner checklist).
- **`SETTINGS_ENCRYPTION_KEY`** is not used by this phase (listed for completeness: Phases 3, 5 and 6 use
  it).
- **CPU**: small JSON writes, no hashing; the admin pages' own render cost is Phase 6's decision (index →
  To verify, the pages' CPU).

## Verification

1. `npm run verify`.
2. Local (`npm run dev`): Settings → Watermarks: upload a PNG watermark (dev routes), move it through the
   nine anchors and tiled on the landscape and portrait samples; a text watermark in both inks; *None*
   removes it; a reload shows the saved values; an invalid row inserted with
   `npm run wrangler -- d1 execute DB --local …` is ignored with a log line. The owner looks at the
   screen (no mockup exists).
3. `/admin/design`: gallery themes (light, dark, auto with the OS setting switched), twelve swatches, four
   pairings with Latin and Cyrillic samples, `RadioCards` and `SwatchPicker`, at 360 px and 1440 px; the
   Watermarks screen and the pickers by keyboard only.
4. With the real bucket (once the owner has done deployment.md → Media, Phase 1 Verification 5 and set
   `MEDIA_PUBLIC_BASE_URL`): `npm run preview` (built with the vars) shows both origins in the CSP; a
   watermark uploaded through a presigned PUT, then shown from the public media domain.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(ui): the gallery theme and accent swatches` | T4.1 | design page at 360/1440 |
| 2 | `feat(ui): gallery font pairings` | T4.2 | design page shows the Cyrillic samples |
| 3 | `feat(ui): radio cards, swatch picker and the gallery defaults readers` | T4.3 | design page; readers return defaults |
| 4 | `feat(admin): Settings → Watermarks and the media CSP` | T4.5 | Verification 2; `npm run preview` built with a test `MEDIA_PUBLIC_BASE_URL` shows the CSP carrying it |
| 5 | `docs: Phase 4 M1 done` | docs | — |

Milestones: **M1** = commits 1–5; **M2** (after the first usable version) = one commit each for T4.4
and T4.8–T4.11.

Order with the other phases: Phase 5 commits 1–2 (originals bucket, tables) need nothing from here;
**Phase 5 commit 3 (New gallery) needs commits 1–4** (theme ids, `RadioCards`, the defaults and watermark
readers, `watermarkImageUrl`); **Phase 5 commit 4 (the pipeline) needs commit 4** (`applyWatermark`);
**Phase 6 needs commit 4** (the CSP profiles) as well as Phase 5 commit 6 (`Chip`, `Tabs`, `scrim`).

## Checklist

- [ ] T4.1 Gallery theme, accents, contrast module, preset plugin, contrast rows
- [ ] T4.2 Font registry, display font family and tokens, `Display`
- [ ] T4.3 `RadioCards`, `SwatchPicker`, branding and gallery-defaults readers
- [ ] T4.5 Settings → Watermarks, `applyWatermark`, upload helper, media CSP
- [ ] Verification 1–3 (4 once the bucket and the public domain exist)
- [ ] M2: T4.4 Branding and Galleries screens · T4.8 logo · T4.9 presets · T4.10 client email text · T4.11 time zone and locale

## Review log

- **Round 1 (2026-11-16, code and docs check):** watermark read-back route added (D4.14); accent
  contrast thresholds and the computed ratios (D4.5); no Watermarks mockup noted; text watermark size
  defined by width and fixed font lists; image pre-scaling; `exports` claim corrected; `fontFamily.display`
  added; `PATCH` like the reference route; shared contrast module.
- **Round 2 (2026-11-16, six angles + the build session):** M1 trimmed (Branding and Galleries screens
  to M2; readers stay); the media CSP moved here with studio and gallery profiles (D4.15); no presigned
  GET for the watermark (D4.14, AGENTS.md); the lightbox map is Phase 6's; mixing and `contrastText`
  fallbacks specified; watermark geometry, anchors, tiling, `none`, generated sample and
  `WATERMARK_INKS` specified; `RadioCards`/`SwatchPicker` added; Starting point refreshed to `2b6972a`.
- **Round 3 (2026-11-16, build session second pass, cold-read review, consistency audit):** gallery CSP
  profile keeps Turnstile and `'unsafe-inline'`, drops the beacon and the S3 endpoint, named
  `securityHeaders({ dev, profile, media })`; build-time CSP needs a rebuild; the watermark snapshot is the
  whole object (D4.3, D4.11); classes and the three attributes on the same gallery root element, theme
  repeated on `<html>`; `galleryThemeRules()` per exported map; "all six swatches" lightened on dark;
  D4.2 says M1; scope line restored to B1–B7; dependency order with Phases 5 and 6 corrected.
- **Owner decisions (2026-11-17):** twelve swatches instead of six (D4.5; ratios computed for the six
  new ones, Ochre the one swatch darkened on light), the rest of the open questions as proposed; status
  `draft` → `ready`.

## Open questions

Decided by the owner (2026-11-17):

1. **Cyrillic**: yes, titles and client names may be Cyrillic, so the default pairing is Classic (D4.8);
   Editorial keeps Instrument Serif (a Cyrillic-capable display serif can be swapped in later).
2. **Accent**: more colours: twelve curated swatches (D4.5), still no free colour.
3. **Watermark**: no mockup first (the screens are built from `SettingsCard`s); image and text (D4.9);
   one watermark in M1, several named ones with presets in M2.
4. **Default sizes**: selection 1600 px / q75, sharing 2048 px / q82, thumbnail 800 px / q70.
5. **The M1 / M2 split** (D4.1): as proposed; the gallery header shows the studio name in the display
   font until the logo arrives in M2.

For the index (`plan_202611_mvp.md`, owned by the build session):

- Phase 4 row: "M1: gallery theme and fonts, radio cards and swatch picker, defaults readers, Watermarks,
  the media CSP · M2 (after the first usable version): Branding and Galleries screens, logo, presets,
  client email text, time zone"; status `placeholder` → `ready`.
- Open question 6 (time zone "becomes a studio setting in Phase 4"): now Phase 4 M2 (T4.11).
- Data model: Phase 4 M1 adds no table (rows `watermark` written, `branding` and `gallery_defaults` read
  in M1 and written in M2, all in `site_settings`); `presets` moves to M2.
- Scope: B8 (email settings) is Phase 3's.
- Phase 5 M1–M3 start from the gallery defaults; the preset picker (p05 T5.10) waits for M2.
- Task numbers: the index's "Phase 4, T4.7" (fonts, in the Gallery fonts decision) → T4.2.
- Architecture/Media: the CSP media origins are Phase 4's (D4.15), not Phase 5's.
