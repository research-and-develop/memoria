---
title: Memoria MVP (index)
type: plan
status: draft
updated: 2026-11-12
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
| 2b | [Settings in the database](plan_202611_p02b_settings_db.md) | the admin account in D1 (Settings → Security), studio name and website address (Settings → Studio), env only as defaults | 2 | draft |
| 3 | [Relay Worker and email](plan_202611_p03_relay_email.md) | `memoria-relay`, jobs, mail adapters (SMTP, Brevo, SES, Microsoft 365), Settings → Emails, security notices | 1, 2b | draft |
| 4 | [Studio settings](plan_202611_p04_studio_settings.md) | branding, gallery theming system and fonts, gallery defaults, presets, email template text and sender branding | 2, 2b, 3 | placeholder |
| 5 | [Galleries and upload](plan_202611_p05_galleries_upload.md) | new gallery, browser image pipeline, gallery manager, sharing | 1, 4 | placeholder |
| 6 | [Client gallery](plan_202611_p06_client_gallery.md) | access gate, gallery, lightbox, mobile, protected delivery | 5 | placeholder |
| 7 | [Proofing](plan_202611_p07_proofing.md) | favourites, lists, comments, retouch, review and submit | 3, 6 | placeholder |
| 8 | [Review and delivery](plan_202611_p08_review_delivery.md) | selections screen, filename export, deliver edits | 7 | placeholder |
| 9 | [Downloads](plan_202611_p09_downloads.md) | download modes, PIN, email capture, browser ZIP | 6 | placeholder |
| 10 | [Expiry and lifecycle](plan_202611_p10_expiry.md) | expiry, reminders, after-expiry actions, scheduled publish | 3, 5 | placeholder |
| 11 | [Dashboard and analytics](plan_202611_p11_dashboard_analytics.md) | visitor tracking, counters, dashboard, per-gallery stats | 6, 9 | placeholder |

Status per plan: `placeholder` (outline only) → `draft` (detailed, under review) → `ready` (reviewed,
can be coded) → `in-progress` → `done`. Phases 3 and 9 can run in parallel with their neighbours once
their dependencies are done.

## Decisions (2026-11-10 / 11)

| Topic | Decision |
| --- | --- |
| Name | **Memoria** (Worker `memoria`, D1 `memoria`, R2 `memoria-media`, relay Worker `memoria-relay`). |
| Hosting | Cloudflare Workers free tier now; a **core + platform adapters** so a Docker deployment can be added later without touching domain code (Phase 1). |
| Users | One master user (the photographer). No team roles. **TOTP is required**; the first authenticator is enrolled at sign-in with a setup code from `npm run admin:mfa`. No passkeys (Phase 2). |
| Email | Sent by a separate **relay Worker** (which also runs small background jobs) through SMTP, Brevo, Amazon SES or Microsoft 365 (Phase 3). |
| Formats | JPEG, PNG, WebP only. No HEIC, TIFF, RAW or AVIF. |
| Uploads | Usually Lightroom web exports (~2048 px sRGB JPEG). The uploaded file is kept as the original, **GPS stripped**, the rest of EXIF kept (Phase 5). |
| Generated sizes | As few as possible, configurable per gallery at creation. Default: one ~800 px WebP grid thumbnail; a 2048 px display copy only when the upload is larger or the gallery is watermarked (Phase 5). |
| Watermark | Baked into previews at upload. Changing it = delete and re-create the gallery. |
| Gallery fonts | The photographer chooses a font pairing per gallery (default in Studio settings) from a registry; adding a font is one registry entry. Only the chosen pairing is downloaded by clients (Phase 4, T4.7). |
| Image delivery | Chosen per gallery at creation. Default **public**: R2 on a custom domain, unguessable keys, served by the CDN (no Worker requests). Option **protected**: every image checked by the Worker, one Worker request per image (Phase 6). |
| ZIP downloads | Built **in the client's browser** (Phase 9). |
| Analytics | A **name or an email is asked before any download** (user, 2026-11-12), so every download is attributed, never anonymous; nothing is asked to view. Per visitor: browser, OS, device, country/city, IP (full IP kept 30 days) (Phase 11). |
| Settings | **What the photographer may change lives in D1 and is edited in the studio** (user, 2026-11-13): the sign-in email and password, studio name, website address, email delivery, later branding. Env vars are deploy-level secrets plus defaults for development and a first install (Phase 2b). |
| Email adapters | SMTP (own client), Brevo, Amazon SES, Microsoft 365 (Graph, OAuth) behind one `Mailer` port (user, 2026-11-13); Google later (Phase 3). |
| No sales | **No sales features at all** (user, 2026-11-12): no store, orders, prices or billing. A gallery may limit how many photos a selection includes; nothing is priced. |

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
- **Out:** A2 team roles · D7 HEIC/TIFF · D8 automatic cover pick (first landscape photo instead) ·
  D9 Lightroom/Capture One import · G6 slideshow music · I3 Lightroom plugin · J4 emailed ZIP link ·
  K2 cold storage · L6 server health · M Find me, guest uploads, video · N payments, print store, H7 extra-photo prices · a Clients screen (clients are seen per gallery) ·
  O integrations, webhooks, API (for now) · P storage/backups/domain screens, GDPR tooling.

## Architecture in brief

```
memoria (apps/web)          Next.js via OpenNext: admin, client galleries, API; worker.ts answers
                            /healthz and protected-mode images before Next loads
memoria-relay (apps/relay)  no UI: runs jobs (SMTP email, reminders, expiry, R2 cleanup),
                            triggered by a service binding from memoria + a Cron Trigger
R2 memoria-media            originals, thumbnails, display copies, logos; public custom domain
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
  gallery, counters by upsert, never a write per photo view.
- **Downloads** (Phase 9): original keys only from an API that checks the mode, PIN and email; ZIPs
  streamed by the browser.

### Data model by phase

| Phase | Tables |
| --- | --- |
| 0 | drops `contact_messages` (never shipped) |
| 2 | `admin_authenticators`, `admin_recovery_codes`, `admin_setup_codes`, `admin_mfa_challenges`; `admin_sessions` rebuilt |
| 2b | `admin_account` (the `studio` row in `site_settings`) |
| 3 | `jobs` |
| 4 | `presets` (studio settings live in the existing `site_settings`) |
| 5 | `galleries`, `photo_sets`, `photos` |
| 6 | `visitors` |
| 7 | `favorite_lists`, `favorites`, `photo_comments`, `retouch_requests` |
| 9 | `download_events` |
| 11 | `gallery_stats_daily`, `photo_stats` |

Kept from the boilerplate: `site_settings`, `audit_log`, `admin_sessions`, `rate_limits`.

## Open questions (cross-phase)

1. **Client identity for favourites (F3).** Favourites belong to a visitor cookie, so a couple on two
   devices sees two selections. Proposal: a name/email prompt at the first heart (Phase 7), an email
   sign-in link later.
2. **Gallery URLs.** The mockups put galleries at the domain root (`photos.example.com/maria-jonas`).
   That needs reserved slugs (`admin`, `api`, `healthz`, `_next`, …). Alternative: `/g/<slug>`.
   Decide in Phase 5.
3. **Custom domain.** The public R2 bucket needs a domain on Cloudflare (the `r2.dev` URL is
   rate-limited, not for production). Which domain, and which subdomains for the app and the images?
   Needed by Phase 5.
4. **SMTP provider** and the sending domain (SPF, DKIM, DMARC). Needed by Phase 3.
5. **Cyrillic.** Will gallery titles or client names be in Cyrillic? The default gallery display font
   (Instrument Serif) has none. Needed by Phase 4.
6. **Time zone** for dates (today `UTC`). Becomes a studio setting in Phase 4.

## To verify before building (owner phase in brackets)

- Outbound SMTP from Workers on 587/465 via `cloudflare:sockets` (3).
- Free-plan accounting for service-binding calls and Cron Triggers (3).
- Against the real bucket, from a browser with `apps/web/r2-cors.json` applied: a presigned PUT and
  GET, `response-content-disposition` honoured, and a PUT with another Content-Type refused (Phase 1,
  Verification 5) (5).
- Presigned multipart uploads, if originals above 100 MB must be accepted (5).
- `createImageBitmap` resize options and `OffscreenCanvas.convertToBlob('image/webp')` in Safari (5).
- `client-zip` streaming with `showSaveFilePicker`; memory limits for in-memory parts (9).
