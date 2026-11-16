---
title: "Phase 6: Client gallery"
type: plan
status: draft
updated: 2026-11-16
related: [plan_202611_mvp.md, plan_202611_p01_core_adapters.md, plan_202611_p04_studio_settings.md, plan_202611_p05_galleries_upload.md, plan_202611_p07_proofing.md, ../../architecture.md, ../../recipes.md, ../../../AGENTS.md]
---

# Phase 6: Client gallery

## Goal

A client opens `/g/<slug>` (by the link alone, or with the gallery's password) and browses the gallery
on a desktop or a phone, in the studio's branding: a cover, the welcome note, set tabs, a grid
(masonry, justified or square), a lightbox with keyboard, swipe and a filmstrip. Only thumbnails and
display copies are ever shown, never an original. **And it must fit the Cloudflare free plan** (10 ms
CPU per request, 100k requests a day), which a page rendered by Next on every view does not: this plan
analyses the options, recommends one with numbers and a measurement plan, and the owner decides.

**Done when (M1, the part of the first usable version):**

- `/g/<slug>` of a published gallery answers with the gallery: cover, title in the chosen display font,
  date, welcome note, sets, grid, lightbox; light, dark or auto theme with the chosen accent (Phase 4);
  works from 360 px up (2-column grid and set chips on phones).
- A password gallery shows a gate (title, studio name, password field); the right password sets an
  access cookie for that gallery; a changed password ends every cookie. A draft or deleted gallery and an
  unknown slug answer 404; the photographer's *View as client* opens a draft through a one-hour preview
  link.
- The page HTML and every JSON response contain **no original key** (they cannot: originals live in the
  private bucket, Phase 5 D5.1), no password, no client email.
- Link previews (WhatsApp, Facebook) show the title and studio name, and the cover for link-access
  galleries; nothing is indexed (`X-Robots-Tag`).
- **Measured on the free plan** (Verification 4): a gallery view costs one Worker request for the page
  (plus one per further set or page of photos), median ≤ 3 ms and p95 ≤ 6 ms of CPU; images and
  scripts cost no Worker request.
- `npm run ts-check` and `npm run test` green; `npm run preview` serves galleries through `worker.ts`.

**After the first usable version (M2):** protected image delivery (every image through `worker.ts`);
compare side by side (a proofing aid, with Phase 7); a virtualised grid if a 1,000-photo set is slow on a
phone.

- **Depends on:** Phase 4 M1 (gallery theme, swatches, font pairings), Phase 5 M1–M3 (galleries, photos,
  `/g/<slug>`, `content_version`, the public media domain). **Unblocks:** Phases 7 (favourites and
  submit inside this app), 9 (downloads), 11 (visitors and counters).
- **Mockups:** `ClientGallery.dc.html`, `ClientLightbox.dc.html` (viewing parts), `Mobile.dc.html`.
- **Scope (feature IDs):** F1, F2, G1–G5, G7–G9.

## Starting point (verified 2026-11-16 against master `e6ed219`: Phases 0–2b done, Phase 3 M1–M2 done)

- **Measured on the free plan** (smoke deploy 2026-11-16, `npm run measure:cpu`):

  | Path | What runs | CPU |
  | --- | --- | --- |
  | `/healthz` | `worker.ts` only (`edgeResponse`, no D1) | **0 ms** |
  | relay cron, idle | a Worker without Next: platform, 2–3 D1 statements, a log line | **2–4 ms** |
  | relay cron, one email | the same + a template render and an SMTP send | 9 ms |
  | `/robots.txt` | a Next route handler | median 6, p95 14 |
  | `/` | a Next page (one heading, one D1 read) | median 8, p95 11 |
  | `/admin/login` | a Next page with the sign-in form | median 26, p95 37 |
  | a cold start | the first request of an isolate (Next) | 182 ms |

  Requests over 10 ms answered 200: today the limit is not enforced per request, but Cloudflare
  documents 10 ms and can answer error 1102 (`exceededCpu` in the tail). **Design for the documented
  limit.**
- **`worker.ts`** (wrangler `main`): `edgeResponse(request, env)` answers `/healthz` before Next loads,
  else `openNext.fetch(request, env, ctx)`; it imports relative only; the comment names "a page cache in
  front of Next" and "files streamed from R2" as good candidates. `src/lib/edge/routes.ts` is pure and
  exports `ROBOTS_TAG = 'noindex, nofollow'`.
- **Next**: `app/layout.tsx` is the only root layout, `force-dynamic`, reads `getAppConfig()` (D1) on
  every request; `open-next.config.ts` is `defineCloudflareConfig({})` (no incremental cache);
  `recipes.md → Caching` lists static pages, OpenNext's incremental cache and a `worker.ts` page cache
  (Cache API; "does nothing on `workers.dev` and preview URLs — only on a custom domain").
- **Static assets**: `.open-next/assets` through the `ASSETS` binding; requests that match an asset are
  served without running the Worker (free, unlimited). `next dev` does not run `worker.ts`.
- **Headers**: `lib/security/headers.mjs` (plain `.mjs`, no imports) exports `securityHeaders({ dev })`
  and `contentSecurityPolicy`; `next.config.mjs` applies them to Next responses at build time; responses
  from `worker.ts` get none unless it sets them. Phase 5 D5.16 adds the media origins to the CSP.
- **Imports reachable from `worker.ts`** must avoid `server-only` and `@repo/db/client`
  (`@repo/db/client` imports `server-only` and `@repo/platform/current`). Import-free precedents:
  `@repo/db/rows` ("the Worker entry may import them") and `lib/db/queries/admin_two_factor_cli/sql.ts`.
  `statement()` lives in `@repo/db/client`. Guard `platform-boundary` allows `apps/web/worker.ts` to
  import `@repo/platform-cloudflare`; guard `relay-graph` already walks an import graph with an alias map
  (the walker to reuse).
- **From Phase 5** (planned): `galleries` (slug, status, access, `password_sealed`, `password_version`,
  delivery, `settings` JSON, cover, `content_version`, `deleted_at`), `photo_sets` (with `photo_count`),
  `photos` (`status`, `hidden`, `rev`, `derivative_ext`, dims, colour, position); derivative keys
  `galleries/<g>/<p>/<rev>/{thumb,display}.<ext>` in the public bucket; `MEDIA_PUBLIC_BASE_URL` is the
  public media domain; `settingsCipher` opens the password (AAD `gallery.<id>.password`).
- **From Phase 4** (planned): `[data-gallery-theme]`, `[data-gallery-accent]`, `[data-gallery-font]` rules
  in the preset; `GALLERY_FONT_CLASSES`; `display-cover`, `Display`.
- **Turnstile**: `TURNSTILE_SITE_KEY` var + secret; `lib/turnstile/verify.ts`; the CSP allows
  `challenges.cloudflare.com`. **Rate limits**: `hitRateLimits(rules)` (fixed windows by upsert).
- No `visitors` table, no gallery route, no `(gallery)` layout exist.

## The CPU question

### What a gallery view needs

A view = the page (title, theme, sets, the first set's photos) + images (thumbnails, then display copies
in the lightbox) + scripts and styles. Images come from the public R2 domain and scripts from the
assets: **neither runs the Worker**. So the only Worker work is producing the page and its photo list.

### Options

| | Option | Worker requests per view | CPU per request (measured or estimated) | Works on `workers.dev` | Cost to build |
| --- | --- | --- | --- | --- | --- |
| A1 | **Next renders the gallery**, OpenNext incremental cache (ISR in R2/KV, revalidated by tag after admin writes) | 1 | a hit still runs Next's routing and cache read: unmeasured, likely 3–8 ms (cf. `/robots.txt` 6 ms); a miss renders the grid: **est. 15–40 ms** for 200–500 photos (cf. `/` 8 ms for one heading) | yes | medium: tag cache, revalidation from every admin write, cache keys that must ignore the access cookie |
| A2 | **Next renders, `worker.ts` caches** the HTML (Cache API, key = gallery id + `content_version`) and checks access first | 1 | hit ≈ 1–2 ms; miss = a full render, est. 15–40 ms, once per data centre per change | **no** (Cache API is inert there: every view is a miss) | medium: access check duplicated in `worker.ts`, cache only on a custom domain |
| B | **Static shell + data from `worker.ts`**: one prebuilt HTML shell for every gallery (from the assets), the gallery's head and JSON injected by `worker.ts` from D1; React renders in the browser | 1 (+1 per further set) | **est. 1.5–3 ms** (cf. relay idle 2–4 ms with D1 and the platform; JSON for 500 photos ≈ 1 ms); a cached JSON skips the photo query | yes | medium-high: a client app (needed anyway for Phases 7 and 9), an import-free data module, a build step for the shell |
| C | **Client-rendered** = B without the injected data: the shell fetches `/g/<slug>/data` | 2 | the shell ≈ 0 (an asset), the JSON ≈ 1.5–3 ms | yes | medium: like B without the injection, but a second round trip before anything shows |
| D | **Workers Paid** ($5/month: 10M requests and 30M CPU-ms included, then $0.30 per million requests and $0.02 per million CPU-ms; 30 s CPU per request), Next renders as today | 1 | 15–40 ms est., allowed | yes | none for galleries; also covers the admin pages (26–37 ms) |

(Pricing from Cloudflare's Workers pricing page; check it before deciding.)

### Recommendation: **B**, with D as the insurance for the admin, not as the gallery's design

- **B is the fastest page for clients** (one request; everything else from the CDN) and is the only
  option that stays well under 10 ms on every view, cached or not, on any hostname. A1 and A2 still
  render 15–40 ms on a miss, and A2 needs the custom domain to cache at all.
- **The client app is needed anyway**: favourites with instant feedback (Phase 7), browser ZIPs (Phase 9)
  and the lightbox are client-side; server-rendering the grid would buy nothing (galleries are
  `noindex`, so no SEO), and link previews only need the head, which `worker.ts` injects.
- **It scales with the photographer's success**: client traffic is where the volume is (many visitors);
  the admin is one person. At ~2 Worker requests per view, 100k requests a day is ~50k gallery views a
  day.
- **D remains the owner's call for the admin side**: the sign-in page (26 ms) and every admin screen and
  upload route of Phase 5 run through Next and exceed 10 ms. Today they answer 200; the day the tail shows
  `exceededCpu`, or if spikes S6.1/S6.2 fail, take Workers Paid. On Paid, B is still the better gallery.
- **C is B's fallback** if injecting into the shell proves fragile (S6.1): same code, one more round trip.

### Measurement plan (gates)

| # | When | What | Pass |
| --- | --- | --- | --- |
| S6.1 | commit 1, local (`npm run preview`) | a `force-static` page under its own root layout builds to a static HTML file; a build step copies it into `.open-next/assets/__gallery/shell.html`; `worker.ts` serves it for `/g/x` through `env.ASSETS` with a marker replaced | the page renders and hydrates; the response is built without calling Next (the routing moves into `src/lib/edge/route.ts` → `routeEdge(request, env, ctx, next)`, tested with a `next` that throws; `worker.ts` only passes `openNext.fetch`) |
| S6.2 | commit 2, local | `worker.ts` imports a module that runs import-free statement builders through `d1Db(env.DB)`; wrangler bundles it | `build:worker` passes; guard `edge-graph` passes; the bundle grows < 20 KB |
| S6.3 | after M1, production (the owner deploys) | `npm run measure:cpu -- https://<host>/g/<slug> 50` on a link gallery of 300 photos in 3 sets, and on `/g/<slug>/data?set=<id>`; the same on a password gallery with its cookie | median ≤ 3 ms, p95 ≤ 6 ms; else profile and decide (cache the JSON, smaller pages, or D) |
| S6.4 | during Phase 5 and 6 use | `npm run wrangler -- tail memoria --format json` filtered on `outcome` | no `exceededCpu`; any → bring decision D to the owner |

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D6.1 | **Option B (proposed, the owner decides)**: `/g/<slug>` is answered by `worker.ts` before Next loads: the prebuilt shell from the assets, with the gallery's head, theme attributes and first page of data injected. `/g/<slug>/data` answers further sets and pages. | The CPU analysis above. |
| D6.2 | **The shell is a static Next page under its own root layout**: the current `app/layout.tsx` moves to `app/(studio)/layout.tsx` (with `page.tsx` and `admin/`); `app/(gallery)/layout.tsx` is the gallery root (no D1, no `getAppConfig`, `GALLERY_FONT_CLASSES`, `globals.css`); `app/(gallery)/gallery-shell/page.tsx` is `force-static` and renders `<GalleryApp />`. `scripts/gallery-shell.mjs` (run by `build:worker` after OpenNext) copies its prerendered HTML into `.open-next/assets/__gallery/shell.html` and fails the build if it is missing or a marker is not found exactly once. | One build, one set of hashed chunks; the shell is the same for every gallery, so it is an asset; Next tooling (Tailwind, fonts, React) unchanged. |
| D6.3 | **Injection by markers, not `HTMLRewriter`**: the shell contains `<html data-gallery-shell="">`, `<meta name="memoria-gallery-head">` and an empty `<script id="__gallery" type="application/json">`; a pure `injectGallery(shell, view)` replaces each once (attributes, `<title>` + description + Open Graph tags, the JSON with `<` escaped as `<`). | Runs in workerd **and** in Node (so `next dev` and vitest use the same function); the shell is our own static file, so markers are reliable; a build check guards them. |
| D6.4 | **One handler, two hosts**: `handleGalleryRequest(request, deps)` (`src/lib/edge/gallery/handler.ts`, import-free of Next and `server-only`) takes `deps = { db: Db, shell(): Promise<string>, cache: JsonCache, config: EdgeGalleryConfig, now }`. Production: `worker.ts` builds `deps` from `env` (`d1Db(env.DB)`, `env.ASSETS`, `caches.default`). Development: Next route handlers `app/(gallery)/g/[slug]/route.ts` and `…/data/route.ts` build `deps` from `getPlatform()` and fetch the shell from `/gallery-shell` (unreachable in production: `worker.ts` answers first). | `npm run dev` keeps working; the tested code is the deployed code; `npm run preview` exercises the `worker.ts` path. |
| D6.5 | **Edge-safe SQL**: `statement()` and `Statement` move to an import-free `@repo/db/statement` (re-exported by `@repo/db/client`); the gallery's public reads are builders in `lib/db/queries/galleries/public.ts` (and `photos/public.ts`) importing only `@repo/db/statement` and `@repo/db/rows`; the handler executes them on the `Db` port it is given. Guard **`edge-graph`** (the `relay-graph` walker from `apps/web/worker.ts`) refuses `server-only`, `@repo/db/client`, `@repo/platform/current`, `next`, `react`, `@opennextjs/*` (except the generated `.open-next/worker.js`) and prints the chain. | SQL stays in the query modules (AGENTS.md); no wrangler `alias` that could also rewrite OpenNext's bundle; the boundary is checked. |
| D6.6 | **The view JSON** (`GalleryView`, versioned `v: 1`): `gallery` (title, date, purpose, welcome note, cover `{ id, w, h, color, rev, ext }` or null, theme, accent, font, grid, `protect` = right-click deterrent, studio `{ name, website }`), `media` (the public base URL), `sets` (`{ id, name, count }`), `page` (`{ setId, photos: [id, w, h, color, rev, ext][], next }`, ≤ 500 photos), `gate` (instead of everything but the title and studio when the password is missing), `turnstileSiteKey` on the gate. The browser builds URLs with Phase 5's pure `thumbKey`/`displayKey`. No filenames (Phase 7 adds them when "show filenames" is on), no client data, no password. | Compact (~60 bytes a photo); an original key cannot be built into a public URL (private bucket); one shape for the page and `/data`. |
| D6.7 | **Cache the JSON, not the HTML**: per request one indexed read of the gallery row by slug (1 row) decides access and gives `content_version`; the set and photo JSON is cached in `caches.default` under `https://cache.internal/g/<id>/<content_version>/<setId>/<cursor>` for 1 day (`ctx.waitUntil(put)`); a miss reads ≤ 50 sets and ≤ 500 photos. On `workers.dev` the cache is inert and every view reads D1 (still ~2–3 ms). | Access is decided fresh on every request; an admin change is visible at once (a new version = a new key); D1 rows read per cached view = 1. |
| D6.8 | **Access**: link galleries need nothing beyond the slug. Password galleries: `POST /api/g/[slug]/access` (a **Next** route: rare, and the house pattern for a public write) checks same-origin, Turnstile, then the rate limits (10 per IP and gallery per 15 minutes; 100 failures per gallery per hour), decrypts the password and compares in constant time, then sets `mg_<first 12 hex of the id>` = `v1.<password_version>.<expiry>.<HMAC>` — `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, `Path=/g/<slug>`, 30 days. The HMAC key is HKDF(`SETTINGS_ENCRYPTION_KEY`, info `memoria:gallery-access:v1`), verified in `worker.ts` with Web Crypto. | No PBKDF2 on a public path; a password change (`password_version + 1`) ends every cookie; the public-write rule of AGENTS.md (Turnstile and the rate limit before any write) is kept. |
| D6.9 | **Preview links for drafts**: `POST /api/admin/galleries/[id]/preview-link` mints `/g/<slug>?preview=<exp>.<HMAC(id, exp)>` (1 hour, the same key, another HKDF info); it opens a draft and skips the password. | *View as client* before publishing, without an admin session check in `worker.ts`. |
| D6.10 | **A view writes nothing.** The `visitors` table and the visitor cookie move to **Phase 7** (created at the first favourite or name prompt); view counters are Phase 11's (aggregated, never a write per photo view). | The view path stays read-only and cacheable; Phase 6 needs no migration. |
| D6.11 | **Responses from `worker.ts` set their own headers**: `securityHeaders` from `src/lib/security/headers.mjs` (imported relatively) with the media origin from env, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` (the slug of a link gallery is its secret), `Cache-Control: private, no-store` for the page, `private, max-age=60` for `/data`; no analytics beacon on gallery pages. | Outside Next none of the site headers apply (Phase 1's finding). |
| D6.12 | **Link previews**: `og:title` = the gallery title, `og:description` = the studio name, `og:image` = the cover's display copy **only for link-access galleries**; a password gallery's preview has no image. `robots.txt` stays open (bots must fetch the page to read the tags). | Galleries are private; a password gallery should not leak a photo through a shared preview. |
| D6.13 | **Grids are computed in the browser** from the known sizes: justified rows (target row height, last row not stretched), masonry (shortest column, row-major reading order), square (cover crop). Pure functions, table-tested. Thumbnails `loading="lazy"` with the placeholder colour as background; pages of 500 loaded as the user nears the end. | No layout shift (sizes are known), chronological order kept, no server work. |
| D6.14 | **Lightbox**: a native `<dialog>` (`@repo/ui/dialog`) in the lightbox palette (a `lightbox` theme in Phase 4's `gallery.mjs`, the T6.7 values), the photo id in the URL hash (`#p=<id>`: Back closes it, a link opens it), ←/→/Esc, swipe (pointer events), the next and previous display copies preloaded, a filmstrip of thumbnails, the counter. | Keyboard and screen-reader behaviour from the platform; shareable photo links inside the gallery. |
| D6.15 | **Right-click deterrent** on selection galleries (`contextmenu` and drag cancelled on images, `-webkit-touch-callout: none`); off on sharing galleries. Documented as a deterrent only. | The protection of a selection gallery is the low resolution and the watermark (index); this only stops the casual "Save image as". |
| D6.16 | **Share** = the Web Share API where present, else copy the link; no third-party social buttons. | No third-party scripts, no tracking. |
| D6.17 | **Protected delivery is M2**: `/g/<slug>/i/<photoId>/<rev>/<thumb\|display>.<ext>` answered by `worker.ts` (gallery published, cookie valid for password galleries) streaming `env.MEDIA.get(key)` with `Cache-Control: private, max-age=86400`; the gallery row cached per isolate for 60 s on `globalThis`. One Worker request per image (~1 ms each): a 300-photo gallery fully browsed costs ~600 requests. | Revocation that also covers images, for the photographer who needs it, at a clearly stated request cost; not needed for the first usable version. |

## Design

### Request flow (production)

```
GET /g/<slug>                    worker.ts → handleGalleryRequest
  slug shape? no → 404 (the static not-found asset)
  galleryBySlug (1 row: id, status, access, password_version, content_version, settings, cover…)
    none, deleted, or draft without a valid ?preview → 404
    password and no valid mg_ cookie → injectGallery(shell, gateView)        (no photos, no cover)
  cache.get(g/<id>/<cv>/<firstSet>/0) ?? (sets + photos page from D1 → cache.put in waitUntil)
  injectGallery(shell, view) → 200 text/html, headers (D6.11)
GET /g/<slug>/data?set=&cursor=  the same checks → JSON page
POST /api/g/<slug>/access        Next: same-origin → Turnstile → rate limits → compare → Set-Cookie → { data: { ok: true } }
images                           https://<media domain>/galleries/<g>/<p>/<rev>/thumb.webp   (CDN, no Worker)
scripts, styles, fonts           /_next/static/…                                             (assets, no Worker)
```

### Modules

```
apps/web/worker.ts                      + if (isGalleryPath(pathname)) return handleGalleryRequest(request, edgeDeps(env, ctx))
apps/web/src/lib/edge/gallery/
  handler.ts      routing inside /g/<slug>(/data); access; cache; responses (pure deps)
  view.ts         rows → GalleryView (pure; never reads password or client fields)
  inject.ts       injectGallery(shell, view, head) (pure, D6.3)
  access.ts       accessCookie sign/verify, previewToken sign/verify (Web Crypto, pure)
  headers.ts      galleryHeaders(config) from headers.mjs (pure)
  deps.ts         EdgeGalleryDeps, JsonCache, EdgeGalleryConfig types
apps/web/src/lib/edge/edgeDeps.ts       production deps from env (d1Db, ASSETS, caches.default): imported by worker.ts only
apps/web/src/app/(gallery)/layout.tsx   gallery root layout (static)
apps/web/src/app/(gallery)/gallery-shell/page.tsx   force-static: <GalleryApp/>
apps/web/src/app/(gallery)/g/[slug]/route.ts, data/route.ts   development host of the same handler (D6.4)
apps/web/src/app/api/g/[slug]/access/route.ts                  the gate (D6.8)
apps/web/src/components/gallery/        GalleryApp, GalleryHeader, Cover, SetTabs, SetChips, Grid (layouts),
                                        Lightbox, Filmstrip, Gate, ShareButton, store.ts (view state)
apps/web/src/lib/gallery/layout.ts      justified / masonry / square (pure)
packages/db/statement.ts                statement(), Statement (import-free, D6.5)
apps/web/src/lib/db/queries/galleries/public.ts, photos/public.ts, photo_sets/public.ts
scripts/gallery-shell.mjs               copy + marker check (D6.2)
scripts/guards/edge-graph.test.ts       D6.5
```

- `EdgeGalleryConfig` = `{ mediaBaseUrl, accessKey (CryptoKey, derived once per isolate and kept on
  globalThis by key fingerprint), turnstileSiteKey, isDevelopment }`, parsed from env by a pure
  `edgeGalleryConfig(env)` (no `parseConfig` dependency unless the `edge-graph` guard accepts its imports).
- Public reads: `galleryBySlugStatement(slug)` (`WHERE slug = ? AND deleted_at IS NULL`, the columns the
  view needs), `publicSetsStatement(galleryId)` (`ORDER BY position LIMIT 50`), `publicPhotosStatement(setId, cursor, 500)`
  (`WHERE set_id = ? AND status = 'ready' AND hidden = 0 ORDER BY <the gallery's sort>, id`, served by
  `ix_photos_set_order`; the capture-time sort uses `taken_at, position`). Rows read per uncached view:
  1 + sets + ≤ 500.

### The client app (`components/gallery/`)

- `GalleryApp` reads `#__gallery` once (`JSON.parse`), validates `v`, and renders the gate or the
  gallery; set switches and "load more" fetch `/g/<slug>/data` through `useApi` (the route answers the
  `{ data }` envelope).
- **Header and cover**: studio name (logo in Phase 4 M2), the cover display copy full-bleed with the title
  in `Display` (`display-cover`) and the date (formatted by `@repo/ui/date`), *View gallery* scrolls to the
  grid; the welcome note below. A gallery without a cover starts at the title.
- **Sets**: tabs on desktop (`Tabs`, Phase 5), chips on phones (`Chip`); counts from `sets`.
- **Grid**: the layout of the gallery (D6.13); gaps and radii from tokens; a focusable button per photo
  opening the lightbox; `alt` = "Photo N of M" (no filenames).
- **Lightbox** (D6.14): display copy at `object-contain`, thumbnail shown until it loads; controls in
  `scrim` buttons (T6.7); the heart, download and comment slots exist but render nothing until Phases 7
  and 9.
- **Gate**: title, studio name, password field (`@repo/ui/input`, 16 px on phones), Turnstile, submit →
  `POST /api/g/<slug>/access` → on success `location.reload()`; wrong password: "That password is not
  right" (no detail), 429: "Too many tries. Try again in a few minutes."
- **Mobile**: 2-column grid, set chips under a sticky header, the lightbox full-screen with swipe; the
  favourites bar and bottom navigation arrive with Phase 7.
- Fonts: the `(gallery)` layout carries `GALLERY_FONT_CLASSES`; `data-gallery-font` is injected, so only
  the chosen pairing downloads.

### Tokens (T6.7)

- `gallery.mjs` (Phase 4) gains a third role map, `lightbox` (bg `#0F1011`, panel `#17191B`, fg
  `#F1F0EC`, muted `#A9ABAF`, soft `#D4D3CF`, border `#34363A`, accent `#8FD3BF`, plus `fav` `#E08A5C` /
  `favFg` `#F4B190` for Phase 7), emitted on `[data-gallery-theme="lightbox"]` with `color-scheme: dark`;
  contrast rows.
- A photo text shadow (`textShadow.photo` in `studio.mjs`, a `text-shadow-photo` utility) for text over the
  cover; the `scrim` Button variant (fill `scrim/55`, `inverse` text) for controls over photos.

### Errors and limits

- 404 for: a bad slug shape, unknown, deleted, draft without preview, a `/data` set of another gallery,
  a malformed cursor. 400 never leaks which. The 404 body is the static not-found asset.
- A D1 error → 503 with a minimal static page ("The gallery is not available right now"), logged
  `gallery_unavailable` with the gallery id only.
- `/data` pages: `set` must be a UUID, `cursor` a base64url `{ position, id }` the server minted.
- An invalid `settings` JSON reads as defaults (Phase 5's parser), never a broken page.

## Workstreams

### A. Foundations (spikes first)

- **T6.1** S6.1: split the root layouts (`(studio)` and `(gallery)`), the `gallery-shell` page,
  `scripts/gallery-shell.mjs` in `build:worker`, `worker.ts` serving the shell for `/g/*` in preview;
  record the result here. Global not-found handling for two root layouts checked.
- **T6.2** S6.2: `@repo/db/statement`; the public statement builders; guard `edge-graph` (walker shared
  with `relay-graph`, self-tests: `worker.ts` → `server-only` caught, `@repo/db/rows` passes).

### B. The gallery path

- **T6.3** `lib/edge/gallery/*` (handler, view, inject, access, headers), `edgeDeps.ts`, the development
  route handlers, the JSON cache, `worker.ts` wiring.
- **T6.4** The gate route (Turnstile, rate limits, cookie) and the preview-link route; the manager's
  *View as client* uses it (Phase 5's button).

### C. The client app

- **T6.5** `GalleryApp`, header and cover, sets (tabs and chips), the three grids with
  `lib/gallery/layout.ts`, load-more, the gate form, share, the right-click deterrent; mobile layout.
- **T6.6** Lightbox, filmstrip, keyboard, swipe, hash routing, preloading.
- **T6.7** Tokens: the `lightbox` theme, the photo text shadow, the `scrim` Button variant; design page
  sections.

### D. After the first usable version (M2)

- **T6.8** Protected delivery (D6.17), offered in New gallery and Settings → Galleries (Phase 4 D4.13
  and Phase 5 D5.21 lift their *Soon*).
- **T6.9** Compare side by side (with Phase 7); a virtualised grid if Verification 3 shows a slow phone.

### E. Docs (each in its commit)

- Commit 1: `architecture.md` → Hosting (the gallery path: `worker.ts` answers `/g/*` with the static
  shell), `recipes.md` → Caching (option B described as the gallery's choice).
- Commit 2: AGENTS.md → *Edge-safe code* (what `worker.ts` may reach; `@repo/db/statement`; guard
  `edge-graph`), guards list.
- Commit 3: `architecture.md` → *Client galleries* (flow, access cookie, cache keys, headers).
- Commit 7: index *To verify* (the pages' CPU: resolved for galleries by B, with S6.3's numbers).

## Tests

| Test | What |
| --- | --- |
| `lib/gallery/layout.test.ts` | table: justified rows for known sizes and widths (row heights, last row not stretched, a panorama alone on a row); masonry columns and row-major order; square; 0 and 1 photo; width changes |
| `edge/gallery/access.test.ts` | cookie: valid; tampered signature; another gallery; old `password_version`; expired; malformed parts; preview token valid, expired, for another id |
| `edge/gallery/inject.test.ts` | each marker replaced once; a title with `</script>`, quotes and Cyrillic escaped correctly in HTML and JSON; missing marker throws; OG image only for link galleries |
| `edge/gallery/view.test.ts` | rows → view: no `password_sealed`, `client_email`, `client_name` or filename in the output (deep key scan); hidden, deleted and uploading photos absent; the string `original` never appears; sizes and colours carried |
| `edge/gallery/handler.test.ts` | test D1 + a fake shell + an in-memory `JsonCache`: published link gallery → 200 with injected JSON; draft → 404, with a valid preview → 200; deleted → 404; unknown or malformed slug → 404; password gallery without cookie → gate view (no photos, no cover), with a valid cookie → full view, with an old-version cookie → gate; `/data` of another gallery's set → 404; paging cursor round trip; a cache hit reads only the gallery row (Db spy); a changed `content_version` misses; headers (CSP with the media origin, `X-Robots-Tag`, `Referrer-Policy: no-referrer`, `no-store`) |
| `api/g/[slug]/access/route.test.ts` | cross-origin → 403; Turnstile failure (mocked) → 403 before any write; rate limits (per IP and gallery, per gallery) → 429; wrong password → 401 with a fixed message; right → 200 + `Set-Cookie` with `Path=/g/<slug>`, `HttpOnly`, `SameSite=Lax`; link gallery or unknown slug → 404; the comparison is constant-time (a helper test) |
| `api/admin/galleries/[id]/preview-link/route.test.ts` | 401/403; returns a token the handler accepts; 404 for a deleted gallery |
| `scripts/gallery-shell.test.ts` | the marker check on a sample file: missing, doubled and present |
| guards | `edge-graph` self-tests (a chain to `server-only` caught; `@repo/db/rows` and `@repo/db/statement` pass; the generated `.open-next/worker.js` ignored); `every-route-wrapped` covers the new routes |
| `packages/db/statement.test.ts` | the moved `statement()` keeps its parameter checks (undefined and booleans throw); `@repo/db/client` re-exports it |
| component tests | `GalleryApp` renders gate vs gallery from the inline JSON; set switch fetches `/data`; grid keyboard focus and Enter opens the lightbox; lightbox ←/→/Esc, hash updates, Back closes; swipe handler (pointer events); right-click cancelled only on selection galleries; share falls back to copy; gate errors |

## Risks and edge cases

- **Next upgrades** may move the prerendered HTML: the build step fails loudly (D6.2); fallback C (fetch
  the JSON) needs only the shell, and A2 remains possible.
- **Two root layouts**: navigation between studio and gallery pages is a full page load (expected); a
  global 404 needs its own `<html>` (checked in S6.1).
- **First paint needs JavaScript** (no server-rendered grid): the JSON is inline, the gallery bundle is
  kept small (budget: ≤ 120 KB gzip for the gallery route, recorded in Verification 3); the cover and the
  header show as soon as React mounts.
- **Cache API only on a custom domain** (index question 3): without it every view reads D1 (still within
  budget: ≈ 1 + sets + 500 rows per view; 5M rows a day ≈ 9,000 uncached views of a 500-photo set).
- **Public image URLs survive revocation** (Phase 5 risk): a former visitor who kept URLs can load
  thumbnails and display copies; protected delivery (M2) is the answer; originals are never public.
- **Password guessing**: per IP and per gallery limits plus Turnstile; generated passwords are two words
  and two digits. A determined attacker under the hourly cap could still try ~2,400 passwords a day on
  one gallery: the photographer is told to use generated passwords (the form suggests one).
- **The hourly failure cap is a lever for annoyance**: an attacker can lock the gate for an hour for
  everyone; logged `gallery_gate_limited` (the admin sees it in Phase 11's activity).
- **Large sets**: 500 photos per page; JSON ≈ 30 KB per 500 photos; layout math for 1,000 items is a
  few ms in the browser; virtualisation only if Verification 3 shows a problem.
- **Cold start**: an isolate's first request evaluates the whole Worker bundle (OpenNext included); the
  gallery path does not initialise Next, so it should stay far below the 182 ms measured for a Next
  cold start; S6.3 records it.

## Verification

1. `npm run verify`; `npm run build:worker` (the shell check passes).
2. **Local** (`npm run dev` and `npm run preview`): a published link gallery, a password gallery and a
   draft from Phase 5: link → gallery; password → gate, wrong password message, right password → gallery,
   change the password in the manager → gate again; draft → 404, *View as client* → the draft; a deleted
   gallery → 404. The page source contains no `original`, no client email, no password. Theme light /
   dark / auto (OS switch) and each accent; the chosen font only is downloaded (network panel).
3. **Devices**: desktop Chrome, Firefox, Safari; an iPhone and an Android phone: grid styles, set chips,
   lightbox swipe, keyboard only on desktop (Tab to a photo, Enter, ←/→, Esc), the screen reader
   announces the dialog and the counter; a 1,000-photo set scrolls smoothly on the phone; the gallery
   bundle size recorded.
4. **Production** (the owner deploys; S6.3 and S6.4): `npm run measure:cpu` on the gallery page and
   `/data` (link and password galleries); record the numbers here; check WhatsApp and Facebook previews
   for a link gallery (image) and a password gallery (no image); `X-Robots-Tag` present.
5. With the custom domain: a second view of the same set shows a cache hit (a log field) and reads one
   D1 row.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `refactor(web): studio and gallery root layouts; the static gallery shell` | T6.1 | S6.1 recorded; `npm run preview` serves `/g/x` from the shell |
| 2 | `feat(edge): import-free statements and the edge-graph guard` | T6.2 | S6.2 |
| 3 | `feat(gallery): the gallery page and data from worker.ts` | T6.3 | handler tests; preview serves a real gallery |
| 4 | `feat(gallery): the password gate and preview links` | T6.4 | Verification 2 (access part) |
| 5 | `feat(gallery): the client gallery` | T6.5, T6.7 | Verification 2 (look), 3 (layout) |
| 6 | `feat(gallery): the lightbox` | T6.6 | Verification 3 (lightbox) |
| 7 | `docs: Phase 6 M1 done` | docs | Verification 4 once deployed |

Milestones: **M1** = commits 1–7 (the client can browse: Phase 6's part of the first usable version;
Phase 7 then adds favourites and submit to this app); **M2** (after the first usable version) = T6.8,
T6.9.

## Checklist

- [ ] T6.1 Root layouts split, static shell, build step (S6.1)
- [ ] T6.2 `@repo/db/statement`, public builders, guard `edge-graph` (S6.2)
- [ ] T6.3 Gallery handler, injection, access, headers, cache, `worker.ts`, dev routes
- [ ] T6.4 Gate route, preview links
- [ ] T6.5 Client app: header, cover, sets, grids, gate, share, deterrent, mobile
- [ ] T6.6 Lightbox
- [ ] T6.7 Lightbox theme, photo text shadow, `scrim` button
- [ ] Verification 1–3 (4–5 once deployed with the custom domain)
- [ ] M2: T6.8 protected delivery · T6.9 compare, virtualised grid

## Open questions

For the owner:

1. **The CPU decision**: option B (recommended: static shell + data from `worker.ts`, all on the free
   plan), or Workers Paid ($5/month) with Next rendering the gallery? Independently: take Workers Paid now
   for the admin side (26–37 ms pages), or wait until the tail shows `exceededCpu` (S6.4)?
2. **Protected delivery in M2** (D6.17), after the first usable version: acceptable?
3. **`visitors` moves to Phase 7** (D6.10): the view path writes nothing in Phase 6.
4. **Link previews** (D6.12): cover image only for link-access galleries, none for password galleries?
5. **Right-click deterrent** on selection galleries only (D6.15)?
6. **Turnstile on the password gate** (D6.8, the house rule for public writes): fine for clients? (It is
   usually invisible.)

For the index (`plan_202611_mvp.md`, owned by the build session):

- *To verify → the pages' CPU*: the gallery's answer is option B with gates S6.1–S6.4; the admin side's
  answer is the owner's Workers Paid decision.
- Architecture in brief: `worker.ts` answers `/g/*` (the static shell + data) before Next loads, and
  protected images from M2.
- Data model: Phase 6 adds no table; `visitors` moves to Phase 7.
- Phase 6 row: "M1: gallery from `worker.ts`, gate, grid, lightbox, mobile · M2: protected delivery,
  compare".
