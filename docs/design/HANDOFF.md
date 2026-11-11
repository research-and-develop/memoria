# Proofsheet — design handoff for Claude Code

> **Status (2026-11-11):** the product is named **Memoria** ("Proofsheet" was the design's working name).
> Several features below were cut and some decisions differ from this spec (browser-side image
> processing and ZIPs, SMTP relay Worker, one admin with TOTP, no team roles, no print store, Find me,
> video or integrations). The build plan is the source of truth for scope:
> [`docs/plans/202611/plan_202611_mvp.md`](../plans/202611/plan_202611_mvp.md).

Self-hosted client gallery for photographers. This folder (`docs/design/`) holds the design source — the mockups
(`docs/design/*.dc.html`), the design-tool canvas index (`canvas.json`, board titles and order) — and this spec.
The `.dc.html` files are design mockups: read them for **layout, copy, colors, spacing and interactions** (each file's
`<script>` block shows the UI state logic). Do not ship them as-is — they rely on a design-tool runtime (`support.js`)
that is not in this repo, so they do not render standalone.

## How to use this with Claude Code

The stack is already fixed by the repo boilerplate (Next.js on one Cloudflare Worker, D1, Turnstile — see
[`AGENTS.md`](../../AGENTS.md) and [`docs/architecture.md`](../architecture.md)). Plans go in
`docs/plans/YYYYMM/plan_*.md` (see [`docs/wiki-conventions.md`](../wiki-conventions.md)). Start with:

> Read `docs/design/HANDOFF.md` and every `docs/design/*.dc.html`. Write a build plan for the MVP described there on
> the existing stack, then implement it screen by screen, matching the mockups' layout, copy and design tokens.
> Ask me before choosing anything the spec leaves open.

## Screens (file → purpose)

| File | Screen | Key behavior |
|---|---|---|
| `Main.dc.html` | Studio dashboard | KPIs, "Needs your attention" queue, recent galleries with status, client activity feed, server health |
| `NewGallery.dc.html` | New gallery (single screen) | Presets fill defaults; resumable upload; auto-split sets by time gaps; access (link / password / invited emails); downloads (off / web / full / after selection); PIN; watermark; favorites limit + extra price; expiry + reminders; live cover + email preview |
| `GalleryEditor.dc.html` | Gallery manager | Sets (reorderable), multi-select grid with bulk bar (move, hide, cover, replace edited, delete), heart/note badges, share panel (link, password, PIN, QR, guest/vendor links), client-feature toggles, stats |
| `ProofReview.dc.html` | Client selection review | Client lists, filters (notes / retouch), retouch checklist, filename export for Lightroom / Capture One (space/comma/newline, strip extensions), billing of extras |
| `Settings.dc.html` | Studio & server settings | Branding (logo, accent, typography, theme, grid style), domain + HTTPS, security, storage locations + generated sizes, backups, team roles, integrations, privacy |
| `ClientGallery.dc.html` | Client gallery | Cover, set tabs, masonry grid, favorite + download per photo, favorites progress, Find me, slideshow, share, print CTA, expiry footer; light/dark theme + accent |
| `ClientLightbox.dc.html` | Photo view | Favorite, add to lists, retouch request chips, comment thread, compare side-by-side, filmstrip, download, buy print, keyboard shortcuts |
| `ClientSelection.dc.html` | Review & submit | Remove with undo, live count vs included, extras price, note to photographer, submit → confirmation → reopen |
| `Mobile.dc.html` | Client on phone (390×844) | Set chips, 2-col grid, Find me card, favorites bar, bottom nav |

Navigation in the prototype: sidebar links between studio screens; client gallery → lightbox → selection.

## Design tokens

**Studio (admin)**
- Font: Inter 400/500/600/700. Mono: JetBrains Mono (filenames).
- Ground `#F6F6F4`, surface `#FFFFFF`, ink `#16171A`, body-2 `#3A3C41`, muted `#5D6066`, border `#E4E4E0`, input border `#C9CAC4`, control border `#DADAD5`, subtle fill `#EEEEEB`.
- Accent (pine) `#1F6F5C`, accent-ink `#17564A`, accent-tint `#EAF2EF`.
- Status pills (bg / text): Live `#E3F1EC/#17564A` · Proofing `#FCEFD9/#8A4B00` · Draft `#EEEEEB/#45474C` · Scheduled `#E4EBF8/#2747A0` · Expired `#F7E3E1/#9B2C22`. Alert badge `#B4530A`.
- Radii: cards 12–14px, controls 8–10px, pills 999px. Touch targets ≥ 44px. Toggle 44×26.

**Client gallery**
- Display: Instrument Serif; body: Inter. Alternatives offered in settings: Cormorant Garamond, Space Grotesk, Inter-only.
- Light: bg `#FBFAF7`, fg `#16171A`, muted `#5D6066`, surface `#F1EFEA`, border `#DEDCD5`.
- Dark: bg `#121314`, fg `#F1F0EC`, muted `#A9ABAF`, surface `#1D1F21`, border `#34363A`.
- Lightbox: bg `#0F1011`, panel `#17191B`, favorite `#E08A5C`.
- Accent is photographer-configurable (default `#1F6F5C`).

## Core data model (suggested)

- **Studio** (branding, domain, defaults) · **User** (role: owner / assistant / retoucher)
- **Client** (name, emails) · **Gallery** (slug, title, date, status, cover, access mode, password hash, download mode, download PIN, watermark preset, favorites limit, extra price, expires_at, after_expiry action, feature flags: faces, guest uploads, slideshow, store, social)
- **Set** (gallery, name, position) · **Photo** (set, filename, capture time, dimensions, hidden, original path, derivatives, edited_version_of)
- **Visitor** (gallery, email?, first/last seen) · **FavoriteList** (gallery, visitor, name, submitted_at, locked)
- **Favorite** (list, photo) · **Comment** (photo, author, body) · **RetouchRequest** (photo, type, done)
- **DownloadEvent**, **ViewEvent** (analytics) · **Order** / **OrderItem** (print store) · **Preset** (saved gallery defaults)

## Backend jobs

Resumable chunked upload (e.g. tus) · derivative generation (480 / 1600 / 2048 / 3200 px; AVIF + WebP + JPEG; keep ICC + EXIF, strip GPS) ·
video transcoding to HLS · background ZIP building + emailed link · face indexing (local only) · expiry reminders (14 d, 2 d) ·
expiry actions (hide / cold storage) · nightly backups + offsite sync · webhooks (gallery viewed, selection submitted, order paid).

## Security

Unguessable slugs, signed expiring image URLs, password + PIN brute-force lockout, passkey/2FA for studio users,
noindex on galleries, right-click deterrent on previews, GDPR export/erase per client.

## Suggested MVP order

1. Auth + studio settings (branding, domain) → 2. Galleries, sets, upload + derivatives → 3. Client gallery + lightbox
→ 4. Favorites / lists / submit + photographer review + filename export → 5. Downloads (sizes, PIN, ZIP) + expiry/reminders
→ 6. Comments + retouch requests → 7. Analytics → 8. Find me, guest uploads, print store, integrations.
