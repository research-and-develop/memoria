---
title: "Phase 5: Galleries and upload"
type: plan
status: draft
updated: 2026-11-16
related: [plan_202611_mvp.md, plan_202611_p01_core_adapters.md, plan_202611_p03_relay_email.md, plan_202611_p04_studio_settings.md, plan_202611_p06_client_gallery.md, ../../architecture.md, ../../deployment.md, ../../recipes.md, ../../../AGENTS.md]
---

# Phase 5: Galleries and upload

## Goal

The photographer creates a gallery, drops a shoot on it and manages it: the photos are processed **in
the photographer's browser** (GPS stripped from the original, a thumbnail and a display copy generated,
the watermark baked), uploaded straight to R2 through presigned URLs, and registered in D1. The
photographer arranges sets, hides, moves, deletes and picks a cover, then copies the gallery link (or
emails it to the client) for Phase 6's client gallery.

**Done when (M1–M3, the part of the first usable version):**

- **New gallery** (`/admin/galleries/new`): name (the only required field), shoot date, client name and
  email, purpose (selection or sharing) with the display copy's size and quality, access (link or
  password), image delivery (public), watermark on/off, theme, accent and font pairing; all prefilled
  from Phase 4's defaults. Create → the gallery manager.
- **Upload** (in the manager): drop files or pick them; JPEG, PNG and WebP accepted by their bytes, other
  files listed as not supported with the reason; duplicates (same bytes) skipped; per file: the original
  with GPS removed (rest of EXIF kept, pixels untouched), a thumbnail and a display copy (WebP, JPEG
  where the browser cannot encode WebP), the watermark on the display copy and thumbnail of a
  watermarked gallery, a placeholder colour; three presigned PUTs; registration checks every object with
  `head()`. Progress, retry of failed files, and **resume by dropping the same files again**.
- **Originals live in a private second bucket** `memoria-originals` (decided here: D5.1); the public
  bucket holds only thumbnails, display copies and branding.
- **Gallery manager** (`/admin/galleries/[id]`): sets (add, rename, reorder, delete when empty), a photo
  grid per set (rendered in the browser from a paged JSON API), multi-select with a bulk bar (move to
  set, hide/show, set as cover, delete), sort (capture time, filename), badges (cover, hidden).
- **Galleries list** (`/admin/galleries`): every gallery with its cover, status, purpose, photo count.
- **Sharing panel**: publish/unpublish, the link (copy, QR), the password (show, change), and **email the
  link to the client** with the `gallery.ready` template, previewed through `renderEmail`.
- **Delete**: a gallery is hidden at once and purged after 7 days by a relay job (rows, then objects in
  both buckets), restorable until then; deleted photos and abandoned uploads are purged by the relay too.
- The sidebar's *New gallery* and *Galleries* drop `soonPhase`.
- `npm run ts-check` and `npm run test` green; Verification passes locally, then against the real
  buckets.

**After the first usable version (M4):** presets (needs Phase 4 M2), folder drop (subfolders → sets),
auto-split by capture-time gaps, *Replace with edited version*, smart filters, custom drag order, draft
autosave, IndexedDB resume across browser restarts, scheduled publish (Phase 10).

- **Depends on:** Phase 1 (media rules, `blobUrls`), Phase 3 (jobs, `renderEmail`, the email job),
  Phase 4 M1 (gallery defaults, watermark, theme and font ids). **Unblocks:** Phases 6, 8, 9, 10.
- **Mockups:** `NewGallery.dc.html`, `GalleryEditor.dc.html`.
- **Scope (feature IDs):** C1, C3–C5, D1–D6, E1–E5, E7, F1, F2, F6, F7 (M1–M3); C6, D10, E6, F8 and the
  rest of E (M4); F3–F5 belong to Phases 7 and 9.

## Starting point (verified 2026-11-16 against master `e6ed219`: Phases 0–2b done, Phase 3 M1–M2 done)

- **Media rules** (`packages/platform/media.ts`): `MEDIA_TYPES` = `image/jpeg`, `image/png`,
  `image/webp`; `BLOB_PREFIXES` = `galleries`, `branding`, `dev`; `isBlobKey` = `[a-z0-9._/-]{1,512}`
  with a known first segment; `MAX_UPLOAD_BYTES` = 100 MB; `contentDisposition(name)`.
- **`blobUrls(config)`** (`packages/platform/blobUrls.ts`): mode `s3` (all four `MEDIA_S3_*`), `dev`
  (`NEXTJS_ENV=development` + `MEDIA_DEV_SIGNING_SECRET`) or `none`; `uploadUrl(key, { contentType, size, expiresInSeconds ≤ 900 })`
  → `{ url, method: 'PUT', headers: { 'content-type' } }`; `readUrl(key, { expiresInSeconds, downloadName })`;
  `publicUrl(key)` → `MEDIA_PUBLIC_BASE_URL + key` or null. **One bucket only**: `Config.media.s3` =
  `{ endpoint, bucket, accessKeyId, secretAccessKey }`; `MEDIA_S3_BUCKET` must equal the `MEDIA`
  binding's bucket (guard `wrangler-config`).
- **`BlobStore` port** (`ports.ts`): `put`, `get`, `head`, `delete(keys)` (missing ignored, adapters
  chunk), `list({ prefix, cursor, limit ≤ 1000 })`; `getPlatform().blobs()` takes no argument;
  `cloudflarePlatform(env, waitUntil)` builds `r2BlobStore(env.MEDIA)`. Dev routes
  `api/blobs/upload` and `api/blobs/read` (HMAC token, 404 outside development, ≤ 32 MB, buffered).
- **Buckets and config**: `apps/web/wrangler.jsonc` binds `MEDIA` → `memoria-media`; vars
  `MEDIA_PUBLIC_BASE_URL` (empty) and `MEDIA_S3_ENDPOINT` (empty) and `MEDIA_S3_BUCKET`
  (`memoria-media`) are **plain vars**, so build-time code can read them from the file. The relay binds
  `MEDIA` too. `apps/web/r2-cors.json`: PUT/GET/HEAD from localhost:3210, :8787 and a production
  placeholder, `content-type` header, exposes `ETag`, `Content-Length`, `Content-Disposition`. The
  bucket `memoria-media` exists (eeur, smoke deploy); its CORS, the S3 token and the public domain are
  not set up yet (Phase 1 Verification 5 is open).
- **CSP** (`lib/security/headers.mjs`, used by `next.config.mjs` at build): `img-src 'self' data: blob:`,
  `connect-src 'self' https://cloudflareinsights.com`, `worker-src 'self' blob:`. Neither the S3
  endpoint nor a media domain is allowed yet.
- **Jobs** (Phase 3): `jobStatement(kind, payload, { now, runAfter?, ref?, dedupeKey?, maxAttempts? })`
  → `{ id, statement }`, then `nudgeRelay()`; `JobKind` = `{ kind, version, maxAttempts, priority, backoff, parse, run }`;
  registry `JOB_KINDS` = `email`, `housekeeping`; one job per relay invocation (10 ms CPU each); the
  `jobs.ref` column exists, **`ix_jobs_ref` was left for this phase** (p03: "waits for Phase 5, the first
  reader of `ref`"); `cancelPendingJobsStatement({ ref, kind? })` exists in the query module.
  `housekeeping` runs daily from 03:00 UTC (stale and old jobs).
- **Email** (Phase 3): `renderEmail(id, params, ctx)` is pure (`lib/email/templates/registry.ts`),
  `emailJobStatement(…)`, `emailContext(studio)` with `link(path)`; one template (`test`); M3 adds the
  security templates. Visitor-email rules D3.15 (not needed here: the photographer types the client's
  address).
- **Secrets helper**: `settingsCipher(SETTINGS_ENCRYPTION_KEY)` → `encrypt(plain, aad)` /
  `decrypt(stored, aad)` (AES-GCM, `v1:` prefix; `lib/settings/secrets.ts`); the key is on both Workers.
- **Admin UI**: `components/admin/nav.ts` has *New gallery* (`/admin/galleries/new`) and *Galleries*
  (`/admin/galleries`) with `soonPhase: 5`; `PageHeader`, `@repo/ui/dialog`, `Segmented`, `Toggle`;
  no `Chip`, Tabs or `scrim` token yet (T5.9). `uqr` (QR codes) is a dependency (TOTP setup).
- **Schema**: `0001`–`0005` applied to production and forward-only; no table uses `REFERENCES` yet (the
  test harness resets with `PRAGMA defer_foreign_keys = on`). Phase 4 M1 adds no migration, so this
  phase's is `0006` (the next free number when it lands).
- **Measured** (smoke deploy, index → To verify): a Next page costs 8 ms CPU at the median (`/`), a
  route handler about 6 ms (`/robots.txt`), the sign-in page 26 ms; requests over 10 ms still answered
  200. Every admin screen and admin API route of this phase runs through Next.
- **Cloudflare facts** (docs, to re-check at build): D1 allows **100 bound parameters per statement** and
  50 queries per invocation on the free plan; R2 `delete` takes up to 1000 keys per call; R2 free tier:
  10 GB-month storage, 1M Class A (writes, lists) and 10M Class B (reads) operations a month; deletes are
  free; reads served from the CDN cache on a custom domain cost no operation.
- **Browser facts** (to verify, index → To verify): Safari's canvas does not encode WebP
  (`convertToBlob({ type: 'image/webp' })` returns PNG there); `createImageBitmap` resize options are not
  supported everywhere; `OffscreenCanvas` is in every current browser (Safari 16.4+).

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D5.1 | **Originals in a second, private bucket `memoria-originals`** (adopting the index proposal). A second binding `ORIGINALS` on both Workers; `getPlatform().blobs(bucket?: 'media' \| 'originals')` (default `media`); `blobUrls(config).uploadUrl(key, { bucket })` and `readUrl(key, { bucket })`; `Config.media.s3.originalsBucket` from a new var `MEDIA_S3_ORIGINALS_BUCKET` (= the `ORIGINALS` bucket, guard); one bucket-scoped API token covering both buckets; the originals bucket has **no public domain**, CORS PUT (and GET for Phase 9) from the app origin. Development: a second local bucket, the dev token names its bucket. | No URL guessed or edited from a display copy can reach an original; Phase 9 hands out originals only through short-lived presigned GETs. The alternative (one bucket, a random key per original) leaves a once-shared URL valid forever. |
| D5.2 | **Gallery URLs are `/g/<slug>`** (index question 2, proposed). `worker.ts` matches the prefix before Next loads (Phase 6); no reserved words, no clash with `/admin`, `/api`, `/_next`, `robots.txt`. | The cheapest route to serve on the free plan; the mockup's root form can be added later as a redirect on a gallery-only domain. |
| D5.3 | **A slug is readable plus random**: from the name (`maria-jonas`, ASCII-folded, Cyrillic transliterated, ≤ 40) + `-` + 6 characters of `[a-z2-9]` (≈ 31 bits), editable (`[a-z0-9-]`, 3–60, UNIQUE). Removing the random part on a link-access gallery shows a warning. | With "anyone with the link", the link is the key; the name alone is guessable. |
| D5.4 | **Processing is fixed at creation**: purpose, display and thumbnail sizes and quality, the watermark (a snapshot of Phase 4's, D4.3) and the delivery mode are copied into the gallery's `settings`; every later upload uses them. Changing them = a new gallery (or Phase 5 M4's *reprocess*, which re-runs the pipeline from the originals in the photographer's browser). | The files are baked; a gallery whose photos disagree in size or watermark is worse than a re-create. Answers the placeholder's "display size after upload" question. |
| D5.5 | **The browser pipeline**: a pool of `min(4, max(1, hardwareConcurrency − 1))` module Web Workers. Per file: sniff the type from the bytes; SHA-256 (`crypto.subtle`); read EXIF (our reader, D5.6); decode with `createImageBitmap(blob, { imageOrientation: 'from-image' })`; resize by `drawImage` on an `OffscreenCanvas` with `imageSmoothingQuality = 'high'`, halving in steps while the ratio is above 2 (no reliance on resize options); `applyWatermark` (Phase 4); `convertToBlob({ type: 'image/webp', quality })`, and **JPEG** when the browser returns another type; the placeholder = the average colour of an 8 px copy. No WebAssembly. Derivatives carry no metadata (canvas output). | Native APIs only, the same result in Chrome, Firefox and Safari; no Worker CPU spent on images. |
| D5.6 | **The original is uploaded byte-for-byte except GPS** (index → Uploads): our own lossless metadata editor `lib/images/metadata/` — JPEG: in the EXIF APP1 the GPS IFD's entries and values are zeroed and the IFD0 `GPSInfo` (0x8825) entry removed by shifting the entry list (count − 1), and the Exif IFD's `MakerNote` (0x927C, vendor data that may hold coordinates) treated the same way; an XMP APP1 packet that mentions `exif:GPS` is dropped; PNG: the `eXIf` chunk gets the same TIFF edit (CRC recomputed), an `iTXt`/`zTXt` XMP chunk with GPS dropped; WebP: the `EXIF` chunk edited, an `XMP ` chunk with GPS dropped (RIFF sizes fixed). The same reader returns orientation, `DateTimeOriginal`, camera and lens. A file whose metadata cannot be parsed is **refused** ("cannot remove location data"), never uploaded unchanged. `exifr` is a dev dependency only, to check our output independently in tests. | No re-encoding (quality kept), ~300 lines of table-tested code, no runtime dependency; refusing beats leaking a client's home address. |
| D5.7 | **Keys**: original `galleries/<galleryId>/<photoId>/original.<jpg\|png\|webp>` in `memoria-originals`; derivatives `galleries/<galleryId>/<photoId>/<rev>/thumb.<webp\|jpg>` and `…/display.<ext>` in `memoria-media`, `rev` = 8 random `[a-z2-9]` per processing. All generated by the server at registration. | A new `rev` busts the CDN cache when a photo is replaced (M4); ids are UUIDs, so keys are not enumerable. |
| D5.8 | **Two-phase upload, ≤ 10 photos per request.** `POST …/uploads` inserts `photos` rows (`status = 'uploading'`) and returns three signed PUTs each; the browser PUTs; `POST …/uploads/complete` `head()`s the three objects of each photo (exists, size ≤ minted and = declared, type = minted, original ≤ `MAX_UPLOAD_BYTES`, derivatives ≤ 10 MB) and marks it `ready`. A photo that fails `head()` stays `uploading` (the browser retries its PUTs once, then reports it). | 30 `head()`s and ≤ 30 signatures per request keep inside 50 subrequests and the CPU budget; one INSERT per photo keeps under D1's 100 parameters. |
| D5.9 | **Dedupe and resume by content**: `UNIQUE (gallery_id, sha256)` (of the file as dropped). Registering a known hash returns `duplicate` for a `ready` photo and **re-mints** the URLs for an `uploading` one. Dropping the same folder again finishes an interrupted upload; no IndexedDB in M1–M3. | Resume without client storage; the database enforces it, never a read-check-write. |
| D5.10 | **Columns for what is queried, one `settings` JSON for the rest.** `galleries` keeps slug, title, status, purpose, access, delivery, counts, cover and timestamps as columns; `settings` (JSON, parsed by the pure `parseGallerySettings` with a default per field) holds sizes, watermark snapshot, theme, accent, font, grid, sort, welcome note. Phases 7, 9 and 10 add fields to it. | Later phases add options without migrations; invalid stored settings read as defaults (logged), never a broken gallery. |
| D5.11 | **The gallery password is sealed, not hashed**: `password_sealed` = `settingsCipher.encrypt(password, 'gallery.<id>.password')`; the photographer sees it in the sharing panel and the email; Phase 6's gate decrypts and compares in constant time. A change bumps `password_version` (Phase 6's access cookies carry it). Passwords: 4–64 characters, a "Generate" (two words + two digits). | It is a shared, shown password, not a credential: PBKDF2 on a public path would cost the CPU budget for nothing. A D1 export alone does not reveal it. |
| D5.12 | **Every content change bumps `galleries.content_version`** in the same batch (photo registered, hidden, moved, deleted, cover, sets, settings, publish). | Phase 6 caches a gallery's JSON by `(id, content_version)`: a change is visible at once without purging anything. |
| D5.13 | **Counts are stored, recomputed in the batch of the change**: `galleries.photo_count`, `bytes_total` and `photo_sets.photo_count` (visible ready photos) are set from an indexed `count(*)` over that gallery or set by the statement after the change. | No `count(*)` on a client request; the admin write pays (rows read = the gallery's photos, an admin-only path), and a drift heals at the next change. |
| D5.14 | **Heavy lists render in the browser.** The manager's grid and the galleries list fetch JSON pages (`GET …/photos?set_id=&cursor=`, ≤ 200 per page); server components render only the shell. Thumbnails come from `publicUrl(key)` (a string join), or the dev read route locally. | A server render of 800 thumbnails would cost tens of ms of CPU per page view; the JSON is ~0.5 ms. |
| D5.15 | **Production shows images only through the public media domain** (`MEDIA_PUBLIC_BASE_URL`, an R2 custom domain; the `r2.dev` URL is acceptable for a trial only). Without it the manager shows placeholders and a notice. Never presigned GETs for thumbnails. | Presigned URLs are unique per call (no CDN cache) and cost a signature each. |
| D5.16 | **The CSP learns the media origins at build time** from `apps/web/wrangler.jsonc` `vars`: `next.config.mjs` reads `MEDIA_PUBLIC_BASE_URL` (→ `img-src`) and `MEDIA_S3_ENDPOINT` (→ `connect-src`, the presigned PUTs to both buckets) and passes them to `contentSecurityPolicy({ dev, media })`; `headers.test.ts` gains rows; the guard `wrangler-config` checks both are origins (scheme + host, no path). | The headers are computed at build; both values are plain vars in a committed file, so no runtime header rewriting. |
| D5.17 | **Delete is soft, purge is a job.** Deleting a gallery sets `deleted_at` (it disappears from lists and clients at once) and enqueues `gallery.purge` with `runAfter` = +7 days and `ref = gallery:<id>`; **Restore** clears `deleted_at` and cancels the job. Deleting photos sets `status = 'deleted'` and enqueues `media.purge`. Purging is **row-driven** (keys are derived from rows; no bucket listing): ≤ 90 photos per run (objects in both buckets by `delete(keys)`, then the rows by id, under 100 parameters), and a run that leaves work enqueues the next one. Housekeeping enqueues one `media.purge` a day for `uploading` rows older than 24 h. | Recoverable mistakes; bounded CPU per relay invocation (one job, 10 ms); no `list` operations (Class A); orphans cannot appear because a presigned PUT expires in 10 minutes and purges start after 24 h. |
| D5.18 | **Foreign keys without cascade**: `photo_sets.gallery_id`, `photos.gallery_id` and `photos.set_id` reference their parents; purges delete photos, then sets, then the gallery. | The schema refuses orphans; deleting in order is what the purge does anyway, and a cascade would hide row-write costs. |
| D5.19 | **Status = `draft` \| `published`**; a draft is invisible to clients (Phase 6 answers 404). Publishing sets `published_at`; unpublishing returns to draft. Scheduled publish and expiry are Phase 10 (their columns come with it). | The smallest lifecycle that lets the photographer upload before sharing. |
| D5.20 | **The client email is a template, sent by the relay**: `gallery.ready` (`{ galleryTitle, clientName?, path, password? }`, the password only when the photographer ticks "include the password"); the sharing panel previews it with `renderEmail` and enqueues `emailJobStatement` with an audit row in one batch, then `nudgeRelay()`. Rate limit 20 an hour. | Phase 3's rules (only the relay sends; links through `ctx.link`); the photographer typed the address, so D3.15's visitor caps do not apply. |
| D5.21 | **Image delivery `protected` is stored but not offered** until Phase 6 M2 (Phase 4 D4.13). | The column exists from the start; no option promises what is not built. |

## Design

### Topology

```
photographer's browser                                   memoria (Next)                     R2
  drop files ─► pool of Web Workers                        POST /api/admin/galleries/:id/uploads
    sniff · sha256 · EXIF · strip GPS ─────────────────►     rows 'uploading' + 3 signed PUTs ──┐
    decode · resize · watermark · encode                                                       │
  PUT original ───────────────────────────────────────────────────────────────────────────────►│ memoria-originals (private)
  PUT thumb, display ─────────────────────────────────────────────────────────────────────────►│ memoria-media (public domain)
  POST …/uploads/complete ─────────────────────────────►   head() ×3 → 'ready', counts,
                                                           content_version + 1
memoria-relay: gallery.purge (deleted galleries, +7 d) · media.purge (deleted photos, stale uploads)
```

### Data: `migrations/0006_galleries.sql`

```sql
CREATE TABLE galleries (
  id               TEXT NOT NULL,
  slug             TEXT NOT NULL,
  title            TEXT NOT NULL,
  shoot_date       TEXT,                              -- YYYY-MM-DD
  client_name      TEXT,
  client_email     TEXT,
  purpose          TEXT NOT NULL,                     -- selection | sharing
  status           TEXT NOT NULL DEFAULT 'draft',     -- draft | published
  access           TEXT NOT NULL,                     -- link | password
  password_sealed  TEXT,                              -- D5.11
  password_version INTEGER NOT NULL DEFAULT 1,
  delivery         TEXT NOT NULL DEFAULT 'public',    -- public | protected (Phase 6 M2)
  settings         TEXT NOT NULL DEFAULT '{}',        -- D5.10
  cover_photo_id   TEXT,                              -- no FK: a photo may be purged first; read through a join
  photo_count      INTEGER NOT NULL DEFAULT 0,
  bytes_total      INTEGER NOT NULL DEFAULT 0,
  content_version  INTEGER NOT NULL DEFAULT 1,        -- D5.12
  published_at     TEXT,
  deleted_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_galleries PRIMARY KEY (id),
  CONSTRAINT uq_galleries_slug UNIQUE (slug),
  CONSTRAINT ck_galleries_slug CHECK (length(slug) BETWEEN 3 AND 60 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-'),
  CONSTRAINT ck_galleries_title CHECK (length(title) BETWEEN 1 AND 120),
  CONSTRAINT ck_galleries_purpose CHECK (purpose IN ('selection', 'sharing')),
  CONSTRAINT ck_galleries_status CHECK (status IN ('draft', 'published')),
  CONSTRAINT ck_galleries_access CHECK (access IN ('link', 'password')),
  CONSTRAINT ck_galleries_password CHECK ((access = 'password') = (password_sealed IS NOT NULL)),
  CONSTRAINT ck_galleries_delivery CHECK (delivery IN ('public', 'protected')),
  CONSTRAINT ck_galleries_settings CHECK (json_valid(settings) AND length(settings) <= 16384),
  CONSTRAINT ck_galleries_published CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT ck_galleries_counts CHECK (photo_count >= 0 AND bytes_total >= 0 AND content_version >= 1)
);
CREATE INDEX ix_galleries_created_at ON galleries (deleted_at, created_at);

CREATE TABLE photo_sets (
  id          TEXT NOT NULL,
  gallery_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  photo_count INTEGER NOT NULL DEFAULT 0,             -- D5.13
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_photo_sets PRIMARY KEY (id),
  CONSTRAINT fk_photo_sets_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id),
  CONSTRAINT ck_photo_sets_name CHECK (length(name) BETWEEN 1 AND 60),
  CONSTRAINT ck_photo_sets_counts CHECK (position >= 0 AND photo_count >= 0)
);
CREATE INDEX ix_photo_sets_gallery_position ON photo_sets (gallery_id, position);

CREATE TABLE photos (
  id             TEXT NOT NULL,
  gallery_id     TEXT NOT NULL,
  set_id         TEXT NOT NULL,
  filename       TEXT NOT NULL,                       -- the photographer's filename (metadata only)
  content_type   TEXT NOT NULL,                       -- of the original
  bytes          INTEGER NOT NULL,                    -- original + derivatives
  width          INTEGER NOT NULL,                    -- oriented pixels of the original
  height         INTEGER NOT NULL,
  taken_at       TEXT,                                -- EXIF DateTimeOriginal as written (local, no zone)
  sha256         TEXT NOT NULL,                       -- D5.9
  rev            TEXT NOT NULL,                       -- D5.7
  derivative_ext TEXT NOT NULL,                       -- webp | jpg
  display_width  INTEGER NOT NULL,
  display_height INTEGER NOT NULL,
  color          TEXT NOT NULL,                       -- placeholder #RRGGBB
  meta           TEXT NOT NULL DEFAULT '{}',          -- camera, lens, focal, aperture, shutter, iso
  status         TEXT NOT NULL DEFAULT 'uploading',   -- uploading | ready | deleted
  hidden         INTEGER NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL,                    -- order of arrival in its set (custom order: M4)
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_photos PRIMARY KEY (id),
  CONSTRAINT fk_photos_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id),
  CONSTRAINT fk_photos_set FOREIGN KEY (set_id) REFERENCES photo_sets (id),
  CONSTRAINT uq_photos_gallery_sha256 UNIQUE (gallery_id, sha256),
  CONSTRAINT ck_photos_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_photos_sha256 CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT ck_photos_rev CHECK (length(rev) = 8 AND rev NOT GLOB '*[^a-z2-9]*'),
  CONSTRAINT ck_photos_ext CHECK (derivative_ext IN ('webp', 'jpg')),
  CONSTRAINT ck_photos_status CHECK (status IN ('uploading', 'ready', 'deleted')),
  CONSTRAINT ck_photos_hidden CHECK (hidden IN (0, 1)),
  CONSTRAINT ck_photos_filename CHECK (length(filename) BETWEEN 1 AND 255),
  CONSTRAINT ck_photos_meta CHECK (json_valid(meta) AND length(meta) <= 2048),
  CONSTRAINT ck_photos_dims CHECK (width > 0 AND height > 0 AND display_width > 0 AND display_height > 0 AND bytes > 0)
);
CREATE INDEX ix_photos_set_order ON photos (set_id, status, position);
CREATE INDEX ix_photos_gallery_status ON photos (gallery_id, status);
CREATE INDEX ix_photos_status_created_at ON photos (status, created_at);

CREATE INDEX ix_jobs_ref ON jobs (ref);               -- left for this phase by p03
```

- `taken_at` is EXIF's wall-clock text normalised to `YYYY-MM-DDTHH:MM:SS` (no zone; sort only).
- `ix_photos_status_created_at` serves the purges (`deleted`, stale `uploading`).
- Query modules: `lib/db/queries/galleries/` (`types.ts` with `GalleryRow` and `toGalleryRow` — the
  settings parsed, the sealed password never leaves the module except to `lib/galleries/password.ts`;
  `read.ts`: `getGallery(id)`, `getGalleryBySlug(slug)`, `listGalleries({ cursor, limit })`; `write.ts`:
  `insertGalleryStatement`, `updateGalleryStatement` (`WHERE id = ? AND deleted_at IS NULL`),
  `bumpContentStatement`, `recountGalleryStatement`, `softDeleteGalleryStatement`, `restoreGalleryStatement`,
  `deleteGalleryStatement` (purge)), `photo_sets/`, `photos/` (`insertUploadingPhotoStatement` with
  `ON CONFLICT (gallery_id, sha256) DO NOTHING`, `markReadyStatement` `WHERE id = ? AND status = 'uploading'`,
  `listSetPhotos({ setId, cursor, limit })`, `listPurgeablePhotos({ galleryId? , before, limit })`,
  `bulk*Statement` by id lists of ≤ 90), each with its `<table>.test.ts` on a test D1.

### Writes that must not race

| Write | SQL | Guarantee |
| --- | --- | --- |
| Create gallery | `batch([insert gallery, insert set 'Photos' position 0, audit])`; a slug clash → `UNIQUE` → 409 `SLUG_TAKEN` (the form suggests a new random part) | no read-check-write on the slug |
| Register photo | `INSERT INTO photos (…) VALUES (…) ON CONFLICT (gallery_id, sha256) DO NOTHING RETURNING id` per photo (position = `(SELECT coalesce(max(position), -1) + 1 FROM photos WHERE set_id = ?)`), then `SELECT id, status FROM photos WHERE gallery_id = ? AND sha256 IN (…)` for the conflicts | a duplicate never creates a row; an `uploading` conflict is re-minted, a `ready` one reported |
| Complete | per photo `UPDATE photos SET status = 'ready', updated_at = ? WHERE id = ? AND gallery_id = ? AND status = 'uploading'`; then `recountGallery`, `recountSet` for touched sets, `content_version = content_version + 1` — one batch | idempotent: a second complete changes nothing |
| Move / hide / delete photos | one `UPDATE … WHERE gallery_id = ? AND id IN (≤ 90 ids) AND status = 'ready'` + recounts + bump + audit (`{ count }`) in one batch | a photo of another gallery is never touched |
| Set cover | `UPDATE galleries SET cover_photo_id = ? … WHERE id = ? AND EXISTS (SELECT 1 FROM photos WHERE id = ? AND gallery_id = ? AND status = 'ready')` | a cover always belongs to the gallery |
| Reorder sets | one `UPDATE photo_sets SET position = ? WHERE id = ? AND gallery_id = ?` per set (≤ 50) + bump | positions are rewritten whole |
| Delete set | `DELETE FROM photo_sets WHERE id = ? AND gallery_id = ? AND NOT EXISTS (SELECT 1 FROM photos WHERE set_id = ? AND status != 'deleted') AND (SELECT count(*) FROM photo_sets WHERE gallery_id = ?) > 1` → 0 changes = 409 `SET_NOT_EMPTY` | never the last set, never one with photos |
| Soft delete / restore | `UPDATE galleries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL` + `gallery.purge` job (`runAfter` +7 d, `ref`) + audit; restore: `UPDATE … SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL` + `cancelPendingJobsStatement({ ref })` + audit | a restore after the purge started finds no row (404) |

### Ports and buckets (D5.1)

- `Platform.blobs(bucket: BucketName = 'media')`; `BucketName = 'media' | 'originals'`. Cloudflare:
  `r2BlobStore(env.MEDIA)` / `r2BlobStore(env.ORIGINALS)`; the test platform: one in-memory store per
  bucket; the contract suite runs both.
- `Config.media.s3` gains `originalsBucket` (var `MEDIA_S3_ORIGINALS_BUCKET`, `memoria-originals`);
  `blobUrls` takes `{ bucket }` on `uploadUrl` / `readUrl` (S3: the bucket in the path; dev: the token
  carries `b: 'm' | 'o'`, the dev routes pick the binding). `publicUrl` refuses `originals` (throws: a
  programming error).
- `wrangler.jsonc` (both Workers): `r2_buckets` += `{ "binding": "ORIGINALS", "bucket_name": "memoria-originals" }`;
  app `vars` += `MEDIA_S3_ORIGINALS_BUCKET`; `cf-typegen`. Guard `wrangler-config`: the var equals the
  `ORIGINALS` bucket; both Workers bind the same two buckets.
- `apps/web/r2-cors-originals.json`: PUT and GET from the app origins, `content-type`, exposes
  `Content-Length`, `Content-Disposition`. deployment.md → Media: create the second bucket (same
  location), apply its CORS, widen the API token to both buckets, **no public domain**.

### Settings and the slug (`apps/web/src/lib/galleries/`)

- `parseGalleryInput.ts` (pure, shared with the form): title, date, client name (≤ 80, control/bidi
  stripped), client email (`parseEmailAddress`), purpose, access + password, sizes (bounds of Phase 4's
  `Size`), watermark flag (only if a watermark exists), theme/accent/font (registry ids), grid.
- `gallerySettings.ts`: `GallerySettings` type and `parseGallerySettings(json)` (each field defaulted:
  a stored setting that no longer parses reads as its default and logs `gallery_settings_invalid`);
  `newGallerySettings(defaults, branding, watermark, input)` = the snapshot (D5.4).
- `slug.ts` (pure): `slugBase(title)` (NFKD, Bulgarian/Russian transliteration table, `[a-z0-9-]`,
  ≤ 40), `slugSuffix()` (6 of `[a-z2-9]` from `crypto.getRandomValues`), `isSlug`.
- `password.ts` (server-only): `sealGalleryPassword(id, plain)`, `openGalleryPassword(gallery)`,
  `generateGalleryPassword()`.
- `keys.ts` (pure, relay-safe): `originalKey(g, p, type)`, `thumbKey(g, p, rev, ext)`,
  `displayKey(g, p, rev, ext)`, `photoKeys(row)`.

### Routes

| Route | Does |
| --- | --- |
| `POST /api/admin/galleries` | parse → create (D5.3 slug; one set) → `{ data: { id, slug } }` |
| `GET /api/admin/galleries?cursor=` | ≤ 50 galleries (not deleted), newest first, with the cover's thumb URL |
| `PATCH /api/admin/galleries/[id]` | title, date, client, slug, theme/accent/font/grid, welcome note, sort, access + password (`password_version + 1` on change); not the processing fields (D5.4) |
| `POST /api/admin/galleries/[id]/publish` · `…/unpublish` | status + bump + audit |
| `DELETE /api/admin/galleries/[id]` · `POST …/restore` | D5.17 |
| `POST /api/admin/galleries/[id]/sets` · `PATCH/DELETE …/sets/[setId]` · `PUT …/sets/order` | sets |
| `GET /api/admin/galleries/[id]/photos?set_id=&cursor=` | ≤ 200 photos (`ready` and `uploading`), JSON: id, filename, w, h, thumb URL, hidden, status, color |
| `POST /api/admin/galleries/[id]/photos/bulk` | `{ action: 'move' \| 'hide' \| 'show' \| 'delete', ids ≤ 90, setId? }` |
| `PUT /api/admin/galleries/[id]/cover` | `{ photoId }` |
| `POST /api/admin/galleries/[id]/uploads` | `{ setId, photos: ≤ 10 × { filename, contentType, sha256, bytes: { original, thumb, display }, width, height, displayWidth, displayHeight, derivativeExt, takenAt, color, meta } }` → per photo `{ sha256, status: 'new' \| 'resume' \| 'duplicate', photoId?, uploads?: { original, thumb, display } }`; rate limit 600 an hour |
| `POST /api/admin/galleries/[id]/uploads/complete` | `{ photoIds ≤ 10 }` → `head()` ×3 each (D5.8) → `{ ready: [], failed: [{ id, reason }] }` |
| `POST /api/admin/galleries/[id]/email` | `{ to, name?, includePassword }` → `gallery.ready` email job + audit, nudge (D5.20); 20 an hour |
| `GET /api/admin/galleries/[id]/email-preview?include_password=` | `renderEmail('gallery.ready', …)` → `{ subject, html, text }` (the HTML shown in a sandboxed `iframe srcdoc`) |

All: `requireAdmin` first; `isUuid` on every id; the gallery must exist and not be deleted (404);
writes audited (`create`/`update`/`delete` on entity `gallery` with ids and counts, never a password or
an address).

### The browser pipeline (`apps/web/src/lib/images/`, client-only)

```
sniff.ts         magic bytes → 'image/jpeg' | 'image/png' | 'image/webp' | { unsupported: 'heic' | 'tiff' | 'raw' | 'gif' | 'video' | 'other' }
metadata/        tiff.ts (IFD walker: read tags, zero the GPS IFD, drop the 0x8825 entry), jpeg.ts, png.ts, webp.ts
                 (segment/chunk editors), xmp.ts (has GPS?), read.ts (orientation, taken, camera…), strip.ts (D5.6)
resize.ts        targetSize(w, h, longEdge) (never upscales), drawResized(bitmap, size) with step-halving
encode.ts        encode(canvas, quality) → { blob, ext } (WebP, else JPEG; result type checked)
placeholder.ts   averageColor(bitmap) → '#RRGGBB'
watermark.ts     Phase 4
process.worker.ts  per file: the steps of D5.5 → { original, thumb, display, sha256, dims, takenAt, color, meta }
pool.ts          worker pool, transferables, cancellation
uploader.ts      the queue: process → register (batches of 10) → PUT (4 parallel, 1 retry) → complete (batches of 10); events for the UI
```

- A file over `MAX_UPLOAD_BYTES` or with more than 100 megapixels is refused before decoding.
- `targetSize` never upscales: a 1200 px upload in a 1600 px selection gallery gets a 1200 px display copy
  (the original is still never served, D5.7 + Phase 6).
- Memory: one decoded bitmap per worker at a time, closed after encoding; transfers, not copies.
- The page warns on `beforeunload` while uploading; the uploader is a module-level store the manager
  subscribes to (`useSyncExternalStore`), so switching sets keeps it running.

### Screens

- **Galleries** (`/admin/galleries`): `PageHeader` with *New gallery*; a grid of cards (cover thumb,
  title, a status pill — Draft/Live, purpose, count, date); empty state with a call to action; paged
  client-side.
- **New gallery** (`/admin/galleries/new`): one column of `SettingsCard`-like sections matching the
  mockup's order: Details (name, date, client name, client email, gallery address = the slug with its
  random part, editable), Purpose (radio cards; the display size and quality under "Advanced", from the
  defaults), Who can open it (Link / Password + Generate), Look (theme, accent, font with the gallery
  title as the sample, grid), Watermark (Toggle, a thumbnail of the studio watermark). The mockup's
  right column shows a live **cover preview** (title in the chosen font and theme) and the **email
  preview** (D5.20; enabled after creation). **Create gallery** → the manager.
- **Gallery manager** (`/admin/galleries/[id]`): header (title, status pill, counts, *View as client*,
  *Add photos*, *Share*); Tabs *Photos* · *Settings* (Selections, Downloads, Activity come with Phases
  8, 9, 11; Store never); left rail: sets (drag handle + up/down buttons for keyboard, rename inline,
  *Add set*); main: the drop zone (collapsed when the set has photos), the upload panel (counts, bytes,
  ETA, duplicates skipped, unsupported files with reasons, failed with Retry), the grid (thumbs at
  their aspect ratio, `loading="lazy"`, a checkbox per photo, Shift-click ranges, badges *Cover* and
  *Hidden*), the bulk bar when something is selected (Move to set, Hide/Show, Set as cover — one photo,
  Delete with a confirm dialog), sort (capture time, filename).
- **Sharing panel** (a `Dialog` from *Share*): Publish / Unpublish; the link with Copy and a QR code
  (`uqr` SVG, downloadable); the password (shown, Copy, Change); *Email the client* (address defaulted
  from the gallery, name, "include the password", a preview, Send → a status line like Phase 3's).
- **Delete** (manager → Settings tab): a danger card; the confirm dialog asks for the gallery's title;
  a deleted gallery shows in the list's *Deleted* filter with *Restore* and the purge date.

### Jobs (relay-safe, `apps/web/src/lib/galleries/purge.ts`)

- `media.purge` (v1, payload `{}`; 5 attempts, priority 1, backoff 5, 30, 120 min): `listPurgeablePhotos`
  = `status = 'deleted'`, or `uploading` older than 24 h, ≤ 90 ordered by `created_at`; delete their
  original keys (`blobs('originals').delete`) and derivative keys (`blobs('media').delete`); then
  `DELETE FROM photos WHERE id IN (…) AND status IN ('deleted', 'uploading')`, recount the touched galleries
  and sets; if 90 were found, enqueue another `media.purge` in the same batch.
- `gallery.purge` (v1, `{ galleryId }`, `ref = gallery:<id>`): does nothing unless the gallery's
  `deleted_at` is set and older than 7 days (a restore cancelled it, or a clock skew); purges ≤ 90 of its
  photos as above; when none are left, `batch([DELETE photo_sets …, DELETE galleries …, audit])`;
  otherwise enqueues the next `gallery.purge`.
- `housekeeping` gains a step: enqueue one `media.purge` when stale `uploading` or `deleted` rows exist
  (one indexed `EXISTS`).
- Both kinds registered before the app enqueues them (deploy order: relay first, D3.14).

### Email (`lib/email/templates/galleryReady.ts`)

`gallery.ready`: subject "{galleryTitle} — your photos are ready" (the title escaped and stripped of
control characters; the client's name never in the subject, D3.15's rule kept anyway); body: a greeting
(with the client's name when given), one paragraph from the gallery's purpose ("Choose your favourites
and submit your selection" / "Your photos are ready to view and download"), the password when ticked, a
button to `ctx.link(path)`; text and HTML. Phase 4 M2 makes the text editable.

### Primitives (T5.9)

`scrim` colour token (`rgb(22 23 26 / <alpha-value>)`, count badges on photos), the selectable `Chip`
(`packages/ui/chip.tsx`, pill, 1.5 px border, 44 px on coarse pointers; set chips, filters), `Tabs`
(`packages/ui/tabs.tsx`, roving tabindex, `aria-selected`); each on `/admin/design` with contrast rows.

## Workstreams

### A. Storage (M1)

- **T5.1** The originals bucket: port `blobs(bucket)`, the test platform and contract runs per bucket,
  `blobUrls` `{ bucket }`, dev token bucket, `Config.media.s3.originalsBucket`, both `wrangler.jsonc`,
  `cf-typegen`, guard rules, `r2-cors-originals.json`, deployment.md → Media; CSP media origins
  (D5.16) with `headers.test.ts` rows.

### B. Galleries (M1)

- **T5.2** Migration `0006_galleries.sql`; query modules `galleries`, `photo_sets`, `photos` with their
  race tests.
- **T5.3** `lib/galleries` (settings, slug, password, keys, `parseGalleryInput`); the create/list/patch/
  publish routes; the Galleries list and New gallery pages; nav entries drop `soonPhase`; T5.9 `Chip`.

### C. Upload (M2)

- **T5.4** The pipeline libraries (`sniff`, `metadata/*`, `resize`, `encode`, `placeholder`), the worker,
  the pool — pure parts table-tested with fixture files (`apps/web/src/lib/images/fixtures/`: small JPEG,
  PNG, WebP with GPS in EXIF and XMP, rotated, without metadata, truncated).
- **T5.5** The upload routes; `uploader.ts`; the drop zone and upload panel in the manager.

### D. Manager, sharing, delete (M3)

- **T5.6** Sets, the photos API, the grid, selection, the bulk bar, cover, sort; `Tabs`, `scrim`.
- **T5.7** Sharing panel: publish, link, QR, password; `gallery.ready` template, preview, send.
- **T5.8** Soft delete, restore, `media.purge`, `gallery.purge`, the housekeeping step, the Deleted
  filter.

### E. After the first usable version (M4)

- **T5.10** Presets in New gallery (Phase 4 M2) and "Save as preset".
- **T5.11** Folder drop (`webkitGetAsEntry`: subfolders → sets) and auto-split by capture-time gaps
  (pure `splitByGaps(photos, minGapMinutes)`; suggested, confirmed by the photographer).
- **T5.12** *Replace with edited version*: matched by filename (without extension) or picked; a new
  `rev`, the same photo id (favourites and comments stay), the old objects purged; the original
  replaced.
- **T5.13** Smart filters (hidden; favourites and comments with Phase 7), custom drag order, draft
  autosave, IndexedDB resume, *reprocess* (D5.4).

### F. Docs (each in its commit)

- Commit 1: `architecture.md` → Media (two buckets, which holds what, D5.1), deployment.md → Media
  (second bucket, token, CORS), AGENTS.md → Media rules (originals only in `memoria-originals`;
  `blobs(bucket)`), recipes.md → *A binding* note on per-bucket stores.
- Commit 2: `architecture.md` → Data (the three tables).
- Commit 4: `architecture.md` → *Upload* (the pipeline and the two-phase flow), AGENTS.md → Where to
  look (`lib/images/`, `lib/galleries/`).
- Commit 7: `architecture.md` → Jobs (the purge kinds).

## Tests

| Test | What |
| --- | --- |
| `queries/galleries/galleries.test.ts` | create + read back; slug UNIQUE → conflict; every CHECK refuses its bad row (slug shapes, purpose, status/published pair, access/password pair, delivery, settings JSON and size, negative counts); `listGalleries` excludes deleted, pages by `created_at`; soft delete twice → one change; restore after purge → 0 changes; cover only for a ready photo of the same gallery; recount equals the real count after mixed changes; `content_version` bumps by exactly one per batch |
| `queries/photo_sets/photo_sets.test.ts` | FK refuses an unknown gallery; reorder rewrites positions; delete refuses the last set and a set with photos |
| `queries/photos/photos.test.ts` | insert; duplicate sha256 → no row, `RETURNING` empty; FKs refuse an unknown set or gallery; mark ready only from `uploading`, twice → once; bulk statements touch only the gallery's ready photos and refuse > 90 ids; `listSetPhotos` order and cursor; purgeable = deleted or stale uploading, bounded; CHECKs (type, sha256, rev, ext, status, hidden, dims, meta) |
| `lib/galleries/slug.test.ts` | table: Latin, Cyrillic (Bulgarian and Russian), diacritics, emoji, empty → `gallery`, 120 characters → ≤ 40 + suffix; suffix alphabet and length |
| `lib/galleries/gallerySettings.test.ts` | each field's default; an invalid field reads as its default and logs once; the snapshot copies defaults, branding and watermark |
| `lib/galleries/password.test.ts` | seal/open round trip; another gallery's AAD → null; generated passwords' shape |
| `lib/images/sniff.test.ts` | table of magic bytes: JPEG, PNG, WebP (lossy, lossless, extended), HEIC, TIFF, CR2/NEF, GIF, MP4, text |
| `lib/images/metadata/*.test.ts` | fixtures: GPS removed from EXIF (the IFD0 count one less, the GPS bytes zero), XMP with GPS dropped, XMP without kept, PNG `eXIf` CRC valid, WebP RIFF size valid; **pixel data byte-identical** (the scan data / IDAT / VP8 chunk hash unchanged); `exifr` reads no latitude/longitude from any output; orientation, `DateTimeOriginal`, camera read; truncated or malformed metadata → refused |
| `lib/images/resize.test.ts` | `targetSize` table (landscape, portrait, square, smaller than the target → unchanged); halving steps count |
| `lib/images/uploader.test.ts` | with fake processing and fetch: batches of 10; duplicates counted; `resume` re-PUTs; a failed PUT retried once then reported; complete only for PUT-successful photos; cancel stops the queue; events in order |
| route tests | 401/403 everywhere; ids not UUID → 404; deleted gallery → 404; create: 400 per field, slug conflict 409, audit without password; uploads: > 10 photos 400, type outside `MEDIA_TYPES` 400, sizes over the limits 400, keys under the gallery's prefix in the right buckets (test platform), duplicate/resume statuses, 429; complete: missing object → failed `UPLOAD_MISSING`, wrong size/type → failed and the object deleted, success → ready + counts + `content_version`; bulk: move to a set of another gallery → 400; email: job enqueued with `gallery.ready`, audit without the address, one nudge, password only when asked, 429; preview equals `renderEmail` |
| `galleries/purge.test.ts` | runner + test D1 + in-memory buckets: `media.purge` deletes both buckets' keys then rows, recounts, chains when 90 found, ignores a ready photo; `gallery.purge` waits until 7 days, refuses a restored gallery, chains, finally deletes sets and the gallery with an audit row; housekeeping enqueues only when work exists |
| `email/galleryReady.test.ts` | escaping of title and name; password only when given; link through `ctx.link`; no name in the subject |
| platform tests | `blobs('originals')` and `blobs('media')` are distinct stores (contract suite per bucket, workerd and memory); `blobUrls` signs the originals bucket path; dev token bucket honoured by the dev routes; `publicUrl` on originals throws |
| guards | `wrangler-config`: `MEDIA_S3_ORIGINALS_BUCKET` = the `ORIGINALS` binding, both Workers bind both buckets, media vars are origins; `relay-graph` still passes with `lib/galleries/purge.ts` |
| component tests | New gallery: defaults prefilled, password Generate, slug preview and warning; manager: selection with Shift, bulk bar actions call the API and refresh, set rename/reorder by keyboard; upload panel states; sharing: copy, QR rendered, email preview shown in a sandboxed iframe; `Chip`, `Tabs` (keyboard) |

## Risks and edge cases

- **Admin CPU on the free plan.** Every screen and API route here runs through Next (page ≈ 8 ms, route
  ≈ 6 ms measured, before any work). Registration signs up to 30 URLs and completion makes up to 30
  `head()`s: measure both with `npm run measure:cpu` after M2 and lower the batch size if p95 > 10 ms.
  The owner's Phase 6 decision (Workers Paid or not) covers the admin too.
- **R2 storage**: an 800-photo wedding at ~1 MB per Lightroom export + ~300 KB display + ~70 KB thumbnail
  ≈ 1.1 GB; the free 10 GB holds about nine such galleries, then $0.015 per GB-month (100 GB ≈ $1.4 a
  month). Uploads: 3 Class A operations per photo (2,400 per wedding against 1M a month).
- **D1 budget**: an 800-photo upload writes ~800 rows + ~160 recount statements; deleting it writes
  ~800 more; all far inside 100k a day. Rows read by recounts ≤ the gallery's size per batch.
- **GPS in unexpected places**: vendor MakerNotes can hold coordinates and cannot be parsed reliably,
  so the MakerNote (0x927C) is zeroed and its entry dropped like `GPSInfo` (D5.6); Lightroom exports
  rarely carry one. Place names (IPTC/XMP city, location) are text the photographer chose to export and
  are kept: only coordinates are removed, and the help says "location coordinates are removed".
- **Safari**: JPEG derivatives instead of WebP (larger files); the gallery handles both extensions.
- **Very large originals** (camera JPEGs of 40+ MP): decoding needs ~200 MB per worker; the pool shrinks
  to 2 workers when `navigator.deviceMemory` ≤ 4.
- **Colour**: canvas output is sRGB; a Display-P3 export loses its wide gamut in derivatives (the original
  keeps its profile).
- **A presigned PUT cannot enforce the size**: completion's `head()` does, and deletes an object that
  disagrees.
- **Public-mode revocation**: a former visitor who kept image URLs can still load thumbnails and display
  copies after a password change (public CDN). Protected delivery (Phase 6 M2) is the answer when that
  matters; originals are never public.
- **Slug edits break shared links**: the field warns; the old slug is not kept as a redirect in M1–M3.

## Verification

1. `npm run verify`; `npm run build:relay`.
2. **Local** (`npm run dev` + `npm run dev:relay`): create a selection gallery (watermark on) and a
   sharing gallery; drop 50 mixed files (Lightroom JPEGs, a PNG, a WebP, a HEIC, a video, a duplicate, a
   rotated photo, one with GPS in EXIF and XMP): unsupported and duplicate files reported; the rest
   ready; the downloaded original (dev read route) has no GPS (`exiftool -gps:all` empty) and identical
   pixels; display copies have the watermark and the configured long edge; the placeholder colours show
   while thumbs load. Close the tab mid-upload, drop the same files: the rest finish, nothing doubles.
   Sets, move, hide, cover, delete; delete the gallery, restore it; delete again and run the purge with
   the clock moved (`wrangler d1 execute --local` on `deleted_at`): objects gone from both local buckets,
   rows gone.
3. **Browsers**: the pipeline in current Chrome, Firefox and Safari (JPEG fallback there), recording the
   time per photo for 50 Lightroom exports.
4. **Real buckets** (after the owner's one-time setup: both buckets, CORS, the token, the public domain
   — index question 3): `npm run preview` uploads 20 photos through presigned PUTs; the public URL of a
   display copy loads; the original's key on the public domain answers 404; a PUT with another
   Content-Type is refused (Phase 1 Verification 5 included).
5. **CPU** (production, the owner deploys): `npm run measure:cpu` on the uploads and complete routes with
   10 photos and on the photos list; record the numbers here.
6. Manager and New gallery at 360 px and 1440 px; keyboard only through selection, the bulk bar and sets.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(media): the private originals bucket` | T5.1 | `npm run preview` boots with both buckets |
| 2 | `feat(galleries): galleries, sets and photos tables` | T5.2 | `db:migrate:local` |
| 3 | `feat(galleries): new gallery and the galleries list` | T5.3 | create and list locally |
| 4 | `feat(upload): the browser image pipeline` | T5.4 | fixtures pass; Verification 3 (pipeline only) |
| 5 | `feat(upload): register, upload and complete` | T5.5 | Verification 2 (upload part) |
| 6 | `feat(galleries): the gallery manager` | T5.6, T5.9 | Verification 6 |
| 7 | `feat(galleries): sharing and the gallery-ready email` | T5.7 | an email reaches Mailpit |
| 8 | `feat(galleries): delete, restore and purge` | T5.8 | Verification 2 (purge part) |
| 9 | `docs: Phase 5 M3 done` | docs | Verification 4–5 when the buckets and domain exist |

Milestones: **M1** = commits 1–3 (galleries exist), **M2** = commits 4–5 (photos upload end to end),
**M3** = commits 6–9 (managed, shared, deletable: Phase 5's part of the first usable version), **M4**
(after the first usable version) = T5.10–T5.13.

Migration `0006` ships with the first deploy after commit 2 and is forward-only from then (the relay
must be deployed with the purge kinds before the app enqueues them: commit 8's deploy order).

## Checklist

- [ ] T5.1 Originals bucket, per-bucket stores, CSP media origins
- [ ] T5.2 Migration and query modules
- [ ] T5.3 Gallery library, create/list/patch/publish, New gallery and Galleries pages, `Chip`
- [ ] T5.4 Pipeline libraries, worker, pool
- [ ] T5.5 Upload routes, uploader, drop zone and panel
- [ ] T5.6 Manager: sets, grid, selection, bulk bar, cover, sort; `Tabs`, `scrim`
- [ ] T5.7 Sharing panel and `gallery.ready`
- [ ] T5.8 Soft delete, restore, purge jobs
- [ ] Verification 1–3, 6 (4–5 once the buckets, the domain and a deploy exist)
- [ ] M4: T5.10 presets · T5.11 folders and auto-split · T5.12 replace with edited · T5.13 filters, drag order, autosave, IndexedDB, reprocess

## Open questions

For the owner:

1. **Originals bucket** (D5.1): confirm the second private bucket. It adds one-time setup: create
   `memoria-originals` (same location as `memoria-media`), apply its CORS, widen the API token to both
   buckets.
2. **Gallery URLs** (D5.2, index question 2): `/g/<slug>` for the first version?
3. **Slugs with a random part** (D5.3): `maria-jonas-k7x2qp` by default, editable?
4. **Custom domain** (index question 3): which domain and which subdomains for the app and the images?
   Needed for Verification 4 (the public media domain) and for Phase 6's page cache.
5. **Processing fixed at creation** (D5.4): acceptable that changing the display size or watermark means
   a new gallery until *reprocess* (M4)?
6. **Soft delete for 7 days** (D5.17): the right window?
7. **Storage**: originals of selection galleries are kept too (they may be delivered as they are). Fine
   with R2 billing beyond ~10 GB (≈ $1.4 a month per 100 GB)?

For the index (`plan_202611_mvp.md`, owned by the build session):

- Decisions: *Originals storage* → decided (D5.1); *Gallery URLs* → `/g/<slug>` proposed; a new row
  *Uploads resume by content hash* (D5.9).
- Architecture in brief: `memoria-originals` no longer "proposed"; the relay runs `gallery.purge` and
  `media.purge`.
- Data model: Phase 5 also adds `ix_jobs_ref`.
- To verify: Safari WebP encoding → resolved by the JPEG fallback (D5.5), still measured in
  Verification 3; presigned multipart stays unnecessary (Lightroom exports are far below 100 MB).
- Phase 5 row: M1–M3 for the first usable version; M4 after it.
