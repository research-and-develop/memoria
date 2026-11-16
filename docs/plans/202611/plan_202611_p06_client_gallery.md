---
title: "Phase 6: Client gallery"
type: plan
status: draft
updated: 2026-11-16
related: [plan_202611_mvp.md, plan_202611_p01_core_adapters.md, plan_202611_p03_relay_email.md, plan_202611_p04_studio_settings.md, plan_202611_p05_galleries_upload.md, plan_202611_p07_proofing.md, ../../architecture.md, ../../recipes.md, ../../../AGENTS.md]
---

# Phase 6: Client gallery

> **Owner decision first (before commit 1):** option B below (the free plan; recommended) or Workers
> Paid ($5/month) with Next rendering the gallery. If Paid is chosen now, A1/A2 replace most of this
> plan's infrastructure (static shell, edge data module, `edge-graph`); see *The CPU question* and Open
> question 1.

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
- Every gallery response carries a signed visitor cookie (`mv`) for Phases 7 and 11, **without a D1
  write**.
- **Measured on the free plan** (Verification 4): a view costs **one Worker request for the page, plus
  one per further set or page of photos; a password gallery adds the gate's POST and one reload, once**;
  median ≤ 3 ms and p95 ≤ 6 ms of CPU; images and scripts cost no Worker request.
- `npm run ts-check` and `npm run test` green; `npm run preview` serves galleries through `worker.ts`.

**After the first usable version (M2):** protected image delivery (every image through `worker.ts`);
compare side by side (a proofing aid, with Phase 7); a virtualised grid if a 1,000-photo set is slow on a
phone.

- **Depends on:** Phase 4 M1 (gallery theme and swatches, font pairings; **commit 4**: the CSP profiles
  `securityHeaders({ dev, profile, media })`, D4.15), Phase 5 M1–M3 (galleries, photos, `sort_key`, `/g/<slug>`, `content_version`, the
  public media domain; **commit 6: `Chip`, `Tabs`, the `scrim` token (T5.9)**, so this phase's commit 5
  starts after Phase 5 commit 6). **Unblocks:** Phases 7 (favourites and submit inside this app; the
  `visitors` row from the `mv` cookie), 9 (downloads), 11 (views from the `mv` cookie).
- **Mockups:** `ClientGallery.dc.html`, `ClientLightbox.dc.html` (viewing parts), `Mobile.dc.html`.
- **Scope (feature IDs):** F1, F2, G1–G5, G7–G9.

## Starting point (verified 2026-11-16 against master `2b6972a`: Phases 0–2b done, Phase 3 M1–M3 done)

- **Measured on the free plan** (smoke deploy 2026-11-16, `npm run measure:cpu`):

  | Path | What runs | CPU |
  | --- | --- | --- |
  | `/healthz` | `worker.ts` only (`edgeResponse`, no D1) | **0 ms** |
  | relay cron, idle | a Worker without Next: platform, 2–3 D1 statements, a log line | **2–4 ms** |
  | relay cron, one email | the same + a template render and an SMTP send | 9 ms |
  | `/robots.txt` | a Next route handler | median 6, p95 14 |
  | `/` | a Next page (one heading, one D1 read) | median 8, p95 11 |
  | `/admin/login` | a Next page with the sign-in form | median 26, p95 37 (17 of 20 samples 20–37 ms) |
  | a cold start | the first request of an isolate (Next) | 182 ms |

  Every one of those requests answered 200, including the 20–37 ms sign-in samples: today the limit is
  not enforced per request, but Cloudflare documents 10 ms and can answer error 1102 (`exceededCpu` in
  the tail). **Design for the documented limit.**
- **`worker.ts`** (wrangler `main`): `edgeResponse(request, env)` answers `/healthz` before Next loads,
  else `openNext.fetch(request, env, ctx)`. It imports `./.open-next/worker.js` **statically** and
  re-exports OpenNext's Durable Object classes (`DOQueueHandler`, `DOShardedTagCache`,
  `BucketCachePurge`, "for when its caching options use them"; `wrangler.jsonc` declares **no**
  `durable_objects` binding), so every isolate evaluates OpenNext's module at startup, whatever path it
  serves. `src/lib/edge/routes.ts` is pure, declares its own `EdgeEnv` (no
  Cloudflare type) and exports `ROBOTS_TAG = 'noindex, nofollow'`.
- **Next**: `app/layout.tsx` is the only root layout, `force-dynamic`, with `generateMetadata` (the
  studio name as `<title>` for `/`, not-found and error: the smoke deploy saw a studio row show in the
  title), `export const viewport` (`themeColor`, `width=device-width`), `getAppConfig()` (D1) and
  `AppProvider` on every request. It is the only user of `AppProvider`;
  `components/forms/Turnstile.tsx` (used by the admin sign-in) is the only `useAppConfig` caller.
  `app/` also holds `page.tsx` (reads `getAppConfig` itself), `error.tsx`, `not-found.tsx` and
  `robots.ts` (no config). `components/admin/nav.test.ts` hard-codes `apps/web/src/app/admin/(panel)`.
  `open-next.config.ts` is `defineCloudflareConfig({})` (no incremental cache); `recipes.md → Caching`
  lists static pages, OpenNext's incremental cache and a `worker.ts` page cache (Cache API: "does nothing
  on `workers.dev` and preview URLs — only on a custom domain").
- **OpenNext and the assets**: prerendered HTML goes into OpenNext's cache (`createCacheAssets`), not into
  `.open-next/assets`. Static assets are served through the `ASSETS` binding; a request that matches an
  asset is served without running the Worker (free, unlimited). `assets` in `apps/web/wrangler.jsonc` has
  no `html_handling`, so the default `auto-trailing-slash` answers `/x.html` with a 307 to `/x`.
  `next dev` does not run `worker.ts`. `apps/web/package.json`'s `preview` and `deploy` call
  `opennextjs-cloudflare build` directly, not through `build:worker`; CI's check job runs `build:worker`,
  its deploy job runs the root `deploy`.
- **Headers**: `lib/security/headers.mjs` (plain `.mjs`, no imports) exports `securityHeaders({ dev })`
  and `contentSecurityPolicy`; `next.config.mjs` applies them to Next responses at build time; responses
  from `worker.ts` get none unless it sets them. Phase 4 D4.15 changes the signature to
  `securityHeaders({ dev, profile: 'studio' | 'gallery', media })`: the gallery profile = the studio CSP
  minus the Cloudflare beacon and the S3 endpoint, keeping Turnstile (`script-src`, `frame-src`) and
  `'unsafe-inline'` scripts (Next's inlined RSC payload; a static shell cannot carry a nonce), with the
  media domain in `img-src`. The media origins are baked in at `next build` (a change needs a rebuild and
  deploy).
- **Imports reachable from `worker.ts`** must avoid `server-only` and `@repo/db/client`
  (`@repo/db/client` imports `server-only` and `@repo/platform/current`). Import-free precedents:
  `@repo/db/rows` ("the Worker entry may import them") and `lib/db/queries/admin_two_factor_cli/sql.ts`.
  `statement()` lives in `@repo/db/client`; the `Statement` type is in `@repo/platform/ports`;
  `packages/db/package.json` exports `"./*": "./*.ts"` (a new file needs no entry). Guard
  `platform-boundary` allows only `apps/web/worker.ts` (of the web app) to import
  `@repo/platform-cloudflare` or name Cloudflare types. Guard `relay-graph` walks an import graph with an
  alias map, but its walker lives inside a `*.test.ts`.
- **`scripts/measure-cpu.mjs`** tags requests with `?cpu_probe=<run>` and sends warm-up requests until the
  tail sees one (since `c279082`).
- **Observability** is on for the app: Workers Logs and the tail record request URLs.
- **Rate limits**: `hitRateLimits(rules)` (fixed windows by upsert); the IP key hashes the raw
  `cf-connecting-ip` (`lib/security/request.ts`, `rateLimit.ts`), so an IPv6 client (a whole /64) gets a
  fresh key per address. `lib/auth/crypto.ts` `constantTimeEqual` pads to the longer input (the loop
  length leaks the stored value's length).
- **Turnstile**: `TURNSTILE_SITE_KEY` var + secret; `lib/turnstile/verify.ts`; the CSP allows
  `challenges.cloudflare.com`.
- **Phase 3 as built**: security notices (`lib/email/notices.ts`, templates `security.*`) enqueue a
  conditional email job to the account email in the event's batch; template ids are dotted.
- **From Phase 5** (planned): `galleries` (slug, status `draft|published`, access, `password_sealed`,
  `password_version`, delivery, `settings` JSON incl. `sort: 'filename' | 'taken'`, cover,
  `content_version`, `deleted_at`), `photo_sets` (with `photo_count`, `position`), `photos` (`status`,
  `hidden`, `rev`, `derivative_ext`, dims, colour, `sort_key`; index `ix_photos_set_order (set_id,
  sort_key)` with `hidden` and `status` filtered on the row, `sort_key` unique per photo and composed in SQL
  from the gallery's sort; FK `(set_id, gallery_id) → photo_sets (id, gallery_id)`); derivative keys `galleries/<g>/<p>/<rev>/{thumb,display}.<ext>`
  in the public bucket; `MEDIA_PUBLIC_BASE_URL` is the public media domain; `settingsCipher` opens the
  password (AAD `gallery.<id>.password`); `gallerySettings.ts` and `keys.ts` are import-free.
- **From Phase 4** (planned): `[data-gallery-theme]`, `[data-gallery-accent]`, `[data-gallery-font]` rules
  in the preset (`galleryThemeRules()` emits one rule set per exported role map, so this phase's
  `lightbox` map gets rules without editing it); the gallery root element carries `GALLERY_FONT_CLASSES`
  and all three attributes; `gallery.mjs` with `light` and `dark` maps (studio role names);
  `display-cover`, `Display`; the CSP profiles (above).
- No `visitors` table, no gallery route, no gallery shell exist.

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
  the admin is one person. At 1–2 Worker requests per view (the page, plus a set switch), 100k requests
  a day is 50–100k gallery views a day.
- **D remains the owner's call for the admin side**: the sign-in page (26 ms) and every admin screen and
  upload route of Phase 5 run through Next and exceed 10 ms. Today they answer 200; the day the tail shows
  `exceededCpu`, or if spikes S6.1/S6.2 fail, take Workers Paid. On Paid, B is still the better gallery.
- **C is B's fallback** if injecting into the shell proves fragile (S6.1): same code, one more round trip.

### Measurement plan (gates)

| # | When | What | Pass |
| --- | --- | --- | --- |
| S6.1 | commit 1, local (`npm run preview`) | the `force-static` page `app/gallery-shell/page.tsx` builds to `apps/web/.next/server/app/gallery-shell.html`; `build:app` copies it (and the 404 and 503 pages) into `.open-next/assets/__gallery/`; `worker.ts` serves `/g/x` from `env.ASSETS.fetch('/__gallery/shell')` with the markers replaced; OpenNext's module is imported lazily on the Next path only | the page renders and hydrates without a React warning; the response is built without calling Next (`routeEdge(request, deps, next)` in `src/lib/edge/routes.ts`, tested with a `next` that throws); `/admin` still reads D1 per request; the existing `not-found` and `error` pages still render (with their static titles), `/` keeps the studio name as its title; `shell.html` contains `name="viewport"`; with the Durable Object re-exports **removed**, `wrangler deploy --dry-run` accepts `worker.ts` and the startup no longer loads OpenNext |
| S6.2 | commit 2, local | `worker.ts` imports a module that runs import-free statement builders through `d1Db(env.DB)`; wrangler bundles it | `build:worker` passes; guard `edge-graph` passes; the bundle grows < 20 KB |
| S6.3 | after M1, production (the owner deploys) | `npm run measure:cpu -- https://<host>/g/<slug> 50` on a link gallery of 300 photos in 3 sets, and on `/g/<slug>/data?set=<id>`; the same on a password gallery with its cookie; **a cold gallery request**: the tail `cpuTime` of the first `/g/` request on a fresh isolate (right after a deploy) against a warm one | median ≤ 3 ms, p95 ≤ 6 ms (warm); the cold request recorded; else profile and decide (cache the JSON, smaller pages, or D) |
| S6.4 | during Phase 5 and 6 use | `npm run wrangler -- tail memoria --format json` filtered on `outcome` | no `exceededCpu`; any → bring decision D to the owner |

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D6.1 | **Option B (proposed, the owner decides before commit 1)**: `/g/<slug>` is answered by `worker.ts` before Next loads: the prebuilt shell from the assets, with the gallery's head, theme attributes and first page of data injected. `/g/<slug>/data` answers further sets and pages. | The CPU analysis above. |
| D6.2 | **One static root layout; no route-group move.** `app/layout.tsx` keeps only `<html suppressHydrationWarning>`, `<body>`, the studio fonts, `globals.css` **and `export const viewport`** (`themeColor`, `width=device-width`: the shell needs it on phones), and loses `force-dynamic`, `generateMetadata`, `getAppConfig` and `AppProvider`. A new **`app/admin/layout.tsx`** takes them (`force-dynamic`, `generateMetadata` with the title template and `metadataBase`, `getAppConfig`, `AppProvider`): it covers the panel and the sign-in page, so `nav.test.ts`'s `app/admin/(panel)` and every Phase 4/5 path stay valid. `app/page.tsx` gets `force-dynamic` **and its own `generateMetadata`** (the studio name as title, `metadataBase`), so `/` keeps today's title; `error.tsx` and `not-found.tsx` get a static title (`metadata`/`<title>`: they render without the studio name); `robots.ts` stays at the root. **The shell**: `app/gallery-shell/layout.tsx` (renders the gallery wrapper `<div data-gallery-root>` carrying `GALLERY_FONT_CLASSES`, no D1) and `app/gallery-shell/page.tsx` (`force-static`, renders `<GalleryApp />`, and `export const metadata = { other: { 'memoria-gallery-head': '1' } }` — the only metadata, which emits the head marker). `/api/**` routes are unaffected (no layout). | One root layout avoids the experimental `globalNotFound` flag and a duplicate `<html>`; the admin keeps its per-request config; the shell is the same for every gallery, so it can be an asset. |
| D6.3 | **The shell is copied into the assets by `build:app`.** `scripts/gallery-shell.mjs` copies `apps/web/.next/server/app/gallery-shell.html` → `.open-next/assets/__gallery/shell.html` and `.next/server/app/_not-found.html` → `__gallery/404.html`, and writes `__gallery/503.html` from a tiny static template ("The gallery is not available right now"); it **exits 1** if a source is missing or a marker is not found exactly once. A new `build:app` script (OpenNext build, then the copy) is called by `apps/web/package.json`'s `build:worker`, `preview` and `deploy` and by the root scripts that call them, so CI's `build:worker` fails when the shell is missing. `worker.ts` fetches `/__gallery/shell`, `/__gallery/404`, `/__gallery/503` **without the `.html` extension** (the default `auto-trailing-slash` would 307 them). Those three paths are publicly reachable (no data in them: harmless). If ASSETS answers anything but 200 for the shell → the 503 page and `gallery_shell_missing` (error log). | OpenNext keeps prerendered HTML in its cache, not the assets; one build, one set of hashed chunks; a missing shell fails the build, not production. |
| D6.4 | **Injection by markers, not `HTMLRewriter`**: the gallery wrapper `<div data-gallery-root` (the same element that carries `GALLERY_FONT_CLASSES`: `next/font` variables exist only where their class is) gets `data-gallery-theme`, `data-gallery-accent` and `data-gallery-font`; `<html` gets `data-gallery-theme` too (so the page background and `color-scheme` match) and `lang` (React does not warn: `suppressHydrationWarning` on `<html>` and on the wrapper); `<meta name="memoria-gallery-head" content="1">` becomes `<title>`, the description and the Open Graph tags; the view JSON is inserted as `<script id="__gallery" type="application/json">` **just before `</body>`, outside React's tree** (every `<` written as the six characters `<`, and U+2028/2029 as ` `/` `). Every injected attribute value and `content` goes through **one attribute escaper** (`&`, `<`, `>`, `"`, `'`). `GalleryApp` renders a fixed placeholder on its first (hydration) render and reads `#__gallery` through `useSyncExternalStore`, so server and client markup agree. A pure `injectGallery(shell, view)` does all three. | Runs in workerd **and** in Node (so `next dev` and vitest use the same function); the shell is our own static file, so markers are reliable; the build check guards them; no hydration mismatch; no injection through a title. |
| D6.5 | **One handler, two hosts**: `handleGalleryRequest(request, deps)` (`src/lib/edge/gallery/handler.ts`, import-free of Next and `server-only`) takes `deps = { db: Db, assets(path): Promise<Response>, cache: JsonCache, config: EdgeGalleryConfig, now, waitUntil }` — **structural types only** (no Cloudflare type: guard `platform-boundary`, like `routes.ts`'s `EdgeEnv`). **`routeEdge(request, deps, next)`** lives in the existing `src/lib/edge/routes.ts` next to `edgeResponse` (which stays and still answers `/healthz`). Production: **`worker.ts` itself** builds `deps` (`d1Db(env.DB)`, `env.ASSETS.fetch`, `caches.default`, `ctx.waitUntil`) and imports OpenNext lazily (`const { default: openNext } = await import('./.open-next/worker.js')`) only when `routeEdge` hands the request to Next. **The three Durable Object re-exports (`DOQueueHandler`, `DOShardedTagCache`, `BucketCachePurge`) and their comment are deleted**: a static re-export evaluates the module at startup and would make the lazy import do nothing, and no `durable_objects` binding uses them (re-adding OpenNext caching later re-adds them deliberately). Development: Next route handlers `app/g/[slug]/route.ts` and `app/g/[slug]/data/route.ts` (GET and HEAD) build `deps` from `getPlatform()` and fetch the shell from `/gallery-shell`; they **answer 404 unless `NEXTJS_ENV=development`** (like the blob routes), because any `/g/*` request `worker.ts` does not match would otherwise reach them in production. `isGalleryPath` matches exactly `/g/<slug>` and `/g/<slug>/data` (lower-case slug shape, no trailing slash, GET/HEAD); anything else under `/g/` gets the 404 page from `worker.ts`. | `npm run dev` keeps working; the tested code is the deployed code; `npm run preview` exercises the `worker.ts` path; no unauthenticated fall-through; a gallery request on a fresh isolate does not pay OpenNext's module evaluation. |
| D6.6 | **Edge-safe SQL**: `statement()` moves to an import-free `packages/db/statement.ts` (no `exports` change: `"./*"` covers it; `Statement` stays a type in `@repo/platform/ports`; `@repo/db/client` re-exports `statement`). The public reads are builders in `lib/db/queries/galleries/public.ts`, `photo_sets/public.ts`, `photos/public.ts` and `site_settings/public.ts`, importing only `@repo/db/statement`, `@repo/db/rows` and types, imported **by path, never through the `export *` barrels**; the handler executes them on the `Db` port it is given. Phase 5's `gallerySettings.ts` (`parseGallerySettings` returns `{ value, invalid }`, the caller logs) and `keys.ts` are import-free (in the walk). Guard **`edge-graph`** walks from `apps/web/worker.ts` with the walker extracted to **`scripts/guards/importGraph.ts`** (a non-test module; `relay-graph` uses it too), an empty alias map, `./.open-next/worker.js` whitelisted as unresolved, `@repo/logger` allowed; it refuses `server-only`, `@repo/db/client`, `@repo/platform/current`, `next`, `react`, `@opennextjs/*` and any `queries/<table>/index.ts` barrel, and prints the chain. | SQL stays in the query modules (AGENTS.md); no wrangler `alias` that could also rewrite OpenNext's bundle; the boundary is checked; importing a test file's walker would re-register its tests. |
| D6.7 | **The view JSON** (`GalleryView`, versioned `v: 1`): `gallery` (id, slug, title, date, purpose, welcome note — plain text, rendered as text and escaped in the description tag, never HTML —, cover `{ id, w, h, color, rev, ext }` or null, theme, accent, font, grid, sort, `protect` = right-click deterrent), `studio` (`{ name, website, locale, timeZone }`, read per request, not cached: D6.8; `locale`/`timeZone` are `en-GB`/`UTC` until Phase 4 M2's T4.11, and the client passes them to `@repo/ui/date`, since the gallery has no `AppProvider`), `media` (the public base URL), `sets` (`{ id, name, count }`), `page` (`{ setId, photos: [id, w, h, color, rev, ext][], next }`, ≤ 500 photos), `gate` (instead of everything but the title and studio when the password is missing), `turnstileSiteKey` on the gate. `rev` is checked `[a-z2-9]{8}` and `ext` ∈ {`webp`, `jpg`} when the view is built; the browser builds URLs with Phase 5's pure `thumbKey`/`displayKey` (gallery id + photo fields). No filenames (Phase 7 adds them when "show filenames" is on), no client data, no password. | Compact (~80 bytes a photo, ~40 KB per 500 before gzip); an original key cannot be built into a public URL (private bucket); one shape for the page and `/data`. |
| D6.8 | **Cache the photo JSON, not the HTML**: each request runs one D1 batch of two indexed reads — the gallery row by slug (access, `content_version`, settings) and the `studio` row of `site_settings` (name and website, so a studio rename shows at once; without a row, `APP_NAME` read raw from env by `edgeGalleryConfig` — not `Config.bootstrap`, so guard `settings-through-store` is not involved). The sets and photo page are cached in `caches.default`: the page's first view under the literal key `https://cache.internal/g/<id>/<content_version>/first/start` (no set id is known before the read), later pages under `…/<content_version>/<setId>/<cursor>`, for 1 day (`waitUntil(put)`; `content_version` changes when the sort changes, Phase 5 D5.12). **A cached entry is a separate internal `Response`** built from the JSON (`Cache-Control: public, max-age=86400`, no `Set-Cookie`), never the outgoing response (which is `private` and may carry the `mv` cookie, so `cache.put` would refuse or never match it). A miss reads ≤ 50 sets and ≤ 500 photos through `ix_photos_set_order (set_id, sort_key)` (`hidden` and `status` filtered on the row); `publicPhotosStatement(galleryId, setId, cursor)` joins `photo_sets s ON s.id = p.set_id AND s.gallery_id = ?`, so a set of another gallery returns nothing (→ 404) even on a cache miss; **the cursor is the last `sort_key` of the page** (unique per photo, Phase 5), minted by the server, base64url, at most 700 characters. On `workers.dev` the cache is inert and every view reads D1 (still ~2–3 ms). On a D1 error the page is the 503 page: no stale-if-error, because access cannot be checked without the gallery row. | Access is decided fresh on every request; an admin change is visible at once (a new version = a new key); D1 rows read per cached view = 2. |
| D6.9 | **Keys**: `SETTINGS_ENCRYPTION_KEY` (base64, 32 bytes, decoded exactly as `parseConfig` does) → HKDF-SHA256 with salt `memoria:gallery:salt:v1` and three infos: `memoria:gallery-access:v1` (access cookies), `memoria:gallery-preview:v1` (preview tokens), `memoria:gallery-visitor:v1` (visitor cookies) — distinct from `settingsCipher`'s `memoria:settings:secret:v1`. The derived HMAC keys are kept on `globalThis` per key fingerprint (derived once per isolate). Rotating the key ends every gallery cookie and preview link (and Phase 5's sealed passwords must be set again): deployment.md's runbook line (Phase 5 docs task). | One deploy-level secret, separate keys per purpose; a MAC of one kind never verifies as another. |
| D6.10 | **Access**: link galleries need nothing beyond the slug. Password galleries: `POST /api/g/[slug]/access` (a **Next** route: rare, and the house pattern for a public write) in this order: same-origin → a cheap per-IP counter (30 a minute; the IP keyed by **/64 for IPv6 and /32 for IPv4**: a change to the shared IP-key helper in `lib/security`, so every existing limit benefits) → Turnstile → the per-IP failure limit (10 failures per 15 minutes per IP and gallery → 429) → the comparison: **HMAC(k, supplied) against HMAC(k, stored), then a constant-time equal** of the two 32-byte MACs (no length leak). The sealed password is opened with `settingsCipher` **only in this route, never under `lib/edge/**`**. Success sets `mg_<first 12 hex of the id>` = `v1.<password_version>.<expiry>.<MAC>`, MAC = HMAC-SHA256(access key, `access|v1|<full gallery id>|<password_version>|<expiry>`) — `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, **`Path=/`**, 30 days (Phase 7's and 11's `/api/g/<slug>/…` writes must see it, and *New link* changes the slug; the name is keyed by the gallery id, so cookies of different galleries never collide; a password change still ends it). `worker.ts` rejects a malformed or past expiry first, then checks with `crypto.subtle.verify`. **No global hard lock**: failures per gallery and `password_version` are counted in a daily `rate_limits` window; at 200 in a UTC day, one security notice goes to the account email (`security.gallery-gate`: the gallery title only, suggesting a new password; through Phase 3's notice mechanism, once a day per gallery) and `gallery_gate_suspicious` is logged. | No PBKDF2 on a public path; the full id in the MAC stops a cookie of gallery A opening gallery B; a password change (`password_version + 1`) ends every cookie; an attacker cannot lock the client out, and the photographer learns about a slow attack; AGENTS.md's public-write rule (Turnstile and the rate limit before any write) is kept, and junk POSTs are counted before they cost a `siteverify` call. |
| D6.11 | **Preview links open drafts only**: `POST /api/admin/galleries/[id]/preview-link` (owned by this phase; Phase 5's *View as client* button, disabled until now, calls it) mints `/g/<slug>?preview=<exp>.<MAC>`, MAC = HMAC(preview key, `preview|v1|<full gallery id>|<exp>`), 1 hour. It opens a **draft** (a password draft too, since the photographer is previewing); on a published gallery it is ignored (the normal access rules apply). The client reads it, strips it from the address bar with `history.replaceState`, and forwards it to `/g/<slug>/data`. Not revocable within its hour (accepted: it shows only what the photographer is about to publish). | *View as client* before publishing, without an admin session check in `worker.ts`; a leaked preview link never bypasses a published gallery's password. |
| D6.12 | **A view writes nothing to D1.** Every gallery response (page, gate and `/data`) sets the **`mv` visitor cookie** when it is absent or invalid: `v1.<128-bit random id, base64url>.<MAC>` (visitor key, D6.9), one per browser, site-wide: **`Path=/`**, 1 year, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS. Phase 7 creates the `visitors` row from it at the first favourite or name prompt; Phase 11 counts views from it (its beacon's route is Phase 11's decision, likely in `worker.ts`). | The view path stays read-only and cacheable, and no migration is needed here; later phases get a stable anonymous id from the first view, so browsing-only visitors can be counted. |
| D6.13 | **Responses from `worker.ts` set their own headers**: `securityHeaders({ dev, profile: 'gallery', media })` from `src/lib/security/headers.mjs` (imported relatively; Phase 4 D4.15: the studio CSP minus the Cloudflare beacon and the S3 endpoint, **keeping Turnstile in `script-src` and `frame-src` and `'unsafe-inline'` scripts**, with the media domain in `img-src`), `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` (the slug of a link gallery is its secret), `Cache-Control: private, no-store` for the page, `private, max-age=60` for `/data`; no analytics beacon on gallery pages. | Outside Next none of the site headers apply (Phase 1's finding); a client page has no reason to reach the upload endpoint. |
| D6.14 | **Link previews**: `og:title` = the gallery title, `og:description` = the studio name, `og:image` = the cover's display copy **only for link-access galleries**; a password gallery's preview has no image. `robots.txt` stays open (bots must fetch the page to read the tags). | Galleries are private; a password gallery should not leak a photo through a shared preview. |
| D6.15 | **Grids are computed in the browser** from the known sizes: justified rows (target row height, last row not stretched), masonry (shortest column, row-major reading order), square (cover crop). Pure functions, table-tested. Thumbnails `loading="lazy"` with the placeholder colour as background; pages of 500 loaded as the user nears the end, in the server's order (never re-sorted in the browser). | No layout shift (sizes are known), the gallery's order kept, no server work. |
| D6.16 | **Lightbox**: a native `<dialog>` (`@repo/ui/dialog`) in the lightbox palette — the `lightbox` map this phase adds to Phase 4's `gallery.mjs` (T6.7) — the photo id in the URL hash (`#p=<id>`: Back closes it, a link opens it), ←/→/Esc, swipe (pointer events), the next and previous display copies preloaded, a filmstrip of thumbnails, the counter. | Keyboard and screen-reader behaviour from the platform; shareable photo links inside the gallery. |
| D6.17 | **Right-click deterrent** on selection galleries (`contextmenu` and drag cancelled on images, `-webkit-touch-callout: none`); off on sharing galleries. Documented as a deterrent only. | The protection of a selection gallery is the low resolution and the watermark (index); this only stops the casual "Save image as". |
| D6.18 | **Share** = the Web Share API where present, else copy the link; no third-party social buttons. The studio website link is `https` only (Phase 2b's `parseStudioInput` forces it) with `rel="noopener noreferrer"`; the client never uses `dangerouslySetInnerHTML`. | No third-party scripts, no tracking, no script through studio text. |
| D6.19 | **Protected delivery is M2**: `/g/<slug>/i/<photoId>/<rev>/<thumb\|display>.<ext>` answered by `worker.ts` (gallery published, cookie valid for password galleries) streaming `env.MEDIA.get(key)` with `Cache-Control: private, max-age=86400`; the gallery row cached per isolate for 60 s on `globalThis`. One Worker request per image (~1 ms each): a 300-photo gallery fully browsed costs ~600 requests. | Revocation that also covers images, for the photographer who needs it, at a clearly stated request cost; not needed for the first usable version. |
| D6.20 | **Unknown query parameters are ignored**: the handler reads only `set`, `cursor` and `preview`. | `measure-cpu.mjs` adds `?cpu_probe=`; S6.3 must not measure 404s. |

## Design

### Request flow (production)

```
GET /g/<slug>                    worker.ts → routeEdge → handleGalleryRequest
  slug shape? no → the 404 page (/__gallery/404)
  one D1 batch: galleryBySlug (id, status, access, password_version, content_version, settings, cover…) + the studio row
    none, deleted, or draft without a valid ?preview → 404 page
    password and no valid mg_ cookie → injectGallery(shell, gateView)            (no photos, no cover)
  cache.get(g/<id>/<cv>/first/start) ?? (sets + photos page from D1 → cache.put of an internal Response in waitUntil)
  injectGallery(shell, view) → 200 text/html, headers (D6.13), mv cookie if absent (D6.12)
GET /g/<slug>/data?set=&cursor=  the same checks → JSON page ({ data } envelope)
POST /api/g/<slug>/access        Next: same-origin → per-IP counter → Turnstile → failure limit → HMAC compare → Set-Cookie → { data: { ok: true } }
D1 error                         the 503 page (/__gallery/503), gallery_unavailable log (no id, no slug)
images                           https://<media domain>/galleries/<g>/<p>/<rev>/thumb.webp   (CDN, no Worker)
scripts, styles, fonts           /_next/static/…                                             (assets, no Worker)
everything else                  routeEdge → next → (lazy) openNext.fetch
```

### Modules

```
apps/web/worker.ts                      builds the edge deps from env (d1Db(env.DB), env.ASSETS, caches.default,
                                        ctx.waitUntil) and calls routeEdge; imports OpenNext lazily on the Next path
                                        (the Durable Object re-exports deleted); the only web file touching Cloudflare
apps/web/src/lib/edge/routes.ts         edgeResponse (/healthz, unchanged) + routeEdge(request, deps, next) + isGalleryPath
apps/web/src/lib/edge/gallery/
  handler.ts      routing inside /g/<slug>(/data); access; cache; responses (structural deps)
  view.ts         rows → GalleryView (pure; never reads password or client fields; checks rev/ext)
  inject.ts       injectGallery(shell, view) + escapeAttr (pure, D6.4)
  access.ts       access cookie, preview token, visitor cookie: sign/verify; HKDF derivation (Web Crypto, pure)
  headers.ts      galleryHeaders(config) = securityHeaders({ dev, profile: 'gallery', media }) + the D6.13 extras (pure)
  deps.ts         EdgeGalleryDeps, JsonCache, EdgeGalleryConfig (structural types, no Cloudflare type)
  config.ts       edgeGalleryConfig(env-shaped record) (pure: media base URL, key bytes, Turnstile site key,
                  APP_NAME default, isDevelopment)
apps/web/src/app/layout.tsx             the one root layout, now static (html, body, studio fonts, globals, viewport)
apps/web/src/app/admin/layout.tsx       force-dynamic, generateMetadata, getAppConfig, AppProvider (new)
apps/web/src/app/page.tsx               + force-dynamic and its own generateMetadata (studio name title)
apps/web/src/app/not-found.tsx, error.tsx   + a static title
apps/web/src/app/gallery-shell/layout.tsx, page.tsx   the static shell: <div data-gallery-root> with the font classes (D6.2)
apps/web/src/app/g/[slug]/route.ts, g/[slug]/data/route.ts   development host of the same handler (D6.5)
apps/web/src/app/api/g/[slug]/access/route.ts                  the gate (D6.10)
apps/web/src/app/api/admin/galleries/[id]/preview-link/route.ts   preview links (D6.11)
apps/web/src/components/gallery/        GalleryApp, GalleryHeader, Cover, SetTabs, SetChips, Grid (layouts),
                                        Lightbox, Filmstrip, Gate, ShareButton, store.ts (view state)
apps/web/src/components/forms/Turnstile.tsx   splits: Turnstile({ siteKey, … }) (prop only, no context) + AdminTurnstile
                                        (reads AppProvider's key and renders Turnstile; the admin sign-in uses it)
apps/web/src/lib/gallery/layout.ts      justified / masonry / square (pure)
packages/db/statement.ts                statement() (import-free, D6.6)
apps/web/src/lib/db/queries/galleries/public.ts, photo_sets/public.ts, photos/public.ts, site_settings/public.ts
scripts/gallery-shell.mjs               copy + marker check (D6.3), run by the new `build:app` script
scripts/guards/importGraph.ts           the import walker (from relay-graph) — non-test module
scripts/guards/edge-graph.test.ts       D6.6
```

- `EdgeGalleryConfig` = `{ mediaBaseUrl, keys: { access, preview, visitor } (CryptoKeys, derived once per
  isolate, D6.9), turnstileSiteKey, appName, isDevelopment }`, parsed by the pure `edgeGalleryConfig(env)`
  (no `parseConfig` dependency unless the `edge-graph` guard accepts its imports). A missing or bad
  `SETTINGS_ENCRYPTION_KEY` → password galleries show the 503 page (logged `gallery_key_missing`); link
  galleries still work (their visitor cookie is skipped).
- The studio row is parsed by Phase 2b's `parseStudioInput` if its imports pass `edge-graph`, else by a
  narrow pure parser beside the handler (name and website only).
- Public reads: `galleryBySlugStatement(slug)` (`WHERE slug = ? AND deleted_at IS NULL`, the columns the
  view needs), `publicSetsStatement(galleryId)` (`ORDER BY position LIMIT 50`),
  `publicPhotosStatement(galleryId, setId, afterSortKey, 500)` (`FROM photos p JOIN photo_sets s ON s.id = p.set_id
  AND s.gallery_id = ? WHERE p.set_id = ? AND p.sort_key > ? AND p.hidden = 0 AND p.status = 'ready' ORDER BY
  p.sort_key LIMIT 500`, served by `ix_photos_set_order (set_id, sort_key)`; the gallery's sort is already in
  `sort_key`, Phase 5), `studioSettingStatement()`.
  Rows read per uncached view: 2 + sets + ≤ 500 (+ the set's hidden, `uploading` and `deleted` rows the
  index visits: few).

### The client app (`components/gallery/`)

- `GalleryApp` renders a placeholder on the hydration render, then reads `#__gallery` once
  (`useSyncExternalStore`, `JSON.parse`), validates `v`, and renders the gate or the gallery; set switches
  and "load more" fetch `/g/<slug>/data` through `useApi` (the route answers the `{ data }` envelope),
  forwarding `preview` when present.
- **Header and cover**: studio name (logo in Phase 4 M2), the cover display copy full-bleed with the title
  in `Display` (`display-cover`) and the date (formatted by `@repo/ui/date` with `view.studio.locale` and
  `timeZone`), *View gallery* scrolls to the
  grid; the welcome note below, as text. A gallery without a cover (Phase 5 picks a landscape default)
  starts at the title.
- **Sets**: tabs on desktop (`Tabs`, Phase 5 T5.9), chips on phones (`Chip`); counts from `sets`.
- **Grid**: the layout of the gallery (D6.15); gaps and radii from tokens; a focusable button per photo
  opening the lightbox; `alt` = "Photo N of M" (no filenames).
- **Lightbox** (D6.16): display copy at `object-contain`, thumbnail shown until it loads; controls in
  `scrim` buttons (T6.7); the heart, download and comment slots exist but render nothing until Phases 7
  and 9.
- **Gate**: title, studio name, password field (`@repo/ui/input`, 16 px on phones), `Turnstile` with
  `siteKey={view.turnstileSiteKey}` (the prop-only component: the gallery has no `AppProvider`), submit → `POST /api/g/<slug>/access` → on
  success `location.reload()`; wrong password: "That password is not right" (no detail), 429: "Too many
  tries. Try again in a few minutes."
- **Mobile**: 2-column grid, set chips under a sticky header, the lightbox full-screen with swipe; the
  favourites bar and bottom navigation arrive with Phase 7.
- Fonts: the wrapper `<div data-gallery-root>` in `app/gallery-shell/layout.tsx` carries
  `GALLERY_FONT_CLASSES`, and `data-gallery-font` is injected on that same element (D6.4), so the pairing's
  variables resolve and only the chosen pairing downloads. The text font of every pairing is Inter (studio
  subset `latin`; Cyrillic renders through its `unicode-range` faces).

### Tokens (T6.7)

- `gallery.mjs` (Phase 4) gains a third map, **`lightbox`**, with the **studio role names** (so `Button`
  and `Dialog` work inside it): `ground` `#0F1011` (bg), `surface` `#17191B` (panel), `wash` `#17191B`,
  `ink` `#F1F0EC` (fg), `ink-2` `#D4D3CF` (soft), `ink-muted` `#A9ABAF` (muted), `line` `#34363A`
  (border), `accent` `#8FD3BF`; `ink-faint`, `ink-hover`, `line-control`, `line-input`, `accent-ink`,
  `accent-tint`, `focus`, `inverse` derived with Phase 4's `galleryAccent` rules; roles a lightbox does
  not use keep the studio values. Emitted on `[data-gallery-theme="lightbox"]` with `color-scheme: dark` by
  Phase 4's `galleryThemeRules()` (one rule set per exported map: no change to the function).
  Phase 4's key-set test iterates every map, so it covers `lightbox`; contrast rows for its text pairs.
  `LIGHTBOX_EXTRAS = { fav: '#E08A5C', favFg: '#F4B190' }` (outside the role maps) are constants for Phase 7.
- A photo text shadow (`textShadow.photo` in `studio.mjs`, a `text-shadow-photo` utility) for text over the
  cover; the `scrim` Button variant (fill `scrim/55` — the token from Phase 5 T5.9 —, `inverse` text) for
  controls over photos.

### Errors and limits

- The 404 page for: a bad slug shape, unknown, deleted, draft without a valid preview, a `/data` set of
  another gallery, a malformed or foreign cursor, any other path under `/g/`. Nothing says which.
- A D1 error, a missing shell or a missing key → the 503 page ("The gallery is not available right now"),
  logged `gallery_unavailable` / `gallery_shell_missing` / `gallery_key_missing` with no id and no slug
  (on a D1 error only the slug is known, and slugs are never logged).
- `/data`: `set` must be a UUID of the gallery (enforced by the join in `publicPhotosStatement`); `cursor`
  is a base64url `sort_key` the server minted (Phase 5's shape, at most 700 characters; Phase 5 truncates
  `name_key` to 120 characters before padding).
- An invalid `settings` JSON reads as defaults (Phase 5's parser returns the invalid fields; the handler
  logs `gallery_settings_invalid`), never a broken page.

## Workstreams

### A. Foundations (spikes first)

- **T6.1** S6.1: the static root layout (keeping `viewport`), `app/admin/layout.tsx`, `force-dynamic` and
  `generateMetadata` on `app/page.tsx`, static titles on `not-found.tsx`/`error.tsx`, the `gallery-shell`
  layout (the `data-gallery-root` wrapper) and page (with the head marker), `scripts/gallery-shell.mjs`
  (also asserting `name="viewport"` in `shell.html`) and the `build:app` script (wired into
  `build:worker`, `preview`, `deploy` and the root scripts), `routeEdge` in `routes.ts`, `worker.ts`
  serving the shell for `/g/*` in preview, the Durable Object re-exports deleted and OpenNext imported
  lazily (`wrangler deploy --dry-run` accepts it); record the result here; the existing not-found and error
  pages still render; `/admin` still dynamic; `/` keeps the studio name as its title.
- **T6.2** S6.2: `packages/db/statement.ts`; the public statement builders; `scripts/guards/importGraph.ts`
  (walker moved out of `relay-graph`), guard `edge-graph` (self-tests: `worker.ts` → `server-only`
  caught; `@repo/db/rows`, `@repo/db/statement` and `@repo/logger` pass; a barrel import of a query module
  caught; `./.open-next/worker.js` ignored).

### B. The gallery path

- **T6.3** `lib/edge/gallery/*` (handler, view, inject, access, headers, config, deps), the development
  route handlers (404 outside development), the JSON cache, the `mv` visitor cookie, the deps built in
  `worker.ts`.
- **T6.4** The gate route (order of D6.10, the IPv6 /64 key change in the shared helper with test rows,
  HMAC compare, cookie, the daily failure count and the `security.gallery-gate` notice template), the
  preview-link route; Phase 5's *View as client* button is enabled and calls it; `Turnstile` splits into
  the prop-only `Turnstile({ siteKey })` and `AdminTurnstile` (the admin sign-in switches to it).

### C. The client app

- **T6.5** `GalleryApp`, header and cover, sets (tabs and chips), the three grids with
  `lib/gallery/layout.ts`, load-more, the gate form, share, the right-click deterrent, the preview
  parameter handling; gallery dates with `view.studio.locale`/`timeZone`; mobile layout. Starts after
  Phase 5 commit 6 (`Chip`, `Tabs`, `scrim`).
- **T6.6** Lightbox, filmstrip, keyboard, swipe, hash routing, preloading.
- **T6.7** Tokens: the `lightbox` map, the photo text shadow, the `scrim` Button variant; design page
  sections.

### D. After the first usable version (M2)

- **T6.8** Protected delivery (D6.19), offered in New gallery and Settings → Galleries (Phase 4 D4.13
  and Phase 5 D5.21 lift their *Soon*).
- **T6.9** Compare side by side (with Phase 7); a virtualised grid if Verification 3 shows a slow phone.

### E. Docs (each in its commit)

- Commit 1: `architecture.md` → Hosting (the gallery path: `worker.ts` answers `/g/*` with the static
  shell; one static root layout, the admin layout), `recipes.md` → Caching (option B as the gallery's
  choice).
- Commit 2: AGENTS.md → *Edge-safe code* (what `worker.ts` may reach; `@repo/db/statement`; public
  builders imported by path; guard `edge-graph`), guards list.
- Commit 3: `architecture.md` → *Client galleries* (flow, the three cookies and their keys, cache keys,
  headers).
- Commit 4: deployment.md → the gate's notice and what the photographer does with it.
- Commit 7: index *To verify* (the pages' CPU: resolved for galleries by B, with S6.3's numbers).

## Tests

| Test | What |
| --- | --- |
| `lib/gallery/layout.test.ts` | table: justified rows for known sizes and widths (row heights, last row not stretched, a panorama alone on a row); masonry columns and row-major order; square; 0 and 1 photo; width changes |
| `edge/gallery/access.test.ts` | access cookie: valid; `Path=/` on `mg_` and `mv`; tampered MAC; **gallery A's cookie sent as `mg_<B>` to gallery B** (same version and expiry) → refused; old `password_version`; expired; malformed expiry rejected before the MAC; preview token: valid, expired, for another id; **an access MAC used as a preview token and a preview MAC used as an access cookie → refused**; visitor cookie: valid, tampered, minted when absent; the three keys differ (HKDF infos) |
| `edge/routes.test.ts` | `/healthz` unchanged; `/g/<slug>` and `/data` reach the handler without calling `next` (a throwing stub); `/G/x`, `/g/x/`, `/g/x/other`, POST → the 404 page; other paths → `next` |
| `edge/gallery/inject.test.ts` | each marker replaced once; the JSON script lands just before `</body>` (outside the React root); **quotes, `-->`, `</script>`, `&` and Cyrillic in the title, studio name and welcome note, for every marker** (attributes, `<title>`, `og:*` content, JSON); U+2028 in JSON; missing marker throws; OG image only for link galleries |
| `edge/gallery/view.test.ts` | rows → view: no `password_sealed`, `client_email`, `client_name` or filename in the output (deep key scan); hidden, deleted and uploading photos absent; the string `original` never appears; a bad `rev` or `ext` row is dropped (logged); sizes and colours carried |
| `edge/gallery/handler.test.ts` | test D1 + a fake assets fetcher + an in-memory `JsonCache`: published link gallery → 200 with injected JSON and an `mv` cookie; a valid `mv` is not re-minted; draft → 404, with a valid preview → 200; deleted → 404; unknown or malformed slug → 404; password gallery without cookie → gate view (no photos, no cover), with a valid cookie → full view, with an old-version cookie → gate; a preview token on a published password gallery → gate (ignored); a studio rename shows without a `content_version` change; `?cpu_probe=1` and other unknown parameters → 200; the development route handlers answer 404 when `NEXTJS_ENV` is not `development`; `/data` of another gallery's set → 404, **also on a cache miss** (the join, not the cache, refuses it); a published gallery's `mg_`/`mv` cookies are sent to a `/api/g/<slug>/…` request (cookie path `/`); paging by `sort_key` cursor round trip (both sorts), a 700-character cursor accepted, 701 → 404; the first view's cache key is `…/first/start`; a cache hit reads only the two rows (Db spy); the cached entry is an internal `Response` (`public`, no `Set-Cookie`) while the outgoing one is `private` with the `mv` cookie; a changed `content_version` misses; the assets fetcher answering 404 for the shell → the 503 page; a D1 error → the 503 page; headers (gallery CSP with the media origin, **Turnstile in `script-src` and `frame-src`**, `'unsafe-inline'` scripts, no beacon, no S3 endpoint; `X-Robots-Tag`, `Referrer-Policy: no-referrer`, `no-store`); the injected theme, accent and font attributes land on the `data-gallery-root` wrapper and the theme on `<html>` too; the D1-error log line carries no id or slug |
| `api/g/[slug]/access/route.test.ts` | cross-origin → 403; the per-IP counter → 429 before Turnstile is called; Turnstile failure (mocked) → 403 before any password work; failure limit → 429; wrong password → 401 with a fixed message; right → 200 + `Set-Cookie` with `Path=/`, `HttpOnly`, `SameSite=Lax`; link gallery or unknown slug → 404; the 200th failure of a day enqueues one `security.gallery-gate` notice, the 201st none; two IPv6 addresses in one /64 share a limit, two /64s do not |
| `lib/security` IP-key rows | IPv4 → /32; IPv6 → /64 (expanded and compressed forms, an IPv4-mapped address); the existing limits' tests still pass |
| `api/admin/galleries/[id]/preview-link/route.test.ts` | 401/403; returns a token the handler accepts for a draft; 404 for a deleted gallery |
| `scripts/gallery-shell.test.ts` | the copy and marker check on sample files: a source missing, a marker missing or doubled, or no `name="viewport"` in the shell → exit 1; present → the three files written |
| layout/metadata | `app/page.tsx` exports `generateMetadata` and `dynamic = 'force-dynamic'`; the root layout exports `viewport` and no `dynamic`; `app/admin/layout.tsx` is `force-dynamic` (a small source test, like `nav.test.ts`) |
| guards | `edge-graph` self-tests (above); `relay-graph` unchanged on the extracted walker; `every-route-wrapped` covers the new routes |
| `packages/db/statement.test.ts` | the moved `statement()` keeps its parameter checks (undefined and booleans throw); `@repo/db/client` re-exports it |
| component tests | `GalleryApp`: placeholder first, then gate vs gallery from the inline JSON; `preview` stripped from the URL and forwarded; set switch fetches `/data`; grid keyboard focus and Enter opens the lightbox; lightbox ←/→/Esc, hash updates, Back closes; swipe handler (pointer events); right-click cancelled only on selection galleries; share falls back to copy; gate errors; **the Gate renders `Turnstile` with no `AppProvider`** (the `siteKey` prop); `AdminTurnstile` still reads the provider; dates use the view's locale and time zone; the studio link has `rel="noopener noreferrer"` |

## Risks and edge cases

- **Next upgrades** may move the prerendered HTML (an internal path): the build step fails loudly
  (D6.3); fallback C (fetch the JSON) needs only the shell, and A2 remains possible.
- **The root layout becomes static**: the admin must stay dynamic through `app/admin/layout.tsx`
  (`force-dynamic`) and the home page through its own `force-dynamic`; S6.1 checks `/admin` reads D1 per
  request and that `/api/**` routes are unaffected.
- **First paint needs JavaScript** (no server-rendered grid): the JSON is inline, the gallery bundle is
  kept small (budget: ≤ 120 KB gzip for the gallery route, recorded in Verification 3); the cover and the
  header show as soon as React mounts.
- **Cache API only on a custom domain** (index question 3): without it every view reads D1 (still within
  budget: ≈ 2 + sets + 500 rows per view; 5M rows a day ≈ 9,000 uncached views of a 500-photo set; a
  link shared very widely before the domain exists could reach that).
- **Public image URLs survive revocation** (Phase 5 risk): a former visitor who kept URLs can load
  thumbnails and display copies; protected delivery (M2) is the answer; originals are never public.
- **Password guessing**: per-IP (/64) limits plus Turnstile; no global lock, so a distributed attacker can
  keep trying slowly: Phase 5's minimum length (8) and generated passwords make that impractical, and the
  daily notice (D6.10) tells the photographer to change the password.
- **Logs carry URLs**: observability is on, so preview tokens (valid 1 hour) and link-gallery slugs appear
  in the owner's Cloudflare logs (accepted: the owner's own account); `worker.ts` itself never logs query
  strings or slugs.
- **`SETTINGS_ENCRYPTION_KEY`** now protects mail secrets, gallery passwords, access cookies, preview
  tokens and visitor cookies: rotating it ends every gallery cookie and preview link, and every gallery
  password must be set again (deployment.md runbook, Phase 5 docs task).
- **Large sets**: 500 photos per page; JSON ≈ 40 KB per 500 photos before gzip; layout math for 1,000
  items is a few ms in the browser; virtualisation only if Verification 3 shows a problem.
- **Cold start**: with the Durable Object re-exports deleted and OpenNext imported lazily, a gallery
  request on a fresh isolate evaluates only `worker.ts` and the edge module; S6.3 records the cold number
  (tail `cpuTime`, first request after a deploy) against a warm one and the 182 ms measured for Next.
- **The CSP is baked at build** (Phase 4 D4.15): a new media domain needs a rebuild and deploy before
  gallery images load.
- **Cookies on `Path=/`**: `mg_`/`mv` reach every path of the app, the admin included (harmless: they are
  read only by the gallery code; HttpOnly, signed).

## Verification

1. `npm run verify`; `npm run build:worker` (the shell check passes and the three `__gallery` files
   exist).
2. **Local** (`npm run dev` and `npm run preview`): a published link gallery, a password gallery and a
   draft from Phase 5: link → gallery; password → gate, wrong password message, right password → gallery,
   change the password in the manager → gate again; draft → 404, *View as client* → the draft (the
   address bar loses `?preview=`); a deleted gallery → 404; `/__gallery/shell` shows an empty shell. The
   page source contains no `original`, no client email, no password; an `mv` cookie is set. Theme light /
   dark / auto (OS switch) and each accent; the chosen font only is downloaded (network panel).
3. **Devices**: desktop Chrome, Firefox, Safari; an iPhone and an Android phone: grid styles, set chips,
   lightbox swipe, keyboard only on desktop (Tab to a photo, Enter, ←/→, Esc), the screen reader
   announces the dialog and the counter; a 1,000-photo set scrolls smoothly on the phone; the gallery
   bundle size recorded. **Cyrillic in the shell**: a gallery with a Cyrillic title and welcome note
   renders both in the chosen pairing (display font with Cyrillic, Inter for the note), not only on
   `/admin/design`.
4. **Production** (the owner deploys; S6.3 and S6.4): `npm run measure:cpu` on the gallery page and
   `/data` (link and password galleries) and a cold gallery request; record the numbers here; check
   WhatsApp and Facebook previews for a link gallery (image) and a password gallery (no image);
   `X-Robots-Tag` present.
5. With the custom domain: a second view of the same set shows a cache hit (a log field) and reads two
   D1 rows.

## Commits

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 1 | `refactor(web): a static root layout, the admin layout and the static gallery shell` | T6.1 | S6.1 recorded; `npm run preview` serves `/g/x` from the shell |
| 2 | `feat(edge): import-free statements and the edge-graph guard` | T6.2 | S6.2 |
| 3 | `feat(gallery): the gallery page and data from worker.ts` | T6.3 | handler tests; preview serves a real gallery |
| 4 | `feat(gallery): the password gate and preview links` | T6.4 | Verification 2 (access part) |
| 5 | `feat(gallery): the client gallery` | T6.5, T6.7 | after Phase 5 commit 6; Verification 2 (look), 3 (layout) |
| 6 | `feat(gallery): the lightbox` | T6.6 | Verification 3 (lightbox) |
| 7 | `docs: Phase 6 M1 done` | docs | Verification 4 once deployed |

Milestones: **M1** = commits 1–7 (the client can browse: Phase 6's part of the first usable version;
Phase 7 then adds favourites and submit to this app); **M2** (after the first usable version) = T6.8,
T6.9.

## Checklist

- [ ] T6.1 Static root layout, admin layout, static shell, build step, lazy OpenNext (S6.1)
- [ ] T6.2 `@repo/db/statement`, public builders, `importGraph.ts`, guard `edge-graph` (S6.2)
- [ ] T6.3 Gallery handler, injection, access, visitor cookie, headers, cache, `worker.ts`, dev routes
- [ ] T6.4 Gate route (IPv6 /64 keys, HMAC compare, daily notice), preview links, `Turnstile` `siteKey`
- [ ] T6.5 Client app: header, cover, sets, grids, gate, share, deterrent, mobile
- [ ] T6.6 Lightbox
- [ ] T6.7 Lightbox map, photo text shadow, `scrim` button
- [ ] Verification 1–3 (4–5 once deployed with the custom domain)
- [ ] M2: T6.8 protected delivery · T6.9 compare, virtualised grid

## Review log

- **Round 1** (2026-11-16, code and docs check): the access MAC covers the full gallery id; preview links
  open drafts only; dev route handlers 404 outside development; `build:app` for `build:worker`, `preview`
  and `deploy`; the shell copied from `.next/server/app/`; JSON outside React's tree; edge files take
  structural types.
- **Round 2** (2026-11-16, security, operations and budgets, implementability, product, consistency, and
  the build session): one static root layout with a new `app/admin/layout.tsx` (no route-group move);
  404/503 pages copied too and fetched without `.html`; the head marker through `metadata.other`; lazy
  OpenNext import; `routeEdge` in `routes.ts`; `importGraph.ts`; gate order with IPv6 /64 keys, an HMAC
  compare and a daily notice instead of a global lock; HKDF salt and infos; the `mv` visitor cookie;
  attribute escaping and `rev`/`ext` checks; the gallery CSP profile; cursors = the last `sort_key`;
  unknown query parameters ignored; the `lightbox` map owned here with the studio role names; the owner's
  CPU decision moved to the top.
- **Round 3** (2026-11-16, the build session's second pass, a cold-read review, a consistency audit): the
  Durable Object re-exports deleted so the lazy import works; `Turnstile` split (prop-only + `AdminTurnstile`);
  the root layout keeps `viewport`, `/` its own `generateMetadata`, static titles for not-found/error, a
  viewport build check; the first-page cache key `…/first/start`, internal cache `Response`s, the
  gallery join in `publicPhotosStatement`; `ix_photos_set_order (set_id, sort_key)` and a 700-character
  cursor; the `<` text fixed; the D1-error log carries no id; theme/accent/font attributes on the
  `data-gallery-root` wrapper (+ theme on `<html>`); `securityHeaders({ dev, profile: 'gallery', media })`
  keeping Turnstile and `'unsafe-inline'`; `mg_`/`mv` on `Path=/`; `GalleryView.studio` carries locale and
  time zone; the Cyrillic check in the shell; dependencies on Phase 4 commit 4 and Phase 5 commit 6.

## Open questions

For the owner:

1. **The CPU decision — before commit 1**: option B (recommended: static shell + data from `worker.ts`,
   all on the free plan), or Workers Paid ($5/month) with Next rendering the gallery (much of this plan's
   infrastructure then goes)? Independently: take Workers Paid now for the admin side (26–37 ms pages),
   or wait until the tail shows `exceededCpu` (S6.4)?
2. **Protected delivery in M2** (D6.19), after the first usable version: acceptable?
3. **`visitors` moves to Phase 7** (D6.12): Phase 6 only sets the signed `mv` cookie, with no D1 write.
4. **Link previews** (D6.14): cover image only for link-access galleries, none for password galleries?
5. **Right-click deterrent** on selection galleries only (D6.17)?
6. **Turnstile on the password gate** (D6.10, the house rule for public writes): fine for clients? (It is
   usually invisible.)

For the index (`plan_202611_mvp.md`, owned by the build session):

- *To verify → the pages' CPU*: the gallery's answer is option B with gates S6.1–S6.4; the admin side's
  answer is the owner's Workers Paid decision.
- Architecture in brief: `worker.ts` answers `/g/*` (the static shell + data) before Next loads, and
  protected images from M2; one static root layout, the admin's config in `app/admin/layout.tsx`.
- Data model: Phase 6 adds no table; the `visitors` row moves to Phase 7, created from Phase 6's signed
  `mv` cookie (the index's data-model row for Phase 6 changes; p07 gains `visitors`).
- Phase 6 row: "M1: gallery from `worker.ts`, gate, grid, lightbox, mobile, `mv` cookie · M2: protected
  delivery, compare".
- The shared IP-key helper changes to /64 for IPv6 (all existing rate limits).
- Phases table: Phase 6 depends on **4 and 5** (Phase 4 commit 4: the CSP profiles; Phase 5 commit 6:
  `Chip`, `Tabs`, `scrim`); status `placeholder` → `draft`.
- Scope overlap: F1/F2 — Phase 5 owns the links and passwords, Phase 6 the gate.
