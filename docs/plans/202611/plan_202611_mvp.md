---
title: Memoria MVP (index)
type: plan
status: draft
updated: 2026-11-17
related: [../../design/HANDOFF.md, ../../architecture.md, ../../recipes.md, ../../../AGENTS.md]
---

# Memoria MVP (index)

**Memoria** is a client-gallery app for one photographer: upload a shoot, share a branded gallery, let
the client favourite, comment, request retouches and submit a selection, then export the filenames,
deliver the edits and control downloads and expiry. The product spec and mockups are
[`docs/design/HANDOFF.md`](../../design/HANDOFF.md) (they use the working name "Proofsheet").
Ground rules: [`AGENTS.md`](../../../AGENTS.md).

This file is the **index**: decisions that span phases, the scope, the architecture in brief and the
build order. Each phase has its own detailed plan, written and reviewed one at a time in build order;
the detail for one phase lives only in that phase's plan.

## Phases

| # | Plan | Delivers | Depends on | Status |
| --- | --- | --- | --- | --- |
| 0 | [Foundation](plan_202611_p00_foundation.md) | rename, contact example removed, studio design system (tokens, Inter, primitives, `/admin/design`), CI on master, encrypted backups | — | done |
| 1 | [Core and adapters](plan_202611_p01_core_adapters.md) | ports, Cloudflare + test adapters, R2, platform guard | 0 | done |
| 2 | [Admin shell and TOTP](plan_202611_p02_admin_totp.md) | studio layout, TOTP setup and login, sessions list | 1 | done |
| 2b | [Settings in the database](plan_202611_p02b_settings_db.md) | the admin account in D1 (Settings → Security), studio name and website address (Settings → Studio), env only as defaults | 2 | done |
| 3 | [Relay Worker and email](plan_202611_p03_relay_email.md) | `memoria-relay`, jobs, mail adapters (SMTP, Brevo, SES, Microsoft 365), Settings → Emails, security notices | 1, 2b | in-progress |
| 4 | [Studio settings](plan_202611_p04_studio_settings.md) | M1: gallery theme and fonts, radio cards and swatch picker, defaults readers, Watermarks, the media CSP · M2 (after the first usable version): Branding and Galleries screens, logo, presets, client email text, time zone | 2, 2b, 3 | in-progress (M1 done) |
| 5 | [Galleries and upload](plan_202611_p05_galleries_upload.md) | new gallery, browser image pipeline, gallery manager, sharing · M1–M3 for the first usable version; M4 after it; **M5 before Phase 8** (replace with edited, reprocess, processing switch) | 1, 3, 4 | in-progress |
| 6 | [Client gallery](plan_202611_p06_client_gallery.md) | M1: gallery from `worker.ts`, gate, grid, lightbox, mobile, `mv` cookie · M2: protected delivery, compare | 4, 5 | ready |
| 7 | [Proofing](plan_202611_p07_proofing.md) | favourites, lists, comments, retouch, review and submit | 3, 6 | placeholder |
| 8 | [Review and delivery](plan_202611_p08_review_delivery.md) | selections screen, filename export, deliver edits | 5 (M5), 7 | placeholder |
| 9 | [Downloads](plan_202611_p09_downloads.md) | download modes, PIN, email capture, browser ZIP | 6 | placeholder |
| 10 | [Expiry and lifecycle](plan_202611_p10_expiry.md) | expiry, reminders, after-expiry actions, scheduled publish | 3, 5 | placeholder |
| 11 | [Dashboard and analytics](plan_202611_p11_dashboard_analytics.md) | visitor tracking, counters, dashboard (failed jobs included, purges too), per-gallery stats | 6, 9 | placeholder |

Status per plan: `placeholder` (outline only) → `draft` (detailed, under review) → `ready` (reviewed,
can be coded) → `in-progress` → `done`. Phases 3 and 9 can run in parallel with their neighbours once
their dependencies are done. **The first usable version** = Phase 3, Phase 4 M1, Phase 5 M1–M3 and
Phase 6 M1. Phase 6's dependency on 4 and 5 is narrow: Phase 4's CSP profiles (commit 4) and Phase 5's
`Chip`, `Tabs` and `scrim` (commit 6).

## Decisions (2026-11-10 / 11)

| Topic | Decision |
| --- | --- |
| Name | **Memoria** (Worker `memoria`, D1 `memoria`, R2 `memoria-media`, relay Worker `memoria-relay`). |
| Hosting | Cloudflare Workers free tier now; a **core + platform adapters** so a Docker deployment can be added later without touching domain code (Phase 1). |
| Users | One master user (the photographer). No team roles. **TOTP is required**; the first authenticator is enrolled at sign-in with a setup code from `npm run admin:mfa`. No passkeys (Phase 2). |
| Email | Sent by a separate **relay Worker** (which also runs small background jobs) through SMTP, Brevo, Amazon SES or Microsoft 365 (Phase 3). |
| Formats | JPEG, PNG, WebP only. No HEIC, TIFF, RAW or AVIF. |
| Uploads | Usually Lightroom web exports (~2048 px sRGB JPEG). The uploaded file is kept as the original with its **location removed** (EXIF GPS, MakerNote and thumbnail, XMP, IPTC location fields); the pixels are untouched (Phase 5, D5.6). |
| Generated sizes | As few as possible, configurable per gallery at creation. Default: one ~800 px WebP grid thumbnail plus a display copy whose size depends on the gallery's purpose (next row) (Phase 5). |
| Image quality per gallery | (user, 2026-11-16) Every gallery has a **purpose**, chosen at creation, with defaults in Studio settings (Phase 4). **Selection** (the client picks photos before paying): clients see only a low-resolution display copy, always generated, size and quality set by the photographer (default 1600 px long edge, WebP quality 75, optional watermark). The original is never served and cannot be downloaded. **Sharing** (delivery): a display copy up to 2048 px, and full-resolution originals can be downloaded under the gallery's download rules (Phase 9). Delivery (Phase 8) turns a selection gallery into a sharing one. Screenshots cannot be prevented: the low resolution and the watermark are the protection. |
| Originals storage | (decided 2026-11-17, Phase 5 D5.1) Originals live in a **second, private R2 bucket** (`memoria-originals`, no public domain), read only through short-lived presigned GETs minted by the download API. The public bucket holds only thumbnails, display copies and logos, so no URL guessed or edited from a display copy can reach an original. |
| Watermark | Baked into previews at upload. Changing it = a new gallery until Phase 5 M5's reprocess. |
| Gallery fonts | The photographer chooses a font pairing per gallery (default in Studio settings) from a registry; adding a font is one registry entry. Only the chosen pairing is downloaded by clients (Phase 4, T4.2). |
| Image delivery | Chosen per gallery at creation. Default **public**: R2 on a custom domain, unguessable keys, served by the CDN (no Worker requests). Option **protected**: every image checked by the Worker, one Worker request per image (Phase 6). |
| ZIP downloads | Built **in the client's browser** (Phase 9). |
| Analytics | A **name or an email is asked before any download** (user, 2026-11-12), so every download is attributed, never anonymous; nothing is asked to view. Per visitor: browser, OS, device, country/city, IP (full IP kept 30 days) (Phase 11). |
| Settings | **What the photographer may change lives in D1 and is edited in the studio** (user, 2026-11-13): the sign-in email and password, studio name, website address, email delivery, later branding. Env vars are deploy-level secrets plus defaults for development and a first install (Phase 2b). |
| Email adapters | SMTP (own client), Brevo, Amazon SES, Microsoft 365 (Graph, OAuth) behind one `Mailer` port (user, 2026-11-13); Google later (Phase 3). |
| No sales | **No sales features at all** (user, 2026-11-12): no store, orders, prices or billing. A gallery may limit how many photos a selection includes; nothing is priced. |

### Phases 4–6 decisions (owner, 2026-11-17)

Details: each plan's *Decisions* and *Open questions*.

| Topic | Decision |
| --- | --- |
| Accent colours | Twelve curated swatches, no free colour (Phase 4 D4.5). |
| Gallery fonts default | **Classic** (Cormorant Garamond + Inter): titles and client names may be Cyrillic (Phase 4 D4.8). |
| Gallery URLs | `/g/<slug>`, the slug with a random part (`maria-jonas-k7x2qpm4rt`) (Phase 5 D5.2, D5.3). |
| Uploads resume by content hash | A re-dropped file already uploaded is skipped (Phase 5 D5.9). |
| Photo order | By filename (natural order) by default, capture time per gallery; one indexed key per photo (Phase 5 D5.23). |
| Deleting a gallery | Soft delete for 7 days, then purged by the relay (Phase 5 D5.17). |
| Pages' CPU | Option B: the client gallery is a static shell plus data answered by `worker.ts`, all on the free plan; Workers Paid for the admin side only when the tail shows `exceededCpu` (Phase 6 S6.1–S6.4). |
| Backups of originals | None for now: the photographer's Lightroom archive is the master copy (Phase 5, open question 11). |

### Phase 1 decisions (2026-11-12)

Details and reasons: [Phase 1 → Decisions](plan_202611_p01_core_adapters.md#decisions).

| Topic | Decision |
| --- | --- |
| Packages | `@repo/platform` (neutral: ports, config, media rules, blob URLs, memory store, contract suites, test platform) and `@repo/platform-cloudflare` (D1, R2, the Cloudflare platform, the OpenNext wrapper). Guard `platform-boundary`. |
| Composition | `cloudflarePlatform(env, waitUntil)` for any Worker; Next code uses `getPlatform()` from `@repo/platform/current`, which vitest aliases to the test platform and a Docker build would alias to a Node platform. |
| Statements | Plain data `{ sql, params }`; builders are pure; the dialect stays SQLite. |
| Media | Production: presigned S3 URLs to R2 only, no fallback. Development: HMAC-signed `/api/blobs/*` routes, 404 elsewhere. Images only, server-generated keys under known prefixes, limits checked at minting. |
| Setup | The R2 bucket, its CORS rules and a bucket-scoped R2 API token are manual one-time steps ([deployment.md → Media](../../deployment.md#media-r2)); dev, tests and CI need no account. |

## Scope

Feature IDs refer to the grouping used when the scope was cut (2026-11-10).

- **In:** A1 single admin, A3 (TOTP only), A4 sessions list · B1–B8 branding and defaults ·
  C1–C6 gallery creation and presets · D1–D4, D5–D6 (browser-side), D10 replace with edited ·
  E1–E7 gallery manager · F1–F8 access and sharing (F3 depends on open question 1) ·
  G1–G5, G7–G9 client gallery · H1–H6, H8–H9 proofing ·
  I1, I2, I4–I7 review and delivery · J1–J3 downloads · K1, K2 (hide, delete web sizes), K3, K4 ·
  L1–L5, L7 dashboard and analytics.
- **Who owns what:** F1/F2 — Phase 5 the links and passwords, Phase 6 the gate; F8 (scheduled publish)
  is Phase 10's; C6 (approve/reject) is Phase 7's; B8 (email settings) is Phase 3's. "Invited emails
  only" access is cut (link and password only).
- **Out:** A2 team roles · D7 HEIC/TIFF · D8 automatic cover pick (first landscape photo instead) ·
  D9 Lightroom/Capture One import · G6 slideshow music · I3 Lightroom plugin · J4 emailed ZIP link ·
  K2 cold storage · L6 server health · M Find me, guest uploads, video · N payments, print store, H7 extra-photo prices · a Clients screen (clients are seen per gallery) ·
  O integrations, webhooks, API (for now) · P storage/backups/domain screens, GDPR tooling.

## Architecture in brief

```
memoria (apps/web)          Next.js via OpenNext: admin, API; worker.ts answers /healthz, the
                            client gallery /g/* (static shell + data) and protected-mode images
                            (Phase 6 M2) before Next loads
memoria-relay (apps/relay)  no UI: runs jobs (email, reminders, expiry, gallery.purge, media.purge),
                            triggered by a service binding from memoria + a Cron Trigger
R2 memoria-media            thumbnails, display copies, logos; public custom domain
R2 memoria-originals        originals; private, presigned GETs only (Phase 5)
D1 memoria                  shared by both Workers
```

- **Ports and adapters** (Phase 1, done): domain code talks to `Db`, `BlobStore`, `Config` and `defer`
  through `getPlatform()`; `Mailer` and `Jobs` join with the relay (Phase 3). Cloudflare adapters now,
  Docker adapters later ([architecture.md → The Docker path](../../architecture.md#the-docker-path-documented-not-built)),
  in-memory adapters for tests. A guard keeps
  Cloudflare APIs inside adapters. Design for the stricter platform (10 ms CPU per request).
- **Jobs** (Phase 3): rows in D1 written in the same `batch` as the change that caused them; the app
  nudges the relay, the relay's cron retries. `dedupe_key` UNIQUE makes repeats harmless.
- **Images** (Phase 5): processed in the photographer's browser (Web Workers, native browser APIs, no
  WebAssembly) and uploaded straight to R2 through presigned URLs.
- **Client identity** (Phases 6, 7, 11): a signed cookie for gallery access, a visitor cookie per
  gallery (`mv`, signed, Phase 6, no D1 write; its `visitors` row from Phase 7), counters by upsert,
  never a write per photo view. Rate limits key IPv6 addresses by their /64 (Phase 6 changes the shared
  helper).
- **Media cleanup** (Phase 5): `media.purge` deletes the keys recorded in D1 (no bucket listing); it
  supersedes Phase 3 D3.10's `r2.sweep` placeholder.
- **Downloads** (Phase 9): original keys only from an API that checks the gallery's purpose (never for
  a selection gallery), the mode, PIN and email; ZIPs streamed by the browser.

### Data model by phase

| Phase | Tables |
| --- | --- |
| 0 | drops `contact_messages` (never shipped) |
| 2 | `admin_authenticators`, `admin_recovery_codes`, `admin_setup_codes`, `admin_mfa_challenges`; `admin_sessions` rebuilt |
| 2b | `admin_account` (the `studio` row in `site_settings`) |
| 3 | `jobs` |
| 4 | none in M1 (rows in `site_settings`: `watermark` written; `branding`, `gallery_defaults` read, written in M2); `presets` in M2 |
| 5 | `galleries`, `photo_sets`, `photos`; `ix_jobs_ref` |
| 6 | none (the signed `mv` cookie) |
| 7 | `visitors`, `favorite_lists`, `favorites`, `photo_comments`, `retouch_requests` |
| 9 | `download_events` |
| 10 | `galleries.publish_at`, `galleries.expires_at` (`ALTER TABLE ADD COLUMN`) |
| 11 | `gallery_stats_daily`, `photo_stats` |

Kept from the boilerplate: `site_settings`, `audit_log`, `admin_sessions`, `rate_limits`.

## Open questions (cross-phase)

1. **Client identity for favourites (F3).** Favourites belong to a visitor cookie, so a couple on two
   devices sees two selections. Proposal: a name/email prompt at the first heart (Phase 7), an email
   sign-in link later.
2. **Gallery URLs.** The mockups put galleries at the domain root (`photos.example.com/maria-jonas`).
   That needs reserved slugs (`admin`, `api`, `healthz`, `_next`, …). Alternative: `/g/<slug>`.
   **Decided (2026-11-17): `/g/<slug>`** (Phase 5 D5.2).
3. **Custom domain.** The public R2 bucket needs a domain on Cloudflare (the `r2.dev` URL is
   rate-limited, not for production). Which domain, and which subdomains for the app and the images?
   **Shape decided (2026-11-17):** two subdomains of one domain in one Cloudflare zone (e.g.
   `gallery.<domain>` and `media.<domain>`). **Still open: the domain name**, needed before Phase 5's
   Verification 4 and Phase 6's cache.
4. **SMTP provider** and the sending domain (SPF, DKIM, DMARC). Needed by Phase 3.
5. **Cyrillic.** Will gallery titles or client names be in Cyrillic? The default gallery display font
   (Instrument Serif) has none. **Decided (2026-11-17): yes**, so the default pairing is Classic
   (Phase 4 D4.8).
6. **Time zone** for dates (today `UTC`). Becomes a studio setting in Phase 4 M2 (T4.11).

## To verify before building (owner phase in brackets)

- ~~Outbound SMTP from Workers on 587/465 via `cloudflare:sockets` (3).~~ Works (smoke deploy
  2026-11-16: Gmail, Brevo, Microsoft 365, SES on 587 with STARTTLS, Gmail and SES on 465;
  certificates are checked). Details: Phase 3 plan → Built.
- Free-plan accounting for service-binding calls (3). Cron Triggers: done (a cron run costs 2–4 ms
  CPU idle, 9 ms with a job). The nudge is measured with the first route that sends one (Phase 3
  commit 4).
- **The pages' CPU on the free plan** (found 2026-11-16, smoke deploy): `/` median 8 ms (p95 11),
  `/robots.txt` median 6 (p95 14), `/admin/login` **median 26 ms (p95 37)**, a cold start 182 ms.
  All answered 200, but the free plan's limit is 10 ms per request. **Decided (2026-11-17):** the
  gallery is option B with gates S6.1–S6.4 (Phase 6); the admin side moves to Workers Paid only when
  the tail shows `exceededCpu` (no code change).
- Against the real bucket, from a browser with `apps/web/r2-cors.json` applied: a presigned PUT and
  GET, `response-content-disposition` honoured, and a PUT with another Content-Type refused (Phase 1,
  Verification 5) (5).
- ~~Presigned multipart uploads, if originals above 100 MB must be accepted (5).~~ Not needed:
  Lightroom exports are far below 100 MB.
- `createImageBitmap` resize options and `OffscreenCanvas.convertToBlob('image/webp')` in Safari (5):
  covered by the JPEG fallback (Phase 5 D5.5), still checked in Verification 3.
- `client-zip` streaming with `showSaveFilePicker`; memory limits for in-memory parts (9).
- At the first deploy: `npm run measure:cpu` on `PATCH /api/admin/account/password` (two PBKDF2) and
  the sign-in; over 10 ms → the split in Phase 2b D2b.7 (2b, Verification 4).
