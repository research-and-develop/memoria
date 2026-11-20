---
title: "Phase 5: Galleries and upload"
type: plan
status: in-progress
updated: 2026-11-19
related: [plan_202611_mvp.md, plan_202611_p01_core_adapters.md, plan_202611_p03_relay_email.md, plan_202611_p04_studio_settings.md, plan_202611_p06_client_gallery.md, ../../architecture.md, ../../deployment.md, ../../recipes.md, ../../../AGENTS.md]
---

# Phase 5: Galleries and upload

## Goal

The photographer creates a gallery, drops a shoot (files or folders) on it and manages it: the photos
are processed **in the photographer's browser** (location data removed from the original, a thumbnail
and a display copy generated, the watermark baked), uploaded straight to R2 through presigned URLs, and
registered in D1. The photographer arranges sets, hides, moves, deletes and picks a cover, then copies
the gallery link (or emails it to the client) for Phase 6's client gallery.

**Done when (M1–M3, the part of the first usable version):**

- **New gallery** (`/admin/galleries/new`): name (the only required field), shoot date, client name and
  email, purpose (selection or sharing, with plain-language copy) and the display copy's size and
  quality, access (link or password), image delivery (public), watermark on/off, theme, accent and font
  pairing, sort (filename or capture time); prefilled from Phase 4's defaults. Create → the gallery
  manager.
- **Upload** (in the manager): drop files **or folders** (each subfolder becomes a set) or pick files;
  JPEG, PNG and WebP accepted by their bytes, other files listed as not supported with the reason;
  duplicates (same bytes) skipped; per file: the original with its location removed (pixels untouched),
  a thumbnail and a display copy (WebP, JPEG where the browser cannot encode WebP), the watermark on the
  derivatives of a watermarked gallery, a placeholder colour; three presigned PUTs; completion checks
  every object with `head()`. Progress, retry of failed files, **resume by dropping the same files
  again**, and a banner for unfinished uploads.
- **Originals live in a private second bucket** `memoria-originals` (D5.1); the public bucket holds only
  thumbnails, display copies and branding.
- **Gallery manager** (`/admin/galleries/[id]`): sets (add, rename, reorder by drag or keyboard, delete
  when empty), a photo grid per set (rendered in the browser from a paged JSON API, in the gallery's sort
  order), multi-select with a bulk bar (move to set, hide/show, set as cover, delete), badges (cover,
  hidden). A cover is chosen automatically (the first landscape photo) until the photographer picks one.
- **Galleries list** (`/admin/galleries`): every gallery with its cover, status, purpose, photo count.
- **Sharing panel**: publish/unpublish (warning while uploads are unfinished), the link (copy, on-screen
  QR, *New link*), the password (show, change), and **email the link to the client** with the
  `gallery.ready` template, previewed exactly as sent.
- **Delete**: a gallery is hidden at once and purged after 7 days by a relay job (objects in both
  buckets, then rows), restorable until then; deleted photos and abandoned uploads are purged by the
  relay too.
- The sidebar's *New gallery* and *Galleries* drop `soonPhase`.
- `npm run ts-check` and `npm run test` green; Verification passes locally, then against the real
  buckets.

**After the first usable version (M4):** presets (needs Phase 4 M2), auto-split by capture-time gaps,
the PNG and WebP metadata editors, smart filters, custom drag order, Shift-click ranges, a downloadable
QR, draft autosave, IndexedDB resume across browser restarts.

**Before Phase 8 (M5):** *Replace with edited version*, *reprocess* from the originals, and the
processing switch Phase 8's delivery calls (D5.26).

- **Depends on:** Phase 1 (media rules, `blobUrls`), Phase 3 (jobs, the email job and templates),
  Phase 4 M1 (gallery defaults and branding readers, watermark, theme and font ids, `RadioCards`,
  `putToSignedUrl`, the media CSP). By commit: commits 1–2 can start any time; **commit 3 (New gallery)
  needs Phase 4 commits 1–4** (the watermark reader, `watermarkImageUrl`, `RadioCards`); **commit 4
  (pipeline) needs Phase 4 commit 4** (`applyWatermark`). **Unblocks:** Phases 6, 7, 8, 9, 10.
- **Mockups:** `NewGallery.dc.html`, `GalleryEditor.dc.html`. Deviations: the gallery is created first
  and photos are uploaded in the manager (not on the New gallery screen); access offers link and password
  only ("Invited emails only" is cut, open question 9); the address is `/g/<slug>` (D5.2).
- **Scope (feature IDs):** C1, C3–C5, D1–D6, E1–E5, E7, F1, F2, F6, F7 (M1–M3); C6, E6, F8 and the rest of
  E (M4); D10 (M5); F3–F5 belong to Phases 7 and 9.

## Starting point (verified 2026-11-16 against master `2b6972a`: Phases 0–2b done, Phase 3 M1–M3 done)

- **Media rules** (`packages/platform/media.ts`): `MEDIA_TYPES` = `image/jpeg`, `image/png`,
  `image/webp`; `BLOB_PREFIXES` = `galleries`, `branding`, `dev`; `isBlobKey` = `[a-z0-9._/-]{1,512}`
  with a known first segment; `MAX_UPLOAD_BYTES` = 100 MB; `contentDisposition(name)`.
- **`blobUrls(config)`** (`packages/platform/blobUrls.ts`): mode `s3` (all four `MEDIA_S3_*`), `dev`
  (`NEXTJS_ENV=development` + `MEDIA_DEV_SIGNING_SECRET`) or `none`; `uploadUrl(key, { contentType, size, expiresInSeconds ≤ 900 })`
  → `{ url, method: 'PUT', headers: { 'content-type' } }`; `readUrl(key, { expiresInSeconds, downloadName })`;
  `publicUrl(key)` → `MEDIA_PUBLIC_BASE_URL + key` or null. **One bucket only**: `Config.media.s3` =
  `{ endpoint, bucket, accessKeyId, secretAccessKey }`. **A new `AwsV4Signer` per URL with no shared
  `cache`**: every URL re-derives the SigV4 signing key (4 HMACs).
- **`BlobStore` port** (`ports.ts`): `put`, `get`, `head`, `delete(keys)` (missing ignored, adapters
  chunk), `list({ prefix, cursor, limit ≤ 1000 })`; `getPlatform().blobs()` takes no argument;
  `cloudflarePlatform(env, waitUntil)` builds `r2BlobStore(env.MEDIA)`; `CloudflarePlatformEnv` types
  only `MEDIA`. `useTestPlatform({ blobs })` takes one store. Dev routes `api/blobs/upload` and
  `api/blobs/read` (HMAC token, 404 outside development, **≤ 32 MB**, buffered).
- **Buckets and config**: `apps/web/wrangler.jsonc` binds `MEDIA` → `memoria-media`; vars
  `MEDIA_PUBLIC_BASE_URL` (empty), `MEDIA_S3_ENDPOINT` (empty) and `MEDIA_S3_BUCKET` (`memoria-media`) are
  plain vars. The relay binds `MEDIA` too. Guard `wrangler-config` finds buckets by binding name.
  `apps/web/r2-cors.json`: PUT/GET/HEAD from localhost:3210, :8787 and a production placeholder. The
  bucket `memoria-media` exists (eeur, smoke deploy, created with the account token: `npm run wrangler --
  r2 bucket create`); its CORS, the **S3 API token (a separate R2 token made in the dashboard)** and the
  public domain are not set up yet (Phase 1 Verification 5 is open).
- **CSP**: on master `img-src 'self' data: blob:`, `connect-src 'self' https://cloudflareinsights.com`.
  **Phase 4 M1 commit 4 adds the media origins** (p04 D4.15: the studio profile gets the public media
  domain in `img-src`/`connect-src` and the S3 endpoint in `connect-src`). Both buckets share the S3
  endpoint, so this phase adds no origin.
- **Jobs as built** (Phase 3, `lib/jobs`): `jobStatement(kind, payload, { now, runAfter?, ref?, dedupeKey?, id?, maxAttempts?, when? })`
  → `{ id, statement }` (`when` = a condition the INSERT checks when it runs; `when` and `dedupeKey`
  together throw), then `nudgeRelay()`; `conditionalEnqueueJobStatement` exists; `JobKind` = `{ kind,
  version, maxAttempts, priority, backoff, parse, run }`, `parse` → `{ ok: true, value } | { ok: false,
  unknown }`, `run` may resolve with fields to keep; registry `JOB_KINDS` = `email`, `housekeeping`; one
  job per relay invocation (10 ms CPU); an unknown kind is deferred 10 minutes without spending an
  attempt and fails only after 24 h; housekeeping prunes only finished jobs and fails `EXPIRED` only jobs
  due for 7 days; `jobs.ref` exists, **`ix_jobs_ref` was left for this phase**;
  `cancelPendingJobsStatement({ ref, kind?, now })` cancels pending jobs and frees their dedupe key. **A
  failed job keeps its payload (and `params`) for 30 days** so it can be retried; only a sent one drops
  `params` (`PRIVATE_PAYLOAD_FIELDS`).
- **Email as built**: templates in `lib/email/templates/registry.ts`: `EMAIL_TEMPLATES` built from
  `[testTemplate, ...SECURITY_TEMPLATES]`; **no template `version`** (an unknown id is deferred like a
  newer `v`); ids are dotted (`security.sign-in`); `renderLayout(ctx, { heading, paragraphs, action })`
  takes plain text and escapes it; `renderEmail(id, params, ctx)` is pure; `EmailContext` = `{
  studioName, siteUrl, link(path) }`; `link()` throws `SITE_URL_MISSING` (retried, then failed) when the
  studio has no website address and `SITE_URL` is empty — **the production state today** (workers.dev,
  `SITE_URL` ""), and the relay has no request origin to fall back on.
- **Secrets helper**: `settingsCipher(SETTINGS_ENCRYPTION_KEY)` → `encrypt(plain, aad)` /
  `decrypt(stored, aad)` (AES-GCM, `v1:`, fixed salt, info `memoria:settings:secret:v1`, no key
  versioning; `lib/settings/secrets.ts`); the key is on both Workers.
- **Admin UI**: `components/admin/nav.ts` has *New gallery* and *Galleries* with `soonPhase: 5`;
  `PageHeader`, `@repo/ui/dialog`, `Segmented`, `Toggle`; `RadioCards` and `putToSignedUrl` arrive with
  Phase 4 M1; no `Chip`, Tabs or `scrim` token yet (T5.9). `uqr` (QR codes) is a dependency.
- **Audit**: `ck_audit_log_action` allows `create`, `update`, `delete`, `login`, `logout` only.
- **Schema**: `0001`–`0005` applied to production and forward-only; no table uses `REFERENCES` yet (the
  test harness resets with `PRAGMA defer_foreign_keys = on`). Phase 3 M3 and Phase 4 M1 add no
  migration: this phase's is **`0006`**.
- **Measured** (smoke deploy): a Next page 8 ms CPU at the median (`/`), a route handler about 6 ms
  (`/robots.txt`), the sign-in page 26 ms (17 of 20 samples 20–37 ms, all answered 200). Every admin
  screen and admin API route of this phase runs through Next.
- **Cloudflare facts** (docs, re-check at build): D1 allows **100 bound parameters per statement** and 50
  queries per invocation on the free plan; **index writes count as rows written**; Workers: 50
  subrequests (D1, R2 and Cache API calls count; current docs give Cloudflare services a separate,
  larger allowance — not relied on); R2 is **strongly consistent** (a `head()` right after a PUT sees
  it); R2 `delete` takes up to 1000 keys per call; R2 allows 6 simultaneous connections per invocation;
  R2 free tier: 10 GB-month, 1M Class A, 10M Class B operations a month; deletes are free.
- **Browser facts** (to verify, Verification 3): Safari's canvas does not encode WebP
  (`convertToBlob({ type: 'image/webp' })` returns PNG there); `createImageBitmap` resize options are not
  supported everywhere; `OffscreenCanvas` is in every current browser (Safari 16.4+);
  `navigator.deviceMemory` does not exist in Safari or Firefox.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D5.1 | **Originals in a second, private bucket `memoria-originals`.** A second binding `ORIGINALS` on both Workers; `getPlatform().blobs(bucket?: 'media' \| 'originals')` (default `media`); `blobUrls(config).uploadUrl(key, { bucket })` and `readUrl(key, { bucket })`; `Config.media.s3.originalsBucket` from a new var `MEDIA_S3_ORIGINALS_BUCKET` (= the `ORIGINALS` bucket, guard); the S3 API token covers both buckets; the originals bucket has **no public domain**, its CORS allows PUT (and GET for Phase 9) from the app origins only, never `*`. Development: a second local bucket; the dev token names its bucket. | No URL guessed or edited from a display copy can reach an original; Phase 9 hands out originals only through short-lived presigned GETs. One bucket with a random key per original would leave a once-shared URL valid forever. |
| D5.2 | **Gallery URLs are `/g/<slug>`** (index question 2, decided 2026-11-17). `worker.ts` matches the prefix before Next loads (Phase 6); no reserved words, no clash with `/admin`, `/api`, `/_next`, `robots.txt`. | The cheapest route to serve on the free plan; the mockup's root form can be added later as a redirect on a gallery-only domain. |
| D5.3 | **A slug is readable plus random**: from the name (`maria-jonas`, ASCII-folded, Cyrillic transliterated, ≤ 40) + `-` + **10** characters of `[a-z2-9]` (≈ 50 bits), UNIQUE. On a **link-access** gallery only the readable part is editable (the random part cannot be removed or shortened); a password gallery may use any slug (`[a-z0-9-]`, 3–60). **New link** regenerates the random part: the old link stops working; images already seen are not revoked (public delivery), and the dialog says so. Phase 6's access and visitor cookies are `Path=/` and keyed by gallery id, so they survive a slug change (a password change still ends access cookies). | With "anyone with the link", the link is the key: the name is guessable and 6 characters (31 bits) was too thin. |
| D5.4 | **Each gallery has a current processing profile; each photo records the one it was made with.** At creation the purpose, display and thumbnail sizes and quality, and the watermark (a snapshot of Phase 4's **whole `Watermark` object**, D4.3; `null` when off) are copied into `galleries.settings.processing`; every upload uses it and writes it into `photos.processing`. The PATCH route does not change it. Changing it before M5 = a new gallery; M5 adds *reprocess* (re-runs the pipeline from the originals in the browser) and `switchProcessingStatement` for Phase 8's delivery (selection → sharing defaults), after which a gallery may legally mix profiles. | The files are baked; a gallery whose photos silently disagree is worse than a re-create, but delivery must be able to change the profile (Phase 8). |
| D5.5 | **The browser pipeline**: a pool of `min(4, max(1, hardwareConcurrency − 1))` module Web Workers, limited to **≤ 80 decoded megapixels in flight** across workers (dimensions read before decoding). Per file: sniff the type from the bytes; SHA-256 (`crypto.subtle`); read and clean the metadata (D5.6); decode with `createImageBitmap(blob, { imageOrientation: 'from-image' })`; resize by `drawImage` on an `OffscreenCanvas` with `imageSmoothingQuality = 'high'`, halving in steps while the ratio is above 2; `applyWatermark` (Phase 4); `convertToBlob({ type: 'image/webp', quality })`, and **JPEG** when the browser returns another type (a source with alpha painted on white first); the placeholder = the average colour of an 8 px copy. No WebAssembly. Derivatives carry no metadata. | Native APIs only, the same result in Chrome, Firefox and Safari; no Worker CPU spent on images; memory bounded without `deviceMemory`. |
| D5.6 | **The original keeps its pixels and loses its location** (index → Uploads): our own lossless metadata editor `lib/images/metadata/`. **M2 ships the JPEG editor**: EXIF — the GPS IFD's entries and values zeroed (offsets bounds-checked first) and the IFD0 `GPSInfo` (0x8825) entry removed by shifting the later entries up, moving the next-IFD pointer up 12 bytes and zeroing the freed bytes (value offsets are absolute, so nothing else moves); the Exif IFD's `MakerNote` (0x927C) treated the same; IFD1 (the embedded thumbnail, which can carry its own EXIF) unlinked and zeroed. **XMP dropped entirely** (APP1 `http://ns.adobe.com/xap/1.0/` and ExtendedXMP). MPF (APP2 `MPF\0`) and anything after the first EOI (secondary images) dropped; ICC (APP2 `ICC_PROFILE`) kept. **IPTC whitelisted**: APP13 rebuilt with only the IPTC resource (0x0404) holding records 2:05 object name, 2:80 by-line, 2:116 copyright and 2:120 caption; every other IRB resource (the 0x040C thumbnail included) and every other IPTC record (city, sub-location, state, country…) dropped. **The JPEG is rebuilt from a segment allow-list**: SOI, APP0 (JFIF), the rebuilt APP1 Exif, APP2 `ICC_PROFILE`, the rebuilt APP13, APP14 (Adobe), DQT, DHT, SOFn, DRI, SOS + its entropy-coded data, RSTn, EOI; everything else is dropped (COM comments, APP3–APP12, APP15 vendor segments, XMP, ExtendedXMP, MPF, anything after EOI). In the rebuilt Exif the free-text tags that phone and camera apps fill with place names are also dropped: `ImageDescription`, `UserComment`, `XPTitle`, `XPComment`, `XPKeywords`, `XPSubject`, `XPAuthor`, `CameraOwnerName`/`OwnerName` (`Artist` and `Copyright` stay). A structure the editor does not know (SubIFDs 0x014A, a second EXIF segment, an unparsable IRB or TIFF) **refuses the file** ("cannot remove location data"). **PNG and WebP without metadata chunks are accepted; a PNG or WebP carrying EXIF, XMP or text metadata is refused** ("export as JPEG, or without metadata") until M4 ships their editors. The same reader returns orientation, `DateTimeOriginal`, camera and lens. | No re-encoding (quality kept), no runtime dependency, an allow-list where a deny-list would leak; refusing beats leaking a client's home address; Lightroom exports are JPEG, so slicing PNG/WebP out costs the first version nothing. Dropping XMP loses develop settings and keywords, which a client never needs (open question 8). |
| D5.7 | **Keys**: original `galleries/<galleryId>/<photoId>/original.<jpg\|png\|webp>` in `memoria-originals`; derivatives `galleries/<galleryId>/<photoId>/<rev>/thumb.<webp\|jpg>` and `…/display.<ext>` in `memoria-media`, `rev` = 8 random `[a-z2-9]` per processing (a re-mint keeps it, D5.9). All generated by the server at registration. | A new `rev` busts the CDN cache when a photo is replaced or reprocessed (M5); ids are UUIDs, so keys are not enumerable. |
| D5.8 | **Two-phase upload.** `POST …/uploads` (`REGISTER_BATCH` = 10 photos) inserts `photos` rows (`status = 'uploading'`) and returns three signed PUTs each, minted with `expiresInSeconds: 600` (signatures: CPU only, no subrequest); the browser PUTs; `POST …/uploads/complete` (`COMPLETE_BATCH` = 8 photos) `head()`s the three objects of each photo (exists, size = declared, type = minted, original ≤ `MAX_UPLOAD_BYTES`, derivatives ≤ 10 MB) and marks it `ready`. A photo that fails `head()` stays `uploading` (the browser retries its PUTs once, then reports it). Both batch sizes are named constants with a "measured: …" note filled in by Verification 5. | Complete = 24 `head()`s + ~4 D1 calls against 50 subrequests (R2 and D1 calls count); one INSERT per photo keeps under 100 parameters; R2 is strongly consistent, so `head()` right after the PUT is reliable. The heads queue on R2's 6 connections (wall time, not CPU). |
| D5.9 | **Dedupe and resume by content**: `UNIQUE (gallery_id, sha256)` (of the file as dropped). Registering a known hash returns `duplicate` for a `ready` photo and **re-mints** an `uploading` one: every declared field is rewritten (sizes, dimensions, `derivative_ext`, colour, `taken_at`, `name_key`, `sort_key`, `processing`, `updated_at`) **except `rev`**, so the new PUTs overwrite any partial objects; when `derivative_ext` changes (another browser), the register request also deletes the old-extension derivative keys (one `delete` call). **A deleted photo releases its hash** (`sha256 = NULL` in the delete statement), so dropping it again uploads it anew. Re-dropping re-processes the files in the browser (the bytes and the hash are needed anyway); no IndexedDB in M1–M3. | Resume without client storage; the database enforces dedupe, never a read-check-write; a re-dropped deleted photo is never skipped or revived against objects about to be purged; no orphaned objects from a resume. |
| D5.10 | **Columns for what is queried, one `settings` JSON for the rest.** `galleries` keeps slug, title, status, purpose, access, delivery, counts, cover and timestamps as columns; `settings` (JSON, parsed by the pure, **import-free** `parseGallerySettings` with a default per field, returning `{ value, invalid: string[] }` so the caller logs) holds `processing` (D5.4), theme, accent, font, grid, **`sort`: `'filename' \| 'taken'` (default `filename`)**, welcome note. Phases 7, 9 and 10 add fields. **A PATCH merges** with `settings = json_patch(settings, ?)` (only the fields sent; `processing` is never in a PATCH), so two admin tabs cannot overwrite each other's fields. | Later phases add options without migrations; an invalid stored setting reads as its default, never a broken gallery; Phase 6's `worker.ts` parses it (guard `edge-graph`); no read-modify-write of the JSON (AGENTS.md → Data rules). |
| D5.11 | **The gallery password is sealed, not hashed**: `password_sealed` = `settingsCipher.encrypt(password, 'gallery.<id>.password')`; the photographer sees it in the sharing panel; Phase 6's gate unseals and compares (HMAC of both sides, then a constant-time compare). A change bumps `password_version` (Phase 6's access cookies carry it). Passwords: **8–64 characters**; *Generate* (two words + two digits, recommended by the form). | A shared, shown password, not a credential: PBKDF2 on a public path would cost the CPU budget for nothing. A D1 export alone does not reveal it. |
| D5.12 | **Every content change bumps `galleries.content_version`** in the same batch (photo completed, hidden, moved, deleted, cover, sets, settings, sort, publish) — **and only a real change**: `bumpContentStatement` and the recounts carry the predicate of the change (e.g. `WHERE id = ? AND EXISTS (SELECT 1 FROM photos WHERE gallery_id = ? AND updated_at = ?batchNow)`; bulk and photo statements set `updated_at = ?batchNow`), so a repeated complete or hiding an already-hidden photo does not invalidate Phase 6's cache. Each conditional audit row sits right after the statement whose `changes()` it tests. | Phase 6 caches a gallery's JSON by `(id, content_version)`: a change shows at once without purging anything, and a no-op leaves the cache warm. |
| D5.13 | **Counts are stored and cheap to keep.** `photo_sets.photo_count` (ready, not hidden) is **incremented** in the complete batch: the mark-ready statements set `updated_at = ?batchNow`, then `UPDATE photo_sets SET photo_count = photo_count + (SELECT count(*) FROM photos WHERE set_id = photo_sets.id AND id IN (…) AND status = 'ready' AND hidden = 0 AND updated_at = ?batchNow) WHERE gallery_id = ? AND id IN (…)` (a repeated complete marks nothing, so adds 0); bulk move/hide/delete **recount only the touched sets**; `galleries.photo_count = (SELECT coalesce(sum(photo_count), 0) FROM photo_sets WHERE gallery_id = ?)` (≤ 50 rows). No byte total (Phase 11 computes storage on demand). A batch that hides or deletes the cover clears `cover_photo_id` and re-runs the cover default (D5.22). | No `count(*)` on a client request; rows read per complete batch ≤ 8 + 50; a drift heals at the next bulk action on that set. |
| D5.14 | **Heavy lists render in the browser.** The manager's grid and the galleries list fetch JSON pages (`GET …/photos?set_id=&cursor=`, ≤ 200 per page, in `sort_key` order through `ix_photos_set_order (set_id, sort_key)`, hidden photos included); server components render only the shell. Thumbnails come from `publicUrl(key)` (a string join), or the dev read route locally. | A server render of 800 thumbnails would cost tens of ms of CPU per page view; the JSON is ~0.5 ms. |
| D5.15 | **Production shows images only through the public media domain** (`MEDIA_PUBLIC_BASE_URL`, an R2 custom domain; the `r2.dev` URL is acceptable for a trial only). Without it the manager shows placeholders and a notice. Never presigned GETs for thumbnails or watermarks. | Presigned URLs are unique per call (no CDN cache), cost a signature each, and AGENTS.md keeps them for downloads. |
| D5.16 | **The CSP media origins are Phase 4's** (p04 D4.15: the studio profile carries the public media domain and the S3 endpoint). This phase adds no origin: both buckets share the S3 endpoint. The public bucket's CORS (one policy per bucket, applied to S3 and custom-domain access alike) allows `GET` from the app origins; deployment.md → Media lists both buckets' rules. Dedicated workers take their CSP from the script's own response (`/_next/static/…`): checked in Verification 2. | One place builds the CSP; the watermark (Phase 4) is the first cross-origin request. |
| D5.17 | **Delete is soft, purge is a job, and the two never overlap.** Deleting a gallery sets `deleted_at = ?now` (it disappears from lists and clients at once) and, in the same batch, enqueues `gallery.purge` (`{ galleryId, run: 0 }`) with `runAfter` = the same `?now` + 7 days and `ref = gallery:<id>`. **Every enqueue of `gallery.purge` is conditional** — `when: NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'gallery.purge' AND ref = ? AND status IN ('pending', 'running'))`, no dedupe key (`ix_jobs_ref` serves it) — so at most one is alive per gallery. A run that finds `deleted_at > ?now−7d` (clock skew, an early cron) **re-enqueues itself at `deleted_at + 7d`** instead of finishing (a chain or reschedule enqueued from inside the running job adds `AND id != ?currentJobId` to the condition, from `JobContext.jobId`, or it would see itself and never enqueue); housekeeping enqueues `gallery.purge` (same condition) for galleries with `deleted_at <= ?now−7d` (≤ 10 a day, via `ix_galleries_list`), so a purge that failed its last attempt self-heals. **Restore** is `UPDATE … SET deleted_at = NULL WHERE id = ? AND deleted_at > ?now−7d` and `cancelPendingJobsStatement({ ref, kind: 'gallery.purge', now })`; the purge acts only while `deleted_at <= ?now−7d`, and every purge statement repeats that condition — so a restore and a purge can never both succeed. Deleting photos sets `status = 'deleted'`, `sha256 = NULL` (D5.9) and enqueues `media.purge` with `when: NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'media.purge' AND status = 'pending')` and **no dedupe key** (at most one pending; it purges everything purgeable). Purging is **row-driven and claims first** (keys derive from rows; no bucket listing): stale uploads are claimed with one `UPDATE … SET status = 'deleted', sha256 = NULL, updated_at = ?now WHERE id IN (SELECT id … WHERE status IN ('uploading', 'deleted') AND status = 'uploading' AND updated_at < ?now−24h LIMIT 90) AND status = 'uploading' AND updated_at < ?now−24h` (the `IN` repeats the partial index's predicate, so `ix_photos_purge` is used), so a photo completed or re-minted meanwhile is untouched; ≤ 90 photos per run (objects in both buckets by `delete(keys)`, then dependents, then the rows by id); a run that found 90 enqueues the next one the same way (no nudge: the relay's cron picks it up within a minute). | Recoverable mistakes; bounded CPU per relay invocation (one job, 10 ms: measured, Verification 5); no `list` operations (Class A); orphans cannot appear because a presigned PUT expires in 10 minutes and purges start after 24 h; no dedupe key that a finished job would hold for 30 days; nothing stays undeleted because one job failed. |
| D5.18 | **Foreign keys without cascade, and a set belongs to its photo's gallery**: `photo_sets.gallery_id` and `photos.gallery_id` reference `galleries`; `photo_sets` has `UNIQUE (id, gallery_id)` and `photos` references it with the composite `FOREIGN KEY (set_id, gallery_id)`, so a photo can never sit in another gallery's set (a tampered `setId` fails the FK, mapped to 400 `INVALID_SET`). Purges delete dependents, then photos, then sets, then the gallery. D1 enforces foreign keys (proved by a test on the workerd test D1). | The schema refuses orphans and cross-gallery sets (counts cannot drift from a forged id); deleting in order is what the purge does anyway, and a cascade would hide row-write costs. |
| D5.19 | **Status = `draft` \| `published`, and it stays that way**; a draft is invisible to clients (Phase 6 answers 404). Publishing sets `published_at` and `first_published_at` once (`WHERE status = 'draft'`, so twice is a no-op); unpublishing returns to draft and clears `published_at` in the same statement. Scheduled, Expired and Proofing are **derived** later (Phase 10 adds `publish_at`/`expires_at` with `ALTER TABLE ADD COLUMN`; Phase 7's submission is its own table), so `ck_galleries_status` never needs a table rebuild. | The smallest lifecycle that lets the photographer upload before sharing, and one SQLite cannot paint into a corner. |
| D5.20 | **The client email is a template, sent by the relay, and never carries the password.** `gallery.ready`: the job's `to` = the address and name the photographer typed (as built); `params` = `{ galleryId, includePassword }`. **The `EmailTemplate` type gains an optional `load?(params, ctx): Promise<R>`** (`ctx` = `{ opts (db options), to }`); `lib/email/job.ts` `run` awaits it after `parse` and before `render`, and `render` takes the loaded value `R` (templates without `load` render their params as today). `gallery.ready`'s `load` reads the gallery through its query module and, when `includePassword`, unseals `password_sealed` at send time (so a changed password sends the current one); a deleted or missing gallery → `JobError('GALLERY_GONE', { permanent: true })`, a draft → `JobError('GALLERY_UNPUBLISHED', { permanent: true })` (never six retries), a password that will not unseal → `MailError('MAIL_SECRET_UNREADABLE', { configuration: true })` like `unsealMailSettings`; `views.ts` gains a sentence for each new code. The preview route calls the same `load`. `load`, the template and `lib/galleries/password.ts` are React- and Next-free (guard `relay-graph`). The template registers in `EMAIL_TEMPLATES` (`[testTemplate, ...SECURITY_TEMPLATES, galleryReadyTemplate]`) and renders with `renderLayout`. The route refuses **409 `NOT_PUBLISHED`** for a draft (the panel's button is disabled until the gallery is published) and **409 `SITE_URL_REQUIRED`** ("Set your website address in Settings → Studio first", with a link) when `readStudio().siteUrl` is null; the sharing panel shows the same hints. Rate limit 20 an hour. | Phase 3's rules (only the relay sends; links through `ctx.link`); a failed job keeps its params for 30 days, so params must hold nothing secret; without a website address every link fails in the relay. The photographer typed the address, so D3.15's visitor caps do not apply. |
| D5.21 | **Image delivery `protected` is stored but not offered** until Phase 6 M2 (Phase 4 D4.13). | The column exists from the start; no option promises what is not built. |
| D5.22 | **A cover is chosen automatically** (index → D8: "first landscape photo instead"): in the complete batch and after a cover is cleared, `UPDATE galleries SET cover_photo_id = (SELECT p.id FROM photos p JOIN photo_sets s ON s.id = p.set_id WHERE p.gallery_id = ? AND p.status = 'ready' AND p.hidden = 0 ORDER BY (p.width > p.height) DESC, s.position, p.sort_key LIMIT 1) … WHERE id = ? AND cover_photo_id IS NULL` (no rows read once a cover is set). The photographer's *Set as cover* replaces it. | A new gallery is never coverless; the subquery runs only while the cover is empty. |
| D5.23 | **Photo order is one indexed key per photo, composed in SQL.** Computed in code at registration: `name_key` = the filename lower-cased, NFKD, digit runs zero-padded to 10 (natural order: `IMG_9` before `IMG_10`), **then truncated to 120 characters** (after padding, so a digit-heavy name cannot grow it: `sort_key` ≤ ~180 characters, its cursor ≤ ~240); `taken_key` = `taken_at` or `~`. **In the register INSERT and in `remintPhotoStatement` the CASE uses the bound `name_key`, `taken_key` and `id` parameters (repeated), never the columns** (an INSERT…SELECT has no new-row columns to read, and an UPDATE's right-hand side sees the old row); only `resortStatement` reads the columns. **`sort_key` is composed in SQL from the gallery row in the same statement**: `CASE json_extract(g.settings, '$.sort') WHEN 'taken' THEN taken_key \|\| '\|' \|\| name_key \|\| '\|' \|\| id ELSE name_key \|\| '\|' \|\| taken_key \|\| '\|' \|\| id END` — in the register `INSERT … SELECT … FROM galleries g` and in the resort `UPDATE` — so a sort change and a registration cannot interleave into a stale key. Unique per photo (the id), so a cursor is the base64url of the last `sort_key`, **capped at 700 characters** (Phase 6 uses the same cap). Default sort: **filename** (Lightroom exports are numbered in shooting order; open question 10). | One index `(set_id, sort_key)` serves every sort for the manager and the client gallery; no page-local sorting; no `max(position)` scan at registration; no read-then-write of the sort. |
| D5.24 | **Hooks for Phase 7**: `lib/galleries/photoDependents.ts` exports `PHOTO_DEPENDENT_DELETES: ((photoIds: string[]) => Statement)[]` (empty here), run before every photo-row DELETE in the purges, and `photoChangeGuard(galleryId, photoIds, action)` (a no-op here) that bulk move/hide/delete call first. Phase 7 registers its tables (`favorites`, `photo_comments`, `retouch_requests`) and makes the guard refuse (409) a photo in a submitted, locked selection. | Phase 7 adds rows that reference photos: without the hook the purge would fail on the FK forever, or "lock after submit" would be bypassable from the manager. |
| D5.25 | **Signing is cached.** `blobUrls` passes one aws4fetch `cache` `Map` (kept on `globalThis`, keyed by the access key id) to every `AwsV4Signer`, so the signing key is derived once a day per isolate instead of once per URL. | Registration signs up to 30 URLs inside a Next route that already costs ~6 ms. |
| D5.26 | **M5, before Phase 8**: *Replace with edited version* (T5.12) and *reprocess* (T5.13b) share the pipeline; Phase 8's deliver calls `switchProcessingStatement(galleryId, sharingProfile)` (changes `purpose` and `settings.processing` in one statement, bumps `content_version`). Replacement keeps the photo id (favourites and comments stay), mints a new `rev`, and the complete request deletes the previous derivative keys (and the previous original when its extension changed) after the new ones pass `head()`. | Delivered edits must not carry the proof watermark or the 1600 px size (Phase 8 T8.4). |

## Design

### Topology

```
photographer's browser                                   memoria (Next)                     R2
  drop files/folders ─► pool of Web Workers               POST /api/admin/galleries/:id/uploads
    sniff · sha256 · clean metadata ───────────────────►    rows 'uploading' + 3 signed PUTs ──┐
    decode · resize · watermark · encode                                                       │
  PUT original ───────────────────────────────────────────────────────────────────────────────►│ memoria-originals (private)
  PUT thumb, display ─────────────────────────────────────────────────────────────────────────►│ memoria-media (public domain)
  POST …/uploads/complete ─────────────────────────────►   head() ×3 → 'ready', set counts,
                                                           cover default, content_version + 1
memoria-relay: gallery.purge (deleted galleries, +7 d) · media.purge (deleted photos, stale uploads)
               email gallery.ready (its template `load` unseals the password at send time)
```

### Data: `migrations/0006_galleries.sql`

```sql
CREATE TABLE galleries (
  id                 TEXT NOT NULL,
  slug               TEXT NOT NULL,
  title              TEXT NOT NULL,
  shoot_date         TEXT,                              -- YYYY-MM-DD
  client_name        TEXT,
  client_email       TEXT,
  purpose            TEXT NOT NULL,                     -- selection | sharing
  status             TEXT NOT NULL DEFAULT 'draft',     -- draft | published (D5.19)
  access             TEXT NOT NULL,                     -- link | password
  password_sealed    TEXT,                              -- D5.11
  password_version   INTEGER NOT NULL DEFAULT 1,
  delivery           TEXT NOT NULL DEFAULT 'public',    -- public | protected (Phase 6 M2)
  settings           TEXT NOT NULL DEFAULT '{}',        -- D5.10
  cover_photo_id     TEXT,                              -- no FK: read through a join; cleared with its photo
  photo_count        INTEGER NOT NULL DEFAULT 0,        -- D5.13
  content_version    INTEGER NOT NULL DEFAULT 1,        -- D5.12
  published_at       TEXT,
  first_published_at TEXT,
  deleted_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
  CONSTRAINT ck_galleries_counts CHECK (photo_count >= 0 AND content_version >= 1)
);
CREATE INDEX ix_galleries_list ON galleries (deleted_at, created_at);

CREATE TABLE photo_sets (
  id          TEXT NOT NULL,
  gallery_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  photo_count INTEGER NOT NULL DEFAULT 0,             -- D5.13
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_photo_sets PRIMARY KEY (id),
  CONSTRAINT uq_photo_sets_id_gallery UNIQUE (id, gallery_id),     -- target of fk_photos_set (D5.18)
  CONSTRAINT fk_photo_sets_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id),
  CONSTRAINT ck_photo_sets_name CHECK (length(name) BETWEEN 1 AND 60),
  CONSTRAINT ck_photo_sets_counts CHECK (position >= 0 AND photo_count >= 0)
);
CREATE INDEX ix_photo_sets_gallery_position ON photo_sets (gallery_id, position);

CREATE TABLE photos (
  id             TEXT NOT NULL,
  gallery_id     TEXT NOT NULL,
  set_id         TEXT NOT NULL,
  filename       TEXT NOT NULL,                       -- the photographer's filename (metadata; Phase 8 export)
  name_key       TEXT NOT NULL,                       -- natural-order form of the filename (D5.23)
  taken_key      TEXT NOT NULL,                       -- taken_at or '~' (D5.23)
  sort_key       TEXT NOT NULL,                       -- composed in SQL from the gallery's sort (D5.23)
  content_type   TEXT NOT NULL,                       -- of the original
  original_bytes INTEGER NOT NULL,                    -- Phase 9 ZIP progress
  bytes          INTEGER NOT NULL,                    -- original + derivatives
  width          INTEGER NOT NULL,                    -- oriented pixels of the original
  height         INTEGER NOT NULL,
  taken_at       TEXT,                                -- EXIF DateTimeOriginal as written (local, no zone)
  sha256         TEXT,                                -- D5.9; NULL once deleted
  rev            TEXT NOT NULL,                       -- D5.7
  derivative_ext TEXT NOT NULL,                       -- webp | jpg
  display_width  INTEGER NOT NULL,
  display_height INTEGER NOT NULL,
  color          TEXT NOT NULL,                       -- placeholder #RRGGBB
  processing     TEXT NOT NULL,                       -- the profile used (D5.4)
  meta           TEXT NOT NULL DEFAULT '{}',          -- camera, lens, focal, aperture, shutter, iso
  status         TEXT NOT NULL DEFAULT 'uploading',   -- uploading | ready | deleted
  hidden         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_photos PRIMARY KEY (id),
  CONSTRAINT fk_photos_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id),
  CONSTRAINT fk_photos_set FOREIGN KEY (set_id, gallery_id) REFERENCES photo_sets (id, gallery_id),
  CONSTRAINT uq_photos_gallery_sha256 UNIQUE (gallery_id, sha256),
  CONSTRAINT ck_photos_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_photos_sha256 CHECK ((sha256 IS NULL AND status = 'deleted') OR (sha256 IS NOT NULL AND length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  CONSTRAINT ck_photos_rev CHECK (length(rev) = 8 AND rev NOT GLOB '*[^a-z2-9]*'),
  CONSTRAINT ck_photos_ext CHECK (derivative_ext IN ('webp', 'jpg')),
  CONSTRAINT ck_photos_status CHECK (status IN ('uploading', 'ready', 'deleted')),
  CONSTRAINT ck_photos_hidden CHECK (hidden IN (0, 1)),
  CONSTRAINT ck_photos_filename CHECK (length(filename) BETWEEN 1 AND 255),
  CONSTRAINT ck_photos_json CHECK (json_valid(meta) AND length(meta) <= 2048 AND json_valid(processing) AND length(processing) <= 1024),
  CONSTRAINT ck_photos_dims CHECK (width > 0 AND height > 0 AND display_width > 0 AND display_height > 0 AND bytes > 0 AND original_bytes > 0)
);
CREATE INDEX ix_photos_set_order ON photos (set_id, sort_key);
CREATE INDEX ix_photos_purge ON photos (updated_at) WHERE status IN ('uploading', 'deleted');

CREATE INDEX ix_jobs_ref ON jobs (ref);               -- left for this phase by p03
```

- **Four structures on `photos`**: the table (PK), `uq_photos_gallery_sha256`, `ix_photos_set_order`,
  and the partial `ix_photos_purge` (only `uploading` and `deleted` rows are in it). Neither `status` nor
  `hidden` is in an index key, so marking a photo ready, hiding or showing it rewrites only its row (and
  the partial index on the way out of `uploading`). **One order index serves both lists**: the client page
  reads `ix_photos_set_order` in `sort_key` order and filters `status = 'ready' AND hidden = 0` on the row
  (≤ 500 + the set's hidden and unfinished rows, which are few); the manager pages ready and uploading
  photos, hidden included, through the same index; recounts use it too.
- `taken_at` is EXIF's wall-clock text normalised to `YYYY-MM-DDTHH:MM:SS` (no zone; sort only);
  `taken_key` = `taken_at` or `~` (sorts after any date).
- **Every purge read and claim repeats the partial index's predicate** `status IN ('uploading',
  'deleted')`, so SQLite uses `ix_photos_purge` (e.g. the claim: `… WHERE status IN ('uploading',
  'deleted') AND status = 'uploading' AND updated_at < ?`); the housekeeping `EXISTS` does the same.
- `processing` = `{ display: { longEdge, quality }, thumb: { longEdge, quality }, watermark: Watermark | null, ext }`
  where `watermark` is **the whole parsed Phase 4 `Watermark` object** (image: key, dimensions, type and
  placement; text: text, font, ink and placement) — a key alone could not reproduce a text watermark or
  its placement. It fits `ck_photos_json`'s 1024 characters (≈ 400 at most). The same shape is
  `galleries.settings.processing`.
- **Query modules**: `lib/db/queries/galleries/` (`types.ts` with `GalleryRow` and `toGalleryRow` — the
  settings parsed and invalid fields logged; the sealed password leaves the module only to
  `lib/galleries/password.ts` and the `gallery.ready` template's `load`; `read.ts`: `getGallery(id)`, `getGalleryBySlug(slug)`,
  `listGalleries({ cursor, limit, deleted })`; `write.ts`: `insertGalleryStatement`,
  `updateGalleryStatement` (`json_patch`, `WHERE id = ? AND deleted_at IS NULL`), `bumpContentStatement` (guarded),
  `galleryCountStatement`, `coverDefaultStatement`, `clearCoverStatement`, `publishStatement`,
  `unpublishStatement`, `changeAccessStatement`, `resortStatement`, `softDeleteGalleryStatement`,
  `restoreGalleryStatement`, `deleteGalleryStatement` (purge)); `photo_sets/` (`insertSetStatement`,
  `renameSetStatement`, `reorderSetsStatements` (≤ 2 statements), `deleteSetStatement`,
  `incrementSetCountsStatement`, `recountSetsStatement`); `photos/` (`insertUploadingPhotoStatement`
  (`INSERT … SELECT … FROM galleries g …`, `ON CONFLICT (gallery_id, sha256) DO NOTHING RETURNING id`), `remintPhotoStatement`,
  `markReadyStatement`, `listSetPhotos({ setId, cursor, limit })`, `claimStaleUploadsStatement`,
  `listPurgeablePhotos({ galleryId?, limit })`, `deletePhotosStatement`, `bulk*Statement` by id lists of
  ≤ 90); each with its `<table>.test.ts` on a test D1.

### Writes that must not race

| Write | SQL | Guarantee |
| --- | --- | --- |
| Create gallery | `batch([insert gallery, insert set 'Photos' position 0, audit create])`; a slug clash → `UNIQUE` → 409 `SLUG_TAKEN` (the form suggests a new random part) | no read-check-write on the slug |
| Register photo | per photo `INSERT INTO photos (id, gallery_id, set_id, …, name_key, taken_key, sort_key, …) SELECT ?, g.id, ?, …, ?nameKey, ?takenKey, CASE json_extract(g.settings, '$.sort') WHEN 'taken' THEN ?takenKey \|\| '\|' \|\| ?nameKey \|\| '\|' \|\| ?id ELSE ?nameKey \|\| '\|' \|\| ?takenKey \|\| '\|' \|\| ?id END, … FROM galleries g WHERE g.id = ? AND g.deleted_at IS NULL ON CONFLICT (gallery_id, sha256) DO NOTHING RETURNING id` (`sort_key` composed from the gallery row, D5.23; a deleted gallery inserts nothing → 404; a set of another gallery fails the composite FK → 400 `INVALID_SET`); then `SELECT id, status, derivative_ext FROM photos WHERE gallery_id = ? AND sha256 IN (…)` for the conflicts; an `uploading` one is re-minted with `remintPhotoStatement` (`WHERE id = ? AND gallery_id = ? AND status = 'uploading'`, every field but `rev`; `sort_key` composed from the bound new `name_key`/`taken_key`, never the old columns) | a duplicate never creates a row; resume rewrites in place; a sort change between two registrations cannot leave a stale key |
| Complete | per photo `UPDATE photos SET status = 'ready', updated_at = ?batchNow WHERE id = ? AND gallery_id = ? AND status = 'uploading'`; `incrementSetCountsStatement`; `galleryCountStatement`; `coverDefaultStatement`; `bumpContentStatement` guarded by `EXISTS (… updated_at = ?batchNow)` — one batch | idempotent: a second complete marks nothing, adds 0 and does not bump |
| Move / hide / delete photos | `photoChangeGuard` first (D5.24); one `UPDATE … SET …, updated_at = ?batchNow WHERE gallery_id = ? AND id IN (≤ 90 ids) AND status = 'ready'` (+ `AND hidden = 0` for hide, `AND hidden = 1` for show, `AND set_id != ?` for move; delete: `status = 'deleted', sha256 = NULL`), then right after it the conditional audit (`update`/`delete`, `{ count }`, `WHERE changes() > 0`), then `clearCoverStatement` (when the cover is among them) + `recountSetsStatement` (touched sets) + `galleryCountStatement` + `coverDefaultStatement` + the guarded bump + for delete the conditional `media.purge` job, in one batch | a photo of another gallery is never touched; ≤ 93 parameters per statement; a no-op changes nothing, audits nothing, bumps nothing |
| Set cover | `UPDATE galleries SET cover_photo_id = ? … WHERE id = ? AND EXISTS (SELECT 1 FROM photos WHERE id = ? AND gallery_id = ? AND status = 'ready' AND hidden = 0)` + bump (guarded by `changes()`) | a cover always belongs to the gallery and is visible (it is also `og:image` in Phase 6) |
| Update settings | `updateGalleryStatement`: `UPDATE galleries SET title = coalesce(?, title), …, settings = json_patch(settings, ?), updated_at = ? WHERE id = ? AND deleted_at IS NULL` (only the sent fields; `processing` refused by the parser) + bump | two tabs never overwrite each other's settings fields |
| Change sort | `resortStatement`: `UPDATE photos SET sort_key = CASE (SELECT json_extract(settings, '$.sort') FROM galleries WHERE id = ?) WHEN 'taken' THEN taken_key \|\| '\|' \|\| name_key \|\| '\|' \|\| id ELSE name_key \|\| '\|' \|\| taken_key \|\| '\|' \|\| id END WHERE gallery_id = ?`, run in the same batch **after** the settings update that writes the new sort, + bump | one statement reading the committed sort; cursors minted before the change simply restart |
| Reorder sets | `UPDATE photo_sets SET position = CASE id WHEN ? THEN ? … END WHERE gallery_id = ? AND id IN (…)`, ≤ 32 sets per statement (3 parameters per set), so ≤ 2 statements for 50 sets, + bump | positions are rewritten whole in one batch |
| Add set | `INSERT … SELECT … WHERE (SELECT count(*) FROM photo_sets WHERE gallery_id = ?) < 50` → 0 changes = 400 `TOO_MANY_SETS` | at most 50 sets |
| Delete set | `DELETE FROM photo_sets WHERE id = ? AND gallery_id = ? AND NOT EXISTS (SELECT 1 FROM photos WHERE set_id = ?) AND (SELECT count(*) FROM photo_sets WHERE gallery_id = ?) > 1` → 0 changes = 409 `SET_NOT_EMPTY` ("photos still in this set, or being removed: try again in a few minutes") | never the last set; never one any photo row references, deleted ones included, so the FK never fires a 500 |
| Publish / unpublish | `publishStatement`: `SET status = 'published', published_at = ?, first_published_at = coalesce(first_published_at, ?) … WHERE id = ? AND status = 'draft' AND deleted_at IS NULL`; `unpublishStatement`: `SET status = 'draft', published_at = NULL … WHERE status = 'published'`; + bump + audit `update { event }` | the CHECK pair holds in one statement; repeats change nothing |
| Change access / password | `changeAccessStatement`: `UPDATE galleries SET access = ?, password_sealed = ?, password_version = password_version + 1 …` (link → `NULL`; password → the sealed value) + audit `update { event: 'access' }` | `ck_galleries_password` holds in one statement |
| New link | `UPDATE galleries SET slug = ? … WHERE id = ?` (new random part; `UNIQUE` → retry once with another) + audit `update { event: 'new-link' }` | the old slug stops at once |
| Soft delete / restore | `softDeleteGalleryStatement` (`SET deleted_at = ?now WHERE id = ? AND deleted_at IS NULL`) + the conditional `gallery.purge` job (`runAfter` = `?now` + 7 d, D5.17) + audit `delete`; restore: `UPDATE … SET deleted_at = NULL WHERE id = ? AND deleted_at > ?now−7d` + `cancelPendingJobsStatement({ ref, kind: 'gallery.purge', now })` + audit `update { event: 'restore' }` (0 changes → 409 `PURGE_STARTED`) | disjoint windows (D5.17): a restored gallery never lost a file |

Audit rows use the actions the CHECK allows: `create`, `update` (with `details.event` = `publish`,
`unpublish`, `access`, `new-link`, `restore`, `email`, `sort`), `delete`; never a password or an address.

**D1 queries per request**: register ≤ 10 inserts + 1 conflict read + re-mints + session + rate limit ≈
14 statements; complete ≈ 12; a `batch` is one call, and even counted per statement both stay inside
50.

### Budgets (index writes count as rows written)

| Operation | Rows written | Rows read |
| --- | --- | --- |
| Register one photo | ≈ 5 (row, PK, `uq_photos_gallery_sha256`, `ix_photos_set_order`, `ix_photos_purge`) | ≈ 1 (plus the guarded bump's `EXISTS` per batch, which walks the gallery's rows through the `uq_photos_gallery_sha256` prefix: ≤ the gallery's size per batch, ~64k rows read across an 800-photo upload, inside 5M a day) |
| Complete one photo | ≈ 2 (row, out of `ix_photos_purge`) + ≈ 3 per batch (sets, gallery, bump) | ≤ 8 + 50 per batch |
| **800-photo upload** | **≈ 6,000** (+ ~200 rate-limit/session upserts) | ≈ 7,000 |
| Delete one photo (soft) | ≈ 4 (row, uq key → NULL, into `ix_photos_purge`) | — |
| Purge one photo | ≈ 5 | ≈ 1 |
| Gallery purge (direct, no marking) | ≈ 4 per ready photo (row, PK, uq, order; ready photos are not in the partial index) | ≈ 1 per photo |
| Change sort (800 photos) | ≈ 1,600 (row + `ix_photos_set_order` per photo) | ≈ 800 |

Ceilings against 100k rows written a day: about **15 uploads of 800 photos a day**, or about **7** with
the deletes and purges of as many galleries; the photographer's real day is far below. Rows read stay
negligible against 5M. Verification 5 reads the D1 dashboard's rows written after a real 800-photo
upload and records the number here.

### Ports and buckets (D5.1, D5.25)

- `Platform.blobs(bucket: BucketName = 'media')`; `BucketName = 'media' | 'originals'`. Cloudflare:
  `r2BlobStore(env.MEDIA)` / `r2BlobStore(env.ORIGINALS)`; `CloudflarePlatformEnv` gains `ORIGINALS`; the
  relay's generated `RelayEnv` follows from its `wrangler.jsonc` and `cf-typegen`. Test platform:
  `useTestPlatform({ blobs?: { media?: BlobStore; originals?: BlobStore } })`, a fresh in-memory store per
  bucket by default; `packages/platform-cloudflare/testing/proxy.ts` binds `ORIGINALS`; the `BlobStore`
  contract suite runs against both.
- `Config.media.s3` gains `originalsBucket` (var `MEDIA_S3_ORIGINALS_BUCKET`, `memoria-originals`);
  `blobUrls` takes `{ bucket }` on `uploadUrl` / `readUrl` (S3: the bucket in the path; dev: the token
  carries `b: 'm' | 'o'` and the dev routes pick the binding). `publicUrl` refuses `originals` (throws: a
  programming error). The shared signer `cache` (D5.25) lives on `globalThis` (AGENTS.md: process-wide
  singletons).
- `wrangler.jsonc` (both Workers): `r2_buckets` += `{ "binding": "ORIGINALS", "bucket_name": "memoria-originals" }`;
  app `vars` += `MEDIA_S3_ORIGINALS_BUCKET`; `cf-typegen`. Guard `wrangler-config`: its media-var table
  gains `MEDIA_S3_ORIGINALS_BUCKET` (= the `ORIGINALS` binding's bucket); both Workers bind the same two
  buckets (looked up by binding name).
- `apps/web/r2-cors-originals.json`: PUT and GET from the app origins only, `content-type`, exposes
  `Content-Length`, `Content-Disposition`. `r2-cors.json` (public bucket) gains the production origin.

### The gallery library (`apps/web/src/lib/galleries/`)

- `parseGalleryInput.ts` (pure, shared with the form): title, date, client name (≤ 80, control/bidi
  stripped), client email (`parseEmailAddress`), purpose, access + password (8–64), sizes (bounds of
  Phase 4's `Size`), watermark flag (only if a watermark exists), theme/accent/font (registry ids), grid,
  sort.
- `gallerySettings.ts` (**import-free**: no logger, no `@/`; reachable from `worker.ts`, guard
  `edge-graph`, Phase 6 D6.6): `GallerySettings`, `parseGallerySettings(json)` → `{ value, invalid }`;
  `newGallerySettings(defaults, branding, watermark, input)` = the snapshot (D5.4).
- `keys.ts` (**import-free**, relay- and edge-safe): `originalKey(g, p, type)`, `thumbKey(g, p, rev, ext)`,
  `displayKey(g, p, rev, ext)`, `photoKeys(row)`.
- `sortKey.ts` (pure): `nameKey(filename)`, `sortKey(sort, nameKey, takenAt, id)`.
- `slug.ts` (pure): `slugBase(title)` (NFKD, a Bulgarian/Russian transliteration table, `[a-z0-9-]`,
  ≤ 40), `slugSuffix()` (10 of `[a-z2-9]` from `crypto.getRandomValues`), `isSlug`, `keepsSuffix(slug,
  suffix)`.
- `password.ts` (server-only): `sealGalleryPassword(id, plain)`, `openGalleryPassword(row)`,
  `generateGalleryPassword()`.
- `photoDependents.ts` (D5.24), `purge.ts` (jobs), `switchProcessing.ts` (M5).

### Routes

| Route | Does |
| --- | --- |
| `POST /api/admin/galleries` | parse → create (D5.3 slug; one set) → `{ data: { id, slug } }` |
| `GET /api/admin/galleries?cursor=&deleted=` | ≤ 50 galleries, newest first, with the cover's thumb URL (`deleted=1`: the Deleted filter with purge dates) |
| `GET /api/admin/galleries/[id]` | `{ …gallery (settings, counts, sets, the number of unfinished uploads), processing, watermark, imageUrl }`: the processing profile, its **snapshot** `Watermark` object (or null) and, for an image snapshot, `imageUrl` = Phase 4's `watermarkImageUrl(key, config)` — what the upload worker needs |
| `PATCH /api/admin/galleries/[id]` | title, date, client, readable slug part (D5.3), theme/accent/font/grid, welcome note, sort (D5.23), access + password; never the processing profile (D5.4) |
| `POST /api/admin/galleries/[id]/publish` · `…/unpublish` · `…/new-link` | status / slug + bump + audit |
| `DELETE /api/admin/galleries/[id]` · `POST …/restore` | D5.17 |
| `POST /api/admin/galleries/[id]/sets` · `PATCH/DELETE …/sets/[setId]` · `PUT …/sets/order` | sets (≤ 50) |
| `GET /api/admin/galleries/[id]/photos?set_id=&cursor=` | ≤ 200 photos (`ready` and `uploading`, hidden included) in `sort_key` order through `ix_photos_set_order`, JSON: id, filename, w, h, thumb URL, hidden, status, color; `cursor` = base64url of the last `sort_key` (≤ 700 characters; longer or malformed → 400); a set of another gallery → 404 |
| `POST /api/admin/galleries/[id]/photos/bulk` | `{ action: 'move' \| 'hide' \| 'show' \| 'delete', ids ≤ 90, setId? }` |
| `PUT /api/admin/galleries/[id]/cover` | `{ photoId }` |
| `POST /api/admin/galleries/[id]/uploads` | `{ setId, photos: ≤ 10 × { filename, contentType, sha256, bytes: { original, thumb, display }, width, height, displayWidth, displayHeight, derivativeExt, takenAt, color, meta } }` → per photo `{ sha256, status: 'new' \| 'resume' \| 'duplicate', photoId?, uploads?: { original, thumb, display } }`; a `setId` of another gallery → 400 `INVALID_SET` (composite FK); rate limit 600 an hour |
| `POST /api/admin/galleries/[id]/uploads/complete` | `{ photoIds ≤ 8 }` → `head()` ×3 each (D5.8) → `{ ready: [], failed: [{ id, reason }] }` |
| `POST /api/admin/galleries/[id]/email` | `{ to, name?, includePassword }` → 409 `NOT_PUBLISHED` for a draft; 409 `SITE_URL_REQUIRED` without a website address; else the `gallery.ready` email job (`to`, params `{ galleryId, includePassword }`) + audit `update { event: 'email' }` (no address), nudge (D5.20); 20 an hour |
| `GET /api/admin/galleries/[id]/email-preview?include_password=` | the template's `load` then `renderEmail('gallery.ready', …)` → `{ subject, html, text }` (the HTML shown in a sandboxed `iframe srcdoc`) |

All: `requireAdmin` first; `isUuid` on every id; the gallery must exist and not be deleted (404, except
restore); writes audited (ids and counts, never a password or an address).

### The browser pipeline (`apps/web/src/lib/images/`, client-only)

```
sniff.ts         magic bytes → 'image/jpeg' | 'image/png' | 'image/webp' | { unsupported: 'heic' | 'tiff' | 'raw' | 'gif' | 'video' | 'other' }
metadata/        tiff.ts (IFD walker: read tags; zero the GPS IFD, MakerNote, IFD1 and the free-text tags; drop
                 entries; bounds checks),
                 jpeg.ts (rebuild from the segment allow-list of D5.6: SOI, APP0, APP1 Exif, APP2 ICC, APP13,
                 APP14, DQT, DHT, SOFn, DRI, SOS + data, RSTn, EOI; everything else dropped),
                 iptc.ts (IRB/IPTC whitelist), pngWebp.ts (M2: "has metadata?" check only; M4: the editors),
                 read.ts (orientation, taken, camera…), strip.ts (D5.6: edit or refuse)
resize.ts        targetSize(w, h, longEdge) (never upscales), stepPlan(w, h, target) (halving steps), drawResized(bitmap, size)
encode.ts        encode(canvas, quality, convertToBlob = c => c.convertToBlob) → { blob, ext } (WebP, else JPEG; alpha on white)
placeholder.ts   averageColor(pixels: Uint8ClampedArray, w, h) → '#RRGGBB'
watermark.ts     Phase 4 (applyWatermark, watermarkBox)
upload.ts        Phase 4 (putToSignedUrl)
folders.ts       readDrop(dataTransfer) → { set: string | null, file }[] (webkitGetAsEntry; one level of subfolders)
process.worker.ts  per file: the steps of D5.5 → { original, thumb, display, sha256, dims, takenAt, color, meta }
pool.ts          createPool(workerFactory, { maxMegapixels }) — transferables, cancellation
uploader.ts      the queue: process → register (REGISTER_BATCH) → PUT via putToSignedUrl (4 parallel, 1 retry) → complete (COMPLETE_BATCH); events for the UI
```

- A file over `MAX_UPLOAD_BYTES` or with more than 100 megapixels is refused before decoding.
- `targetSize` never upscales: a 1200 px upload in a 1600 px selection gallery gets a 1200 px display copy
  (the original is still never served, D5.1 + Phase 6).
- **Folders** (D5 folder drop, M2): each first-level subfolder becomes a set (created by name, or the
  existing set of that name); files at the top go to the set chosen in the manager; deeper levels are
  flattened into their first-level set. The upload panel lists the sets it will create before starting.
- Memory: one decoded bitmap per worker at a time, closed after encoding; transfers, not copies.
- The page warns on `beforeunload` while uploading; the uploader is a module-level store the manager
  subscribes to (`useSyncExternalStore`), so switching sets keeps it running.
- **Testability**: the pure cores take plain data (`averageColor` on pixels, `encode` with an injected
  `convertToBlob`, `createPool` with a fake worker factory, `applyWatermark` with a recording fake 2D
  context, the metadata editors on byte fixtures); decoding, canvas drawing and real workers are
  Verification 3 (manual, three browsers).

### Screens

- **Galleries** (`/admin/galleries`): `PageHeader` with *New gallery*; a grid of cards (cover thumb,
  title, a status pill — Draft/Live, purpose, count, date); empty state with a call to action; a
  *Deleted* filter with *Restore* and the purge date; paged client-side.
- **New gallery** (`/admin/galleries/new`): one column of `SettingsCard`-like sections in the mockup's
  order: Details (name, date, client name, client email, gallery address = the readable slug part + the
  random part shown greyed), **Purpose** (`RadioCards`: "Selection — your client chooses favourites. They
  see smaller, watermarked previews; full-size files can't be downloaded. You deliver later." /
  "Sharing — final photos. Full-size downloads when downloads open." and the line "This choice sets the
  image sizes and watermark for this gallery's uploads."; display size and quality under "Advanced", from
  the defaults), Who can open it (Link / Password + *Generate*), Look (theme, accent, font with the
  gallery title as the sample, grid), Order (filename / capture time), Watermark (Toggle, a thumbnail of
  the studio watermark). The right column shows a live **cover preview** (title in the chosen font and
  theme). **Create gallery** → the manager.
- **Gallery manager** (`/admin/galleries/[id]`): header (title, status pill, counts, *View as client* —
  disabled "Soon" until Phase 6 T6.4 wires it to the preview link —, *Add photos*, *Share*); Tabs *Photos*
  · *Settings* (Selections, Downloads, Activity come with Phases 8, 9, 11; Store never); a banner "N
  unfinished uploads — drop the same files to finish; unfinished uploads are removed after 24 hours" when
  any exist; left rail: sets (drag handle + up/down buttons for the keyboard, rename inline, *Add set*);
  main: the drop zone (files or folders; collapsed when the set has photos), the upload panel (counts,
  bytes, ETA, sets to create, duplicates skipped, unsupported files with reasons, failed with Retry), the
  grid (thumbs at their aspect ratio, `loading="lazy"`, a checkbox per photo, badges *Cover* and
  *Hidden*), the bulk bar when something is selected (Move to set, Hide/Show, Set as cover — one photo,
  Delete with a confirm dialog).
- **Sharing panel** (a `Dialog` from *Share*): Publish / Unpublish (with "N photos are still uploading and
  won't be visible yet" when relevant); the link with Copy, an on-screen QR code (`uqr` SVG), *New link*
  (confirm: "the old link stops working; images already opened stay viewable"); the password (shown,
  Copy, Change, *Generate*); *Email the client* (address defaulted from the gallery, name, "include the
  password", the preview, Send → a status line like Phase 3's; the button is disabled with a hint while
  the gallery is a draft ("Publish the gallery first") or the studio has no website address (the
  Settings → Studio hint)).
- **Delete** (manager → Settings tab): a danger card; the confirm dialog asks for the gallery's title.

### Jobs (relay-safe, `apps/web/src/lib/galleries/purge.ts`)

- `media.purge` (v1, payload `{}`; 5 attempts, priority 1, backoff 5, 30, 120 min): claims ≤ 90 stale
  uploads (`claimStaleUploadsStatement`, D5.17); lists ≤ 90 `deleted` photos (`listPurgeablePhotos`:
  `WHERE status IN ('uploading', 'deleted') AND status = 'deleted' ORDER BY updated_at LIMIT 90`, partial
  index); deletes their original keys (`blobs('originals').delete`) and derivative keys
  (`blobs('media').delete`); then one batch: `PHOTO_DEPENDENT_DELETES` (D5.24) and `DELETE FROM photos
  WHERE id IN (…) AND status = 'deleted'`; if 90 were found, the same batch enqueues the next
  `media.purge` with the same `when` (no key, no nudge). No recount: deleted and uploading photos are
  never counted.
- `gallery.purge` (v1, `{ galleryId, run }`, `ref = gallery:<id>`): a gallery that is gone or restored
  (`deleted_at` NULL) → done, nothing to do; `deleted_at > ?now−7d` (clock skew, an early cron) →
  **re-enqueues itself at `deleted_at + 7d`** and finishes (D5.17); otherwise takes ≤ 90 of the gallery's
  photos **directly** (any status, no marking); deletes their objects; then one batch: the dependents,
  `DELETE FROM photos WHERE gallery_id = ? AND id IN (…) AND EXISTS (SELECT 1 FROM galleries WHERE id = ?
  AND deleted_at <= ?)`; when none are left, `batch([DELETE photo_sets …, DELETE galleries … AND
  deleted_at <= ?, audit delete { event: 'purged' }])`; otherwise enqueues `gallery.purge` `{ galleryId,
  run: run + 1 }`. **Every `gallery.purge` enqueue** (the delete route, the self-reschedule, the chain,
  housekeeping) uses `when: NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'gallery.purge' AND ref = ? AND
  status IN ('pending', 'running'))` and no dedupe key (the chain and the reschedule run inside the
  current job, so their condition excludes the running job by id: `… AND id != ?currentJobId`).
- `housekeeping` gains two steps: enqueue `media.purge` with `when: NOT EXISTS (pending media.purge) AND
  EXISTS (SELECT 1 FROM photos WHERE status IN ('uploading', 'deleted') AND (status = 'deleted' OR
  updated_at < ?now−24h))` (partial index); and enqueue `gallery.purge` for up to 10 galleries with
  `deleted_at <= ?now−7d` (via `ix_galleries_list`), each with the condition above — so a purge that
  failed its last attempt self-heals the next day. Housekeeping never prunes unfinished jobs, and a
  pending `gallery.purge` (due at +7 d) would only expire 7 days after that.
- Logs: `purge_run { kind, galleryId?, deleted, more }`; failures are the runner's `job_failed` (named
  `purge_failed` in the runbook); both kinds self-heal through housekeeping; Phase 11's dashboard lists
  failed jobs.
- `purge.ts` imports only query modules, `keys.ts`, `photoDependents.ts` and the audit builder; guard
  `relay-graph` checks it. Both kinds are registered and the relay deployed before the app enqueues them
  (D3.14).

### Email (`lib/email/templates/galleryReady.ts`; `lib/email/types.ts` and `lib/email/job.ts` changed)

- `EmailTemplate<P, R = P>` gains `load?(params: P, ctx: { opts?: Options; to: MailAddress }): Promise<R>`;
  `render(value: R, ctx)`. `lib/email/job.ts` `run`: `parse` → `await template.load?.(params, { to })` →
  `render` → send; the preview route does the same without sending.
- `gallery.ready`'s `load({ galleryId, includePassword }, { to })` → `{ galleryTitle, purpose, clientName:
  to.name ?? null, path: '/g/<slug>', password: includePassword ? openGalleryPassword(row) : null }`; a
  deleted or missing gallery → `JobError('GALLERY_GONE', { permanent: true })`; a draft →
  `JobError('GALLERY_UNPUBLISHED', { permanent: true })`; a password that cannot be unsealed →
  `MailError('MAIL_SECRET_UNREADABLE', { configuration: true })` (retried, like `unsealMailSettings`;
  the runbook covers it). `views.ts` gains a sentence for `GALLERY_GONE` and `GALLERY_UNPUBLISHED`.
- Template: subject "{galleryTitle} — your photos are ready" (the title stripped of control characters;
  the client's name never in the subject, D3.15's rule kept anyway); `renderLayout(ctx, { heading,
  paragraphs, action })`: a greeting (with the client's name when given), one paragraph from the purpose
  ("Choose your favourites and submit your selection" / "Your photos are ready to view and download"), the
  password when given, a button to `ctx.link(path)`. Phase 4 M2 makes the text editable.

### Primitives (T5.9, commit 6)

`scrim` colour token (`rgb(22 23 26 / <alpha-value>)`, count badges on photos), the selectable `Chip`
(`packages/ui/chip.tsx`, pill, 1.5 px border, 44 px on coarse pointers; set chips), `Tabs`
(`packages/ui/tabs.tsx`, roving tabindex, `aria-selected`); each on `/admin/design` with contrast rows.
Phase 6 uses all three.

### Logs

`upload_registered { galleryId, count, duplicates, resumed }`, `upload_head_failed { photoId, reason }`,
`upload_completed { galleryId, count }`, `purge_run`, `gallery_settings_invalid { galleryId, fields }`;
never a filename, a password or an address.

## Workstreams

### A. Storage (M1)

- **T5.1** The originals bucket: port `blobs(bucket)`, the test platform (`blobs: { media, originals }`)
  and `testing/proxy.ts`, contract runs per bucket, `blobUrls` `{ bucket }` and the shared signer cache
  (D5.25), dev token bucket, `Config.media.s3.originalsBucket`, both `wrangler.jsonc`, `cf-typegen`,
  guard rules, `r2-cors-originals.json`.

### B. Galleries (M1)

- **T5.2** Migration `0006_galleries.sql`; query modules `galleries`, `photo_sets`, `photos` with their
  race tests.
- **T5.3** `lib/galleries` (settings, keys, sort key, slug, password, `parseGalleryInput`,
  `photoDependents`); the create/list/get/patch/publish/new-link routes; the Galleries list and New
  gallery pages; nav entries drop `soonPhase`.

### C. Upload (M2)

- **T5.4** The pipeline libraries (`sniff`, `metadata/*` — JPEG editor, PNG/WebP "has metadata?" check —,
  `resize`, `encode`, `placeholder`, `folders`), the worker, the pool; `npm i -D exifr` (root
  `package.json`, test-only); fixtures in `apps/web/src/lib/images/fixtures/` (small JPEGs with GPS in
  EXIF, XMP, ExtendedXMP, IPTC location, MPF, an IFD1 thumbnail, a MakerNote; rotated; without metadata;
  truncated; PNG/WebP with and without metadata).
- **T5.5** The upload routes; `uploader.ts`; the drop zone (files and folders), the upload panel and the
  unfinished-uploads banner in the manager.

### D. Manager, sharing, delete (M3)

- **T5.6** Sets, the photos API, the grid, selection, the bulk bar, cover (and its default), sort;
  **the `media.purge` kind and its relay registration** (photo delete in the bulk bar enqueues it, and
  `jobStatement` refuses an unregistered kind).
- **T5.9** `Chip`, `Tabs`, `scrim` (same commit as T5.6).
- **T5.7** Sharing panel: publish, link, QR, *New link*, password; the optional template `load` step
  (`lib/email/types.ts`, `job.ts`, `views.ts`), `gallery.ready`, preview, send, `NOT_PUBLISHED`,
  `SITE_URL_REQUIRED`.
- **T5.8** Soft delete, restore, `gallery.purge` (`media.purge` exists since T5.6), the housekeeping step, the Deleted
  filter.

### E. After the first usable version (M4)

- **T5.10** Presets in New gallery (Phase 4 M2) and "Save as preset".
- **T5.11** Auto-split by capture-time gaps (pure `splitByGaps(photos, minGapMinutes)`; suggested,
  confirmed by the photographer).
- **T5.13** Smart filters (hidden; favourites and comments with Phase 7), custom drag order (a new sort
  value writing `sort_key`), Shift-click ranges, a downloadable QR, draft autosave, IndexedDB resume.
- **T5.14** The PNG and WebP metadata editors (`eXIf`/`EXIF` edited; XMP, text and raw-profile chunks
  dropped; CRCs, RIFF sizes, VP8X flags, odd-size padding).

### F. Before Phase 8 (M5)

- **T5.12** *Replace with edited version*: match = case-insensitive filename without its extension and
  without a trailing `-edit`, `-edited` or ` edit`, or a manual pick; replaces a subset (typically ~50
  edits among ~800 proofs); the same photo id, a new `rev`, the current processing profile; the previous
  objects deleted after the new ones pass `head()` (D5.26).
- **T5.13b** *Reprocess*: re-runs the pipeline from the originals (downloaded through short-lived
  presigned GETs minted by an admin route — the one exception to "downloads only", documented in
  AGENTS.md then) with the current profile.
- **T5.15** `switchProcessingStatement` for Phase 8's deliver.

### G. Docs (each in its commit)

- Commit 1: `architecture.md` → Media (two buckets, which holds what, D5.1); AGENTS.md → Media rules
  (originals only in `memoria-originals`; `blobs(bucket)`); recipes.md → *A binding* (per-bucket stores);
  **deployment.md → Media: an ordered owner checklist** — (1) `npm run wrangler -- r2 bucket create
  memoria-originals` in the same location as `memoria-media`; (2) `npm run wrangler -- r2 bucket cors set`
  for both buckets (`r2-cors.json` with the production and public-domain origins, `r2-cors-originals.json`);
  (3) a **separate R2 S3 API token** made in the dashboard (Object Read & Write on both buckets) →
  `npm run wrangler -- secret put` for the `MEDIA_S3_*` secrets, `MEDIA_S3_ENDPOINT` in vars; (4) the
  public custom domain on `memoria-media` only, its DNS, `MEDIA_PUBLIC_BASE_URL` — **this var and
  `MEDIA_S3_ENDPOINT` are baked into the CSP at `next build` (Phase 4 D4.15): changing either needs a
  rebuild and deploy, not just a dashboard edit**; (5)
  `MEDIA_S3_ORIGINALS_BUCKET`; (6) deploy relay, then app; (7) `npm run media:probe` against the real
  buckets. **deployment.md → Backups**: R2 is not backed up (D1 export and Time Travel only); originals
  are irreplaceable; a purge is irreversible after its 7 days; options (an `rclone` copy to an external
  store, R2 object versioning when available) and the owner's choice (open question 11).
  **deployment.md → Secrets**: rotating `SETTINGS_ENCRYPTION_KEY` = re-enter the mail secret, set every
  gallery password again, and every gallery cookie ends (Phase 6).
- Commit 2: `architecture.md` → Data (the three tables, the budgets); deployment.md → *Migration
  rehearsal*: `npm run wrangler -- d1 export` of production → import into a scratch local D1
  (`--persist-to <dir>`) → apply `0006` locally → only then `db:migrate:remote`; rollback = a forward fix.
- Commit 5: `architecture.md` → *Upload* (the pipeline and the two-phase flow); AGENTS.md → Where to look
  (`lib/images/`, `lib/galleries/`).
- Commit 7: recipes.md → *An email template* gains the optional `load` step.
- Commit 8: `architecture.md` → Jobs (the purge kinds, the hooks).

## Tests

| Test | What |
| --- | --- |
| `queries/galleries/galleries.test.ts` | create + read back; slug UNIQUE → conflict; every CHECK refuses its bad row (slug shapes, purpose, status/published pair, access/password pair, delivery, settings JSON and size, negative counts); `listGalleries` excludes deleted (and lists them with `deleted`), pages by `created_at`; publish twice → one change, `first_published_at` kept across unpublish/publish; access change keeps the password CHECK; soft delete twice → one change; restore at 6 days 23 h succeeds, at 7 days changes nothing; cover set only for a ready, **visible** photo of the same gallery (a hidden one refused); the PATCH `json_patch` keeps fields another write changed in between; the guarded bump does not move on a no-op batch; the cover default picks the first landscape by set position then `sort_key`, falls back to a portrait, and does nothing when a cover exists; `content_version` bumps by exactly one per batch |
| `queries/photo_sets/photo_sets.test.ts` | FK refuses an unknown gallery; `uq_photo_sets_id_gallery` holds; reorder of 50 sets in two statements; the 51st set refused; delete refuses the last set and a set with any photo row, a `deleted` one included (409, never an FK error); increment adds only photos marked in that batch and 0 on a repeat; recount equals the real count |
| `queries/photos/photos.test.ts` | insert; duplicate sha256 → no row, `RETURNING` empty; re-mint rewrites every field but `rev`; a deleted photo's hash is free again (`NULL`), and `sha256 NULL` with `status = 'ready'` **is refused** (the corrected CHECK); FKs refuse an unknown set or gallery (proves D1 enforces them) and **a set of another gallery** (composite FK); the register `INSERT … SELECT` inserts nothing for a soft-deleted gallery; `sort_key` is composed from the gallery's current sort (a resort committed between two registrations leaves both in the new order); the stale-upload claim skips a row completed or re-minted in between; mark ready only from `uploading`, twice → once; bulk statements touch only the gallery's ready photos and refuse > 90 ids; `listSetPhotos` order and cursor for both sorts, hidden photos interleaved in order; `resortStatement` reorders; purgeable = deleted or stale uploading, bounded; `EXPLAIN QUERY PLAN` of the claim, the purgeable list and the housekeeping `EXISTS` shows `ix_photos_purge`, and of the client and manager pages `ix_photos_set_order` (where the test D1 allows `EXPLAIN`); CHECKs (type, sha256, rev, ext, status, hidden, dims, JSON) |
| `lib/galleries/sortKey.test.ts` | table: natural order (`IMG_9` < `IMG_10`, `a2` < `a10`, case, diacritics, Cyrillic), missing `taken_at` → `~` (last), a 255-character filename and a digit-heavy one (`1-1-1-…`) → `name_key` ≤ 120 characters after padding and a cursor ≤ 700, uniqueness by id; a remint that changes the filename gets a `sort_key` from the new name (test D1); the SQL composition matches the code reference for both sorts (test D1) |
| `lib/galleries/slug.test.ts` | table: Latin, Cyrillic (Bulgarian and Russian), diacritics, emoji, empty → `gallery`, 120 characters → ≤ 40 + `-` + 10; suffix alphabet and length; `keepsSuffix` |
| `lib/galleries/gallerySettings.test.ts` | each field's default; an invalid field reads as its default and is reported in `invalid`; the snapshot copies defaults, branding and watermark; the module has no imports (source check) |
| `lib/galleries/password.test.ts` | seal/open round trip; another gallery's AAD → null; generated passwords' shape and length ≥ 8 |
| `lib/images/sniff.test.ts` | table of magic bytes: JPEG, PNG, WebP (lossy, lossless, extended), HEIC, TIFF, CR2/NEF, GIF, MP4, text |
| `lib/images/metadata/*.test.ts` | JPEG fixtures: GPS removed (the IFD0 count one less, the next-IFD pointer moved, the freed and GPS bytes zero), MakerNote and IFD1 gone, XMP and ExtendedXMP dropped, MPF and post-EOI data dropped, ICC kept, IPTC reduced to the four records (city/country gone), the 0x040C thumbnail gone; **one fixture per dropped kind** — COM, APP3–APP12, APP15, `ImageDescription`, `UserComment`, `XPTitle`/`XPComment`/`XPKeywords`/`XPSubject`/`XPAuthor`, `CameraOwnerName` — each absent from the output while `Artist` and `Copyright` stay; the output's segment list is exactly the allow-list; **scan data byte-identical** (hash of the entropy-coded segment); `exifr` reads no latitude/longitude and no XMP from any output; orientation, `DateTimeOriginal`, camera read; SubIFDs, a second EXIF segment, an unparsable IRB, a GPS offset outside the segment, truncated data → refused; PNG/WebP: without metadata → accepted unchanged, with `eXIf`/`EXIF`/`XMP `/`tEXt` → refused |
| `lib/images/resize.test.ts` | `targetSize` table (landscape, portrait, square, smaller than the target → unchanged); `stepPlan` halving steps |
| `lib/images/encode.test.ts`, `placeholder.test.ts`, `pool.test.ts` | `encode` with a fake `convertToBlob` returning PNG → falls back to JPEG with `ext: 'jpg'`, alpha painted on white (recording fake context); `averageColor` on known pixels; the pool caps decoded megapixels in flight and cancels |
| `lib/images/folders.test.ts` | a fake `webkitGetAsEntry` tree: subfolders → set names, top-level files → the chosen set, deeper levels flattened |
| `lib/images/uploader.test.ts` | with fake processing and fetch: batches of 10 and 8; duplicates counted; `resume` re-PUTs; a failed PUT retried once then reported; complete only for PUT-successful photos; cancel stops the queue; events in order |
| route tests | 401/403 everywhere; ids not UUID → 404; deleted gallery → 404; create: 400 per field (password < 8), slug conflict 409, audit without password; PATCH: a link gallery's slug without its random part → 400; new link changes the slug; uploads: > 10 photos 400, type outside `MEDIA_TYPES` 400, sizes over the limits 400, keys under the gallery's prefix in the right buckets (test platform), duplicate/resume statuses, an extension change on resume deletes the old keys, 429; complete: > 8 → 400, missing object → failed `UPLOAD_MISSING`, wrong size/type → failed and the object deleted, success → ready + set count + gallery count + cover + `content_version`; bulk: move to a set of another gallery → 400, the guard hook is called, hiding already-hidden photos changes nothing and leaves `content_version`; uploads with another gallery's `setId` → 400 `INVALID_SET`; uploads to a soft-deleted gallery → 404; cover: a hidden photo → 400; photos list: a cursor over 700 characters → 400; email: a draft → 409 `NOT_PUBLISHED`; no website address → 409 `SITE_URL_REQUIRED`; job enqueued with params `{ galleryId, includePassword }` and **no job row ever contains the password** (scan of `jobs.payload`), audit without the address, one nudge, 429; preview = the template's `load` + `renderEmail`; `GET …/[id]` returns `processing`, the snapshot `Watermark` object (a text one too) and `imageUrl` for an image snapshot |
| `email/galleryReady.test.ts` | `load` unseals only when asked; fails `GALLERY_GONE` (permanent) for a deleted or missing gallery, `GALLERY_UNPUBLISHED` (permanent) for a draft, `MAIL_SECRET_UNREADABLE` (configuration) for a password that will not unseal; `lib/email/job.ts` awaits `load` before `render` and a template without `load` still renders its params; `views.ts` has sentences for both new codes; escaping of title and name; link through `ctx.link`; no name in the subject; registered in `EMAIL_TEMPLATES` |
| `galleries/purge.test.ts` | runner + test D1 + in-memory buckets: `media.purge` deletes both buckets' keys then rows, runs the dependent deletes first, chains when 90 found, ignores a ready photo and one completed between claim and delete; two deletes enqueue one pending job; `gallery.purge` run early re-enqueues itself at `deleted_at + 7d` (not done-and-forgotten), does nothing for a restored gallery, deletes photos directly, chains with `run + 1`, finally deletes sets and the gallery with an audit row; a second delete-route enqueue, a chain or a housekeeping enqueue never creates a second live `gallery.purge` for the same gallery; `deleted_at` and `runAfter` come from one `?now`; housekeeping enqueues `media.purge` only when work exists and none is pending, and `gallery.purge` for a gallery past 7 days whose purge job failed (≤ 10 a day) |
| platform tests | `blobs('originals')` and `blobs('media')` are distinct stores (contract suite per bucket, workerd and memory); `blobUrls` signs the originals bucket path; the signer cache is reused across URLs (a spy on key derivation); dev token bucket honoured by the dev routes; `publicUrl` on originals throws |
| guards | `wrangler-config`: `MEDIA_S3_ORIGINALS_BUCKET` = the `ORIGINALS` binding, both Workers bind both buckets; `relay-graph` passes with `lib/galleries/purge.ts`, `lib/galleries/password.ts` and `lib/email/templates/galleryReady.ts`; `edge-graph` (Phase 6) will include `gallerySettings.ts` and `keys.ts` |
| component tests | New gallery: defaults prefilled, purpose copy, password Generate, slug preview with the fixed random part; manager: selection, bulk bar actions call the API and refresh, set rename/reorder by keyboard, the unfinished banner; upload panel states and the sets-to-create list; sharing: copy, QR rendered, *New link* confirm, email disabled without a website address, preview in a sandboxed iframe; `Chip`, `Tabs` (keyboard) |

## Risks and edge cases

- **Admin CPU on the free plan.** Every screen and API route here runs through Next (page ≈ 8 ms, route
  ≈ 6 ms measured, before any work). Registration signs up to 30 URLs (with the cached signing key,
  D5.25) and completion makes up to 24 `head()`s: Verification 5 measures both; if p95 > 10 ms, halve the
  batch sizes; if still over, that is the Workers Paid trigger (the owner's Phase 6 decision covers the
  admin too).
- **D1 write budget**: ≈ 6k rows written per 800-photo upload (index writes included); ceilings in
  *Budgets*. A day of heavy re-sorting or mass deletion is the realistic way to approach 100k.
- **R2 storage**: an 800-photo wedding at ~1 MB per Lightroom export + ~300 KB display + ~70 KB thumbnail
  ≈ 1.1 GB; the free 10 GB holds about nine such galleries, then $0.015 per GB-month (100 GB ≈ $1.4 a
  month). Uploads: 3 Class A operations per photo (2,400 per wedding against 1M a month).
- **No R2 backup**: originals are irreplaceable and only in `memoria-originals`; deployment.md says so and
  open question 11 asks the owner for a backup choice.
- **Location in unexpected places**: vendor MakerNotes and IFD1 thumbnails are removed; IPTC is
  whitelisted; XMP is dropped; anything unknown is refused. PNG/WebP with metadata are refused until M4.
- **Safari**: JPEG derivatives instead of WebP (larger files); the gallery handles both extensions; a
  resume from another browser cleans up the other extension (D5.9).
- **Very large originals** (camera JPEGs of 40+ MP): ~200 MB per decoded image; the pool caps decoded
  megapixels in flight (D5.5). The development blob routes accept ≤ 32 MB, so originals above that are
  tested only against real buckets (Verification 4).
- **`SETTINGS_ENCRYPTION_KEY` rotation** makes every sealed gallery password unreadable (no key
  versioning): the manager then asks for a new password per gallery; the gallery email with a password
  fails `MAIL_SECRET_UNREADABLE` (configuration, retried until the password is set again); Phase 6's
  cookies end; deployment.md → Secrets says so.
- **Build-time CSP**: `MEDIA_PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT` are baked into the headers at `next
  build` (Phase 4 D4.15); setting the public domain later means a rebuild and deploy (owner checklist).
- **Purge CPU** per relay run (90 rows, two R2 deletes of ≤ 270 keys, one batch) is unmeasured:
  Verification 5 measures it; above 10 ms, the run size drops.
- **Migration 0006** is forward-only once applied; it is rehearsed on a copy of production first
  (commit 2 docs). Rolling back the app after it is harmless (old code ignores the new tables); rolling
  back the relay after purge jobs were enqueued defers them as unknown kinds for up to 24 h, then fails
  them (a retry after redeploying recovers).
- **Colour**: canvas output is sRGB; a Display-P3 export loses its wide gamut in derivatives (the original
  keeps its profile).
- **A presigned PUT cannot enforce the size**: completion's `head()` does, and deletes an object that
  disagrees.
- **Public-mode revocation**: a former visitor who kept image URLs can still load thumbnails and display
  copies after a password change, unpublish or *New link* (public CDN). Protected delivery (Phase 6 M2) is
  the answer when that matters; originals are never public.
- **Slug edits and New link break shared links**: both warn; the old slug is not kept as a redirect.
- **A tab closed mid-upload** leaves `uploading` rows: the banner explains; re-dropping finishes; after
  24 h the relay removes them.

## Verification

1. `npm run verify`; `npm run build:relay`.
2. **Local** (`npm run dev` + `npm run dev:relay`): create a selection gallery (watermark on) and a
   sharing gallery; drop a folder with two subfolders and 50 mixed files (Lightroom JPEGs, a PNG and a
   WebP without metadata, a PNG with EXIF, a HEIC, a video, a duplicate, a rotated photo, one with GPS in
   EXIF and XMP and IPTC city): two sets created; unsupported, refused and duplicate files reported; the
   rest ready in filename order; the cover is the first landscape; the downloaded original (dev read route)
   has no GPS, XMP or IPTC location (`exiftool -gps:all -xmp:all -iptc:all`) and identical pixels; display
   copies have the watermark and the configured long edge; placeholder colours show while thumbs load.
   Close the tab mid-upload: the banner appears; drop the same files: the rest finish, nothing doubles.
   Switch the sort to capture time. Sets, move, hide, cover, delete; email the link without a website
   address (refused), then with one (Mailpit receives it; the jobs table holds no password). Delete the
   gallery, restore it; delete again and run the purge with the clock moved (`wrangler d1 execute --local`
   on `deleted_at`): objects gone from both local buckets, rows gone. Check that the module worker's
   requests pass the CSP (no console violations).
3. **Browsers**: the pipeline in current Chrome, Firefox and Safari (JPEG fallback there; the rotated
   fixture upright), recording the time per photo for 50 Lightroom exports.
4. **Real buckets** (after the owner's checklist in deployment.md → Media, index question 3): `npm run
   preview` uploads 20 photos (one original above 32 MB) through presigned PUTs; the public URL of a
   display copy loads; the original's key on the public domain answers 404; a PUT with another
   Content-Type is refused (Phase 1 Verification 5 included); `npm run media:probe` passes.
5. **Budgets** (production, the owner deploys): `npm run measure:cpu` on the uploads (10 photos) and
   complete (8 photos) routes and on the photos list; the relay tail's `cpuTime` for a `media.purge` run of
   90 photos; the D1 dashboard's rows written for an 800-photo upload; record the numbers here and in the
   batch-size constants.
6. Manager and New gallery at 360 px and 1440 px; keyboard only through selection, the bulk bar and sets.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `feat(media): the private originals bucket` | T5.1 | `npm run preview` boots with both buckets |
| 2 | `feat(galleries): galleries, sets and photos tables` | T5.2 | `db:migrate:local`; the rehearsal documented |
| 3 | `feat(galleries): new gallery and the galleries list` | T5.3 | create and list locally |
| 4 | `feat(upload): the browser image pipeline` | T5.4 | fixtures pass; Verification 3 (pipeline only) |
| 5 | `feat(upload): register, upload and complete` | T5.5 | Verification 2 (upload part) |
| 6 | `feat(galleries): the gallery manager` | T5.6 (incl. `media.purge`), T5.9 | Verification 6; a deleted photo's objects are purged by a local drain |
| 7 | `feat(galleries): sharing and the gallery-ready email` | T5.7 | an email reaches Mailpit; no password in `jobs` |
| 8 | `feat(galleries): delete, restore and purge` | T5.8 | Verification 2 (purge part) |
| 9 | `docs: Phase 5 M3 done` | docs | Verification 4–5 when the buckets and domain exist |

Milestones: **M1** = commits 1–3 (galleries exist), **M2** = commits 4–5 (photos upload end to end),
**M3** = commits 6–9 (managed, shared, deletable: Phase 5's part of the first usable version), **M4**
(after the first usable version) = T5.10, T5.11, T5.13, T5.14, **M5** (before Phase 8) = T5.12, T5.13b,
T5.15.

Migration `0006` ships with the first deploy after commit 2 and is forward-only from then; the relay
must be deployed with the purge kinds and the `gallery.ready` template before the app enqueues them
(commits 6–8: relay first, D3.14).

## Checklist

- [x] T5.1 Originals bucket, per-bucket stores, signer cache
- [x] T5.2 Migration and query modules
- [x] T5.3 Gallery library, create/list/get/patch/publish/new-link, New gallery and Galleries pages
- [x] T5.4 Pipeline libraries (JPEG editor), folders, worker, pool
- [ ] T5.5 Upload routes, uploader, drop zone, panel, unfinished banner
- [x] T5.6 Manager: sets, grid, selection, bulk bar, cover and its default, sort
- [x] T5.9 `Chip`, `Tabs`, `scrim`
- [x] T5.7 Sharing panel, the template `load` step, `gallery.ready`
- [ ] T5.8 Soft delete, restore, purge jobs
- [ ] Verification 1–3, 6 (4–5 once the buckets, the domain and a deploy exist)
- [ ] M4: T5.10 presets · T5.11 auto-split · T5.13 filters, drag order, ranges, QR download, autosave, IndexedDB · T5.14 PNG/WebP editors
- [ ] M5: T5.12 replace with edited · T5.13b reprocess · T5.15 processing switch

## Built

**Commit 1 (T5.1), 2026-11-19.** As designed, plus:

- **Five S3 settings, not four**: `Config.media.s3` is null unless `MEDIA_S3_ORIGINALS_BUCKET` is set too
  (`S3Config.originalsBucket`), so a half-configured production never mints for one bucket only.
- **The dev token's `b` is required** (`'m' | 'o'`, `bucketOfToken` in `blobToken.ts`); a token without it
  is invalid (they live minutes, so nothing outstanding breaks).
- **`publicUrl(key, { bucket })`** takes the bucket only to refuse `originals` (throws a plain `Error`: a
  programming error, not a 400).
- **The signer cache** is `signerCache(accessKeyId)` in `blobUrls.ts` (a `Map` per access key on
  `globalThis`); the test counts `crypto.subtle.sign` calls: a warm URL costs one HMAC, a cold one five.
- **`useTestPlatform({ blobs: { media?, originals? } })`** replaces `blobs: BlobStore` (one caller, its
  own test); the contract runs on the test platform's originals store and on both workerd buckets.
- **`npm run media:probe -- <url> --originals`** round-trips through the originals bucket and checks the
  object is absent from the other one (both directions).
- Gate: `npm run build:worker` + `wrangler dev` (port 8788, scratch state) lists `MEDIA` and `ORIGINALS`;
  `/healthz` 200, `/admin` 307; the probe passes for both buckets. 1818 tests.

**Commit 2 (T5.2), 2026-11-19.** As designed, plus:

- **More CHECKs**: `ck_galleries_shoot_date` (a real date), `ck_galleries_client` (name ≤ 80, address ≤
  254), `settings` must be a JSON *object*, `password_version >= 1`, `ck_galleries_deleted_at` and
  `ck_photos_updated_at` (exactly `Date#toISOString()`: the restore/purge windows and the stale claim
  compare them as text), `ck_photos_keys` (`name_key` ≤ 120, `taken_key` 1–19, `sort_key` ≤ 200),
  `ck_photos_color` (`#RRGGBB`, `substr` + one class: six GLOB classes are "too complex" for D1).
- **`GalleryRow.settings` is the stored JSON object as is**; the typed `parseGallerySettings` (import-free,
  commit 3) is applied by `lib/galleries`, whose caller logs what was invalid — the query module stays
  free of the logger and of the settings registry. `GalleryRow` has no `password_sealed`
  (`getGalleryPasswordSealed` only; a test pins the column list).
- **`clearCoverStatement(galleryId)` takes no id list**: it clears a cover that is no longer a visible
  ready photo of the gallery, whatever the batch did (hide, move out, delete).
- **No-op writes write nothing**: `galleryCountStatement` and `recountSetsStatement` write only when the
  count differs, `renameSetStatement` only when the name does, `setCoverStatement` only a new cover — rows
  written are the budget.
- **Gallery-purge statements** beyond `deleteGalleryStatement` and `deleteGallerySetsStatement` come with
  commit 8; `media.purge`'s claim, list and row delete are here with their tests.
- Gate: wrangler applied 0001–0006 to a scratch local D1 (`--persist-to`), not the owner's; the
  `EXPLAIN QUERY PLAN` test shows `ix_photos_purge` for the claim and the purgeable list and
  `ix_photos_set_order` for a set page. Docs: architecture.md → Data; deployment.md → the migration
  rehearsal (`.rehearsal/` ignored).

**Commit 3 (T5.3), 2026-11-19, in two commits.** `523eabb` landed the pure modules first
(`gallerySettings.ts`, `keys.ts`, `sortKey.ts`, `slug.ts` and their tests) so Phase 6's T6.3 could start
on them; this commit adds the rest. Different from the design above:

- **`gallerySettings.ts` has no imports at all**, so it cannot check accent and font ids against the
  registries: it checks their shape and the user of the value resolves them (an unknown one → the
  default there); its copies of Phase 4's defaults and bounds are pinned by its test.
  `newGallerySettings` is not a function of its own: `createGallery` (`lib/galleries/galleries.ts`)
  builds the snapshot from the parsed input, which the route prefilled from `readGalleryDefaults` and
  `readBranding`.
- **The watermark flag with no studio watermark** is 400 `WATERMARK_NONE` (the form disables the toggle).
- **A link gallery's slug**: `slugBase` changes the readable part and keeps the random one; `slug`
  (the whole address) only on a password gallery (400 `SLUG_SUFFIX_REQUIRED` otherwise); switching a
  custom-address password gallery to link appends a fresh random part.
- **Publish/unpublish chain their guards**: the bump runs only if the status changed (`changes() > 0`)
  and the audit only if the bump did, so a repeat writes nothing.
- **`randomString` (keys.ts)** serves both the 8-character `rev` and the 10-character slug suffix
  (rejection sampling over `[a-z2-9]`). Passwords: two of 64 words and two digits.
- **The galleries list fetches the envelope itself**: `useApi` unwraps `data` and would drop `next`.
- **`/admin/galleries/[id]` is a first page** (status, Publish/Unpublish, address, sets) where *Create
  gallery* lands; the manager replaces it in commit 6. Nav: Galleries and *New gallery* are links now.
- `photoDependents.ts` (D5.24) is in, empty. The count of unfinished uploads in `GET …/[id]` comes with
  the upload routes (commit 5).
- Gate: route tests (18) and component tests (6) on the create/list/patch/publish/new-link flow;
  `build:worker` lists the new pages and routes, and the built Worker answers them (307 to sign-in, 401
  for the API without a session). The owner checks the screens at the M1 review.

**Commit 4 (T5.4), 2026-11-19, lane C (worktree `photo-gallery-p5pipe`).** As designed, plus:

- **More modules than the listing**: `probe.ts` (on the page, before a worker: type from the bytes,
  ≤ 100 MB, ≤ 100 MP from the frame header, `megapixels` for the pool; reads 512 KB, else the whole
  file), `process.ts` (`processFile`, the steps of D5.5 with the browser APIs injected; the worker is a
  thin wrapper), `imagePool.ts` (`createImagePool`, `poolSize`, `MAX_MEGAPIXELS_IN_FLIGHT` = 80),
  `refusals.ts` (refusal codes and the upload panel's sentences), `canvas.ts` (the canvas slice the
  pure cores take), `metadata/refusal.ts`, `metadata/bytes.ts`, `testing/fakeCanvas.ts`.
- **D5.6 removes a little more**: the XMP, IPTC and Photoshop blocks a TIFF tag can carry (0x02BC,
  0x83BB, 0x8649) and Photoshop's `OwnerName` (0xFDE8); `MakerNote` and the free-text tags go from
  any kept IFD (IFD0, Exif, Interop); every next-IFD pointer is written 0.
- **The allow-list keeps DAC and DNL** (decoding tables of arithmetic-coded and height-in-trailer
  files, no metadata); APP0 only as `JFIF` (JFXX thumbnails dropped), APP14 only as `Adobe`; IPTC
  keeps 2:00 (the record version, structural) with the four records.
- **The browser decodes the cleaned original**, so a rebuilt JPEG that would not decode is refused
  (`decode`) and the stored bytes are the ones that were looked at. The thumbnail is drawn from the
  display copy before the watermark; each derivative gets the watermark at its own size; the
  placeholder is taken before either. A worker that saw one PNG-for-WebP answer encodes JPEG from then
  on; the thumbnail always follows the display copy's format (one `derivative_ext`).
- **`sniffImageType(bytes, filename)`**: the bytes decide; the name only labels a TIFF-based raw (NEF,
  ARW, DNG) as `raw` rather than `tiff`. `taken_at` is `DateTimeOriginal` only.
- **Folder drop**: ONE dropped folder is the shoot (its subfolders are sets, its own files go to the
  chosen set); several dropped items make each folder a set. Hidden files and OS clutter (`.DS_Store`,
  `Thumbs.db`, `desktop.ini`, `__MACOSX`) are skipped, not listed as unsupported.
- **The white matte** (JPEG fallback, placeholder) is `IMAGE_MATTE` in `packages/ui/theme/pipeline.mjs`
  (guard `no-raw-colors`).
- **Fixtures are built in memory** (`fixtures/index.ts`: a TIFF writer in both byte orders, every
  segment kind, PNG/WebP chunks) on real encoder output (`fixtures/base.ts`, Chrome 157's canvas); each
  is first read by `exifr` (root devDependency, test-only) to prove it carries what it claims.
- **Not here**: `uploader.ts` (needs the upload routes: commit 5).
- Gate: Verification 3 (pipeline only) in **Chrome 157** (Playwright's Chromium, Windows, 20 threads)
  through `next dev` with a throwaway page (not committed): Turbopack bundles the module worker, no CSP
  violation; the EXIF-rotated fixture comes out upright; originals decode to the same pixels after the
  edit; HEIC, a PNG with `tEXt` and a WebP with XMP refused; Safari's WebP→PNG answer forced with real
  canvases gives JPEG derivatives with transparency on white. **50 × 24 MP JPEGs** (≈ 1.8 MB, EXIF +
  XMP + IPTC) in 23.9 s: **≈ 0.48 s per photo** with 4 workers, none failed. **Firefox and Safari were
  not run** (Firefox is not installed here, Safari needs a Mac; Playwright's WebKit build did not
  match the installed driver): Verification 3 stays open for them.

**Commit 5, server half (T5.5 routes), 2026-11-19, lane A.** The upload routes land before the browser
half (lane C: `uploader.ts`, the drop zone, the panel, the banner); T5.5 is ticked when both are in.

- `lib/galleries/parseUploadInput.ts` (pure): `REGISTER_BATCH` = 10, `COMPLETE_BATCH` = 8,
  `MAX_DERIVATIVE_BYTES` = 10 MB, ≤ 100 MP; the same hash twice in one request is a 400.
- `lib/galleries/uploads.ts`: `registerUploads` (insert batch → the conflicts read → re-mints in one
  batch → old-format derivatives deleted → the PUTs signed; a set of another gallery → 400 `INVALID_SET`
  from the composite FK; a hash that neither inserted nor exists = the gallery was deleted meanwhile →
  404) and `completeUploads` (`head()` ×3; `UPLOAD_MISSING` leaves the photo `uploading`;
  `UPLOAD_MISMATCH` also deletes its objects; an already-ready photo counts as ready; the mark, the
  increment, the gallery count, the cover default and the guarded bump in one batch).
- **No per-derivative size column**: the derivatives are checked against `bytes − original_bytes`
  (their sum) plus the 10 MB cap each; the original against `original_bytes` exactly.
- Rate limit: 600 register requests an hour (`upload_register`).
- Docs: architecture.md → Upload; AGENTS.md → Where to look (`lib/images/`, `lib/galleries/`).

**T5.9, split out of commit 6, 2026-11-19, lane C** (`feat(ui): Chip, Tabs and the scrim token`, so
Phase 6's client gallery can start on them). As designed, plus:

- **`scrim`** = `#16171A` (rgb 22 23 26) in the studio and in both gallery maps (it sits on a photo,
  not on the page). Usage pinned in `studio.mjs` and `colorContrast.test.ts`, composited over a white
  photo: badges `bg-scrim/80 text-inverse` (AA), icon buttons `bg-scrim/55` (3:1).
- **Two new tokens**: `boxShadow.tab` (the selected tab's 2 px underline in the text colour,
  `shadow-tab`) and a new `borderWidth` group with `chip` = 1.5 px (`border-chip`). The preset and
  `cn.ts` read the group, and `cn.test.ts` checks it.
- **`Chip`** (`packages/ui/chip.tsx`): 40 px pill, 44 px on a coarse pointer, optional `count`.
  `aria-pressed` by default, `aria-selected` with `role="tab"`. **Selected = an accent fill with
  `inverse` text, not the mockup's ink fill**: in a dark gallery `ink` is light, and `inverse` is only
  legible on an accent fill (every swatch is already contrast-tested for it).
- **`Tabs`** (`packages/ui/tabs.tsx`): `variant` `line` (the GalleryEditor look: 44 px, underline,
  `ink-muted` when unselected) or `chip` (the Mobile set chips: `Chip`s with `role="tab"`, scrolling
  sideways). `activation` `automatic` or `manual` (arrows move focus and Enter selects, for panels that
  cost a fetch). Disabled tabs are skipped; `TabPanel`, `tabId` and `tabPanelId` wire
  `aria-controls`/`aria-labelledby` (ids are safe for values with spaces).
- `/admin/design` → *Tabs, chips and the scrim*, checked at 360 px and 1440 px (no page overflow), in
  the studio and in a dark gallery scope.

**Commit 6, server half (T5.6 APIs + `media.purge`), 2026-11-19, lane A.** The manager's UI follows in
its own commit; T5.6 is ticked with it.

- `lib/galleries/manager.ts`: sets (add ≤ 50 → 400 `TOO_MANY_SETS`; rename; delete → 409
  `SET_NOT_EMPTY`, never the last; reorder takes every set once), the photo pages (`thumbUrl` from the
  public domain or the dev read route), bulk move/hide/show/delete and *Set as cover* (400
  `INVALID_COVER`). Routes: `…/sets`, `…/sets/[setId]`, `…/sets/order`, `…/photos`, `…/photos/bulk`,
  `…/cover`; parsers in `parseManagerInput.ts`.
- **A bulk batch**: change → its audit only if it changed (`changes() > 0`) → `clearCoverStatement` →
  recount the touched sets (read before the batch; a recount heals whatever moved meanwhile) → the
  gallery count → the cover default → the bump guarded by "a photo was written in this batch" → for a
  delete, `media.purge` unless one is pending. A delete that changed something nudges the relay.
- `lib/galleries/purge.ts`: `mediaPurgeJob` (registered in `JOB_KINDS`; relay-safe, guard
  `relay-graph`), `mediaPurgeJobStatement`, `mediaPurgeIfNeededStatement`; housekeeping runs the
  latter daily. `gallery.purge` comes with commit 8. **The relay must be deployed before the app once
  this ships (D3.14).**
- `lib/testing/galleryHarness.ts` (`makeGallery`, `makeReadyPhotos`) for route tests.

**Commit 6, the manager UI (T5.6), 2026-11-19, lane A.** `/admin/galleries/[id]` is the manager now:
`GalleryManager` (Tabs *Photos* / *Settings*), `SetsRail` (select, rename, ↑/↓ buttons for the
keyboard, add), `PhotoGrid` (pages of 200 at their aspect ratio on the placeholder colour, a checkbox
per ready photo, *Cover* / *Hidden* / *Unfinished* badges on `bg-scrim/80`), `BulkBar` (move, hide,
show, set as cover, delete with `ConfirmDialog`). Requests go through `adminFetch` (many URLs per
screen; it returns `details.message`). *Settings* holds the order for now (delete: commit 8). Drag
reordering is M4 (T5.13). The uploader (lane C) mounts at the marked slot in `GalleryManager`;
the unfinished-uploads banner comes with it. Icons `up`, `down`, `pencil` added to the studio set.

**Commit 7 (T5.7), 2026-11-20, lane A.** As designed, plus:

- **`GET /api/admin/galleries/[id]/password`** (`{ password }`, null for a link gallery, `no-store`)
  shows the photographer the password (D5.11); `revealGalleryPassword` in `lib/galleries/sharing.ts`
  (503 `SETTINGS_KEY_MISSING` / `PASSWORD_UNREADABLE`). Change, *Generate* and remove go through the
  existing `PATCH …/[id]` `{ access, password }`.
- **`lib/galleries/sharing.ts`**: `assertEmailable` (the two 409s, shared by the send and the
  preview), `previewGalleryEmail`, `queueGalleryEmail` (job + audit `update { event: 'email', jobId,
  includePassword }` in one batch; `includePassword` is forced false on a link gallery). The input
  parser is `parseShareInput.ts` (the name: ≤ 100, one line, header-safe: the job's recipient rules).
- **`renderEmail` refuses a template with a `load` step**; `loadAndRenderEmail(id, params, ctx, { opts,
  to })` is parse → load → render (the preview). The preview's recipient is the gallery's client
  address, or a placeholder (only the name is used).
- **`gallery.ready`'s `load` without a settings key** throws `MailError('SETTINGS_KEY_MISSING',
  { configuration: true })` (retried), like the mail settings.
- The panel (`SharingPanel.tsx`, opened by *Share* in the header) reuses `EmailStatusLine` (new
  `sentNote` prop) and `QrCode`; without a website address the link shows this browser's origin and
  the email is disabled with the Settings → Studio link.
- **`GET …/[id]` returns `unfinishedUploads`** (≤ 1000, through `ix_photos_purge`) for the banner;
  *View as client* (p06 T6.4, lane B) sits in the header (050dc3c).
- **The dev upload route overwrites** (1fd0013), like the presigned S3 PUT: a resumed upload (D5.9)
  PUTs its keys again; `ifAbsent` made them 409 locally. Found by lane C's resume e2e.

## Review log

- **Round 1** (2026-11-16, code and docs check): restore/purge windows made disjoint; claim-first purge;
  delete-set guard counts every row; deleted photos release their hash; GPS stripping widened; CSP for
  the watermark fetch; batches 10/8; public-bucket CORS; recount cover clearing.
- **Round 2** (2026-11-16, security, budgets/ops, implementability, product, consistency, and the build
  session): index writes counted — indexes cut to four structures, `position` replaced by `sort_key`,
  incremental set counts, no byte total; the password never in job params (loader at send time) and
  `SITE_URL_REQUIRED`; signer cache; `ck_photos_sha256` fixed; 10-character slug suffix and 8-character
  passwords; IPTC whitelist and the JPEG-first slicing; cover default; Phase 7 hooks; per-photo
  processing and M5 before Phase 8; folder drop in M2; status derived later; owner checklist, backups and
  migration rehearsal; jobs API as built; CSP moved to Phase 4.
- **Round 3** (2026-11-16, the build session's second pass, a cold-read review, a consistency audit):
  set ownership in the schema (composite FK; register `INSERT … SELECT` from a live gallery); `taken_key`
  and the `sort_key` composed in SQL; one order index `(set_id, sort_key)` for both lists; `json_patch`
  settings writes; guarded bumps and audits; the cover must be visible; purge predicates match the
  partial index; `gallery.purge` enqueues conditional, self-rescheduling and healed by housekeeping;
  the template `load` step with `GALLERY_GONE`/`GALLERY_UNPUBLISHED`/`MAIL_SECRET_UNREADABLE` and 409
  `NOT_PUBLISHED`; the JPEG segment allow-list and the EXIF free-text tags; the watermark snapshot is the
  whole object; cursor cap 700; build-time CSP in the owner checklist; per-commit Phase 4 dependencies.
- **Final gate** (2026-11-16, verdicts: Phase 4 ready, Phase 6 ready, Phase 5 ready with three fixes, now
  applied): `media.purge` ships with the manager (commit 6), relay first from commit 6; the INSERT and
  remint compose `sort_key` from the bound keys, not the columns; `name_key` is truncated after padding;
  restore cancels only `gallery.purge`; the self-exclusion `id != ?currentJobId` stated in D5.17.
- **Owner decisions** (2026-11-17): every open question as proposed (below); the domain name itself is
  still to come and is an owner checklist input, not a design question; status `draft` → `ready`.

## Open questions

Decided by the owner (2026-11-17), all as proposed:

1. **Originals bucket** (D5.1): the second, private bucket `memoria-originals` (deployment.md checklist:
   second bucket, CORS, a separate S3 API token covering both).
2. **Gallery URLs** (D5.2): `/g/<slug>`.
3. **Slugs with a random part** (D5.3): `maria-jonas-k7x2qpm4rt` by default; only the readable part is
   editable, on link galleries.
4. **Custom domain**: the app and the images on two subdomains of one domain in one Cloudflare zone (e.g.
   `gallery.<domain>` and `media.<domain>`). **Still to come from the owner: the domain name**, needed
   before Verification 4 (the public media domain) and Phase 6's cache; until then development uses the
   dev routes (an `r2.dev` URL is acceptable for a trial only, D5.15).
5. **Processing fixed at creation** (D5.4): accepted until *reprocess* (M5, before Phase 8).
6. **Soft delete**: 7 days (D5.17).
7. **Storage**: selection originals are kept; R2 billing beyond ~10 GB (≈ $1.4 a month per 100 GB)
   accepted.
8. **XMP dropped, IPTC reduced** (D5.6): accepted (EXIF camera, lens, date, copyright and four IPTC fields
   stay).
9. **"Invited emails only" access**: cut (link and password only).
10. **Default order** (D5.23): by filename; capture time per gallery.
11. **Backups of originals**: the risk is accepted for now (the photographer's Lightroom archive is the
    master copy); an `rclone` copy to an external store can be added later.
12. **PNG/WebP with metadata refused until M4** (D5.6): accepted.

For the index (`plan_202611_mvp.md`, owned by the build session):

- Phases table: Phase 5 status `placeholder` → `ready`; **Depends on 1, 3, 4** (not 1, 4).
- Scope overlaps to settle in the index: F1/F2 — Phase 5 owns links and passwords, Phase 6 the gate; F8
  (scheduled publish) is Phase 10's; C6 (approve/reject) is Phase 7's.
- Decisions: *Originals storage* → decided (D5.1); *Gallery URLs* → `/g/<slug>` decided; *Uploads* →
  "location removed: EXIF GPS, MakerNote and thumbnail, XMP, IPTC location fields; pixels untouched"
  (replaces "GPS stripped, the rest of EXIF kept"); *Watermark* → "changing it = a new gallery until M5's
  reprocess"; new rows *Uploads resume by content hash* (D5.9) and *Photo order by filename or capture
  time* (D5.23).
- Architecture in brief: `memoria-originals` no longer "proposed"; the relay runs `gallery.purge`,
  `media.purge` and the `gallery.ready` email; p03 D3.10's `r2.sweep` placeholder is superseded by
  `media.purge` (row-driven, no listing).
- Data model: Phase 5 also adds `ix_jobs_ref`; `visitors` moves to Phase 7 (Phase 6 mints the visitor
  cookie); Phase 10 adds `publish_at`/`expires_at` by `ALTER TABLE ADD COLUMN`.
- Phase 5 row: M1–M3 for the first usable version; M4 after it; **M5 before Phase 8** (replace with
  edited, reprocess, processing switch). Phase 8 depends on Phase 5 M5.
- To verify: Safari WebP encoding → resolved by the JPEG fallback (D5.5), still checked in Verification 3;
  presigned multipart stays unnecessary (Lightroom exports are far below 100 MB); R2 has no backup (accepted
  for now, open question 11).
- Phase 11: the dashboard lists failed jobs (purges included).
