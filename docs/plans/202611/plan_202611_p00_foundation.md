---
title: "Phase 0: Foundation"
type: plan
status: ready
updated: 2026-11-11
related: [plan_202611_mvp.md, ../../design/HANDOFF.md, ../../../AGENTS.md, ../../deployment.md]
---

# Phase 0: Foundation

## Goal

Turn the generic boilerplate into an empty Memoria app that every later phase builds on: the name
everywhere, the contact example gone, the **studio** design system (tokens, Inter, primitives) in
place, CI and backups running on this repo. No product screen is built here.

**Not in this phase** (moved to where their first consumer is, so real screens drive the decisions):

- **Phase 4 (studio settings, branding preview):** the client-gallery theming system: the palette
  module, gallery CSS variables (light/dark/auto), accent helpers, the gallery display fonts, the
  `display-*` and `eyebrow-lg` sizes.
- **Phase 5:** `scrim` overlays and the `Chip` primitive.
- **Phase 6:** lightbox colours, `display-cover`, the photo text shadow.
- **Phase 7:** `Progress`.
- **The first phase that needs them:** Tabs and Avatar.

**Done when:**

- Every commit passed its gate (Commits). The commits touching config, the build or the Tailwind
  preset also passed `npm run build:worker`; those touching bindings or the Worker entry also booted in
  `npm run preview`.
- The grep gate (T0.9) is empty.
- `/admin/design` (behind the admin login) shows every studio token, type style and primitive and
  reads correctly at 360 px and 1440 px.
- GitHub Actions runs on a push to `master`; `backup.yml` exists and is dormant until a remote D1
  exists.

- **Depends on:** nothing. **Unblocks:** Phase 1 and through it everything else.
- **Mockups:** the studio screens (`Main`, `NewGallery`, `GalleryEditor`, `ProofReview`, `Settings`),
  for tokens only.

## Starting point (verified 2026-11-11)

- `npm ci` and `npm run verify` pass on the untouched boilerplate (35 files, 280 tests);
  `npm run build:worker` succeeds on Windows.
- Node 24.18, npm 11.18. npm warns that `esbuild`'s and `workerd`'s install scripts are not in
  `allowScripts`. Their scripts only validate binaries the optional dependencies already provide.
  Approving the bare names writes `"allowScripts": { "esbuild": true, "workerd": true }` to the root
  `package.json` (confirmed).
- `npm audit`: 8 advisories. `npm audit fix` (dry run) changes 53 packages, among them
  wrangler 4.151.3 → 4.160.1, miniflare → 5.20261110.1-beta (runs the D1 test harness), workerd,
  **next 16.4.2 → 16.4.6**, @opennextjs/cloudflare 1.20.13 → 1.20.16, @opennextjs/aws → 4.1.15, undici
  and ~30 `@aws-sdk`/`@smithy` packages. About 5 remain afterwards, all in OpenNext's build-time chain
  (`glob`, `minimatch`, `@node-minify/core` and the two OpenNext packages). npm's only "fix" for them is
  a downgrade to `@opennextjs/cloudflare@0.3.0`, never acceptable. `compatibility_date` 2026-10-15
  stays valid.
- No remote D1 exists (`database_id` all zeros): **no migration has shipped**.
- `.github/workflows/ci.yml` triggers pushes on `main`; the branch is `master`.
- `.gitlab-ci.yml` holds the **only scheduled D1 backup**, documented in `docs/deployment.md`.
- `robots.ts` disallows `/admin` and `/api/`. `X-Robots-Tag` is set only for `/admin` in
  `next.config.mjs`. `/healthz` is answered by `worker.ts` before Next, so it never gets Next's headers.
- The session cookie is `__Host-app_admin` / `app_admin` (`lib/auth/session.ts:26`); the logger's
  default name is `app` (`packages/logger/index.ts`).
- Placeholder tokens (blue brand, yellow accent, marketing type scale) are used by every primitive
  and by `primitives.test.tsx`, `cn.test.ts`, `colorContrast.test.ts`. `Lead` is used by `error.tsx`,
  `not-found.tsx` and `page.tsx`; `LogoutButton` uses `variant="outline"`.

## Decisions made in this plan

| # | Decision | Why |
| --- | --- | --- |
| D0.1 | Keep the internal scope `@repo/*`. Rename what carries the product name, including the session cookie (`memoria_admin`) and the logger name. | The scope is invisible; cookies and logs are not. No users yet, so nobody is logged out. |
| D0.2 | Delete migration `0003_contact_messages.sql`; neutralise the example comments in `0001`/`0002`. | Never applied remotely. Local databases are reset (T0.11). |
| D0.3 | Migrations become **forward-only from the first `db:migrate:remote`**; until then an unshipped migration may be edited. | AGENTS.md's rule with a clear trigger; early tables can still be corrected before the first deploy. |
| D0.4 | Nothing is indexed: `X-Robots-Tag: noindex, nofollow` on every Next response and every `worker.ts` response. `robots.txt` keeps disallowing only `/admin` and `/api/`. | A blanket `Disallow: /` would block link-preview bots for shared gallery links (Phase 6) and hide the `noindex` header from crawlers. |
| D0.5 | `/` renders a minimal neutral page (product name only). `/admin` becomes an empty dashboard placeholder until Phase 11. | Nothing public yet; the inbox is gone. |
| D0.6 | Two filled buttons, both from the mockups: `primary` = accent fill (Publish, Submit, Deliver); `dark` = ink fill ("New gallery", "Back up now"). | Both recur. |
| D0.7 | The design's control borders (`#C9CAC4` 1.65:1, `#DADAD5` 1.40:1) are below WCAG 1.4.11's 3:1. **Accepted**: fields always have a visible label above, a white fill and a strong focus ring. | The tokens are fixed by the design. |
| D0.8 | Fonts through `next/font/google` (self-hosted at build). If CI's network to Google Fonts proves flaky, switch to `next/font/local`. | Simplest; GitHub runners have network. |
| D0.9 | `/admin/design` lives for the life of the project, split into files under 700 lines. | Visual check for every phase that touches tokens or primitives. |
| D0.10 | GitHub Actions is the only CI. The backup moves to `backup.yml` and its artifact is **encrypted** (works whether the repo is public or private). No PR preview job; preview versions are a manual `wrangler versions upload`. | One CI, no lost backups, no data exposure through artifacts. |

## Workstreams

### A. Dependencies and CI

- **T0.1** `npm audit fix` (no `--force`). Gate: `npm run verify`, `npm run build:worker`,
  `npm run preview` (`/healthz` answers, `/admin/login` renders). If the D1 harness or the build
  breaks, revert the lockfile and record why. Confirm `.open-next/worker.js` contains none of
  `minimatch`, `node-minify`, then record the remaining advisories as accepted (build-time only) in
  `docs/deployment.md` → Dependencies.
- **T0.2** `npm install-scripts approve esbuild workerd --no-allow-scripts-pin`;
  `npm ci 2>&1 | grep -c allow-scripts` → `0`.
- **T0.3** `.github/workflows/ci.yml`:
  - `on.push.branches: [master]` (pull requests keep running for every branch);
  - `permissions: contents: read`;
  - `concurrency.cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}`;
  - an informational step `npm audit --omit=dev --audit-level=high || true` after `npm ci`;
  - a header comment describing this file only.
- **T0.4** `.github/workflows/backup.yml`:
  - `on: schedule: cron '0 3 * * *'` + `workflow_dispatch`; `permissions: contents: read`.
  - Job condition: `if: vars.D1_BACKUP_ENABLED == 'true'` (a repository variable set after the first
    remote migration), so the workflow is skipped until then.
  - Steps:
    1. `actions/checkout@v4`.
    2. `actions/setup-node@v4` (`node-version-file: .nvmrc`, `cache: npm`).
    3. `npm ci --no-audit --no-fund`.
    4. In `apps/web`: `npx wrangler d1 export DB --remote --output=d1.sql`.
    5. `gzip -9 d1.sql`.
    6. `gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase "$D1_BACKUP_PASSPHRASE" d1.sql.gz`.
    7. `actions/upload-artifact@v4` with `name: d1-${{ github.run_id }}`, `path: apps/web/d1.sql.gz.gpg`,
       `retention-days: 90`.
  - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (as for deploy) and the new
    `D1_BACKUP_PASSPHRASE`.
  - Restore (documented in `deployment.md`): download the artifact, `gpg -d`, `gunzip`, then
    `wrangler d1 execute … --file`.
- **T0.5** Delete `.gitlab-ci.yml` and every reference to it: `AGENTS.md` (Commands → CI),
  `README.md`, `docs/deployment.md` (front-matter `related`, CI section, Backups section → `backup.yml`).
  `deployment.md` states that the CI deploy job works only after the first manual deploy has created the
  D1 and its id is in `wrangler.jsonc`.

### B. Rename to Memoria

- **T0.6**

  | File | Change |
  | --- | --- |
  | `package.json` | `"name": "memoria"`, then `npm install` so the lockfile's root name follows |
  | `apps/web/wrangler.jsonc` | `name`, `services[0].service`, `database_name` → `memoria`; `APP_NAME` → `Memoria`; RENAME comments removed |
  | `apps/web/cloudflare-env.d.ts` | `npm run cf-typegen` **after** the wrangler edit (guard `wrangler-config` checks freshness; a large diff is expected after T0.1's wrangler bump) |
  | `scripts/measure-cpu.mjs` | `WORKER = 'memoria'`, usage comment |
  | `apps/web/src/lib/config/appConfig.ts` | fallback `'Memoria'` |
  | `apps/web/src/lib/auth/session.ts` | cookie `__Host-memoria_admin` / `memoria_admin` (tests follow through `sessionCookieName`) |
  | `packages/logger/index.ts` | default logger name `'memoria'` |
  | `AGENTS.md` | title; product description (client galleries for one photographer; one Worker today, a relay Worker planned) |
  | `README.md` | rewritten for Memoria: what it is, quick start, verify, deploy, link to the plans index; "Make it yours" removed |
  | `docs/architecture.md`, `docs/deployment.md`, `docs/recipes.md` | `my-app` → `memoria`, `my-app-media` → `memoria-media`, `my-app-restore-test` → `memoria-restore-test` |

### C. Remove the contact example, noindex everywhere

- **T0.7** Delete:
  - `migrations/0003_contact_messages.sql`
  - `apps/web/src/app/api/contact/` and `apps/web/src/app/api/admin/messages/` (routes and tests)
  - `apps/web/src/components/contact/` and `apps/web/src/components/admin/MessageActions.tsx`
  - `apps/web/src/lib/contact/` and `apps/web/src/lib/admin/` (`inbox.ts`, `parseInboxQuery*`)
  - `apps/web/src/lib/db/queries/contact_messages/`
  - `apps/web/src/lib/validation/email.ts` (only importer is `parseContactInput`; recoverable from
    `a581b72` when Phase 5 needs it)
- **T0.8** Fix what referenced it, all in the same commit:

  | Where | Change |
  | --- | --- |
  | `scripts/guards/admin-routes-require-admin.test.ts` | Split into `adminRoutes` (every `route.ts` under `api/admin`, exempt included) and `gated` (non-exempt). Assert `adminRoutes.length >= 2`; assert the exempt set is exactly `{login, logout}`; self-test that `EXEMPT` does not match `api/admin/things/route.ts`; drop `gated.length > 0` (Phase 2 adds gated routes). The bad-sample test stays. |
  | `scripts/guards/no-server-imports-in-client.test.ts` | alias anchor → `apps/web/src/components/admin/LoginForm.tsx` |
  | `lib/turnstile/verify.ts`, `components/forms/Turnstile.tsx` | action union → `'login'`; doc comment |
  | `lib/turnstile/verify.test.ts` | `base.action = 'login'`; the wrong-form sample sends action `'other-form'`; the wrong-hostname sample uses `'login'` |
  | `queries/site_settings/site_settings.test.ts`, `packages/db/test-utils.ts` (doc) | sample key `'contact'` → `'branding'` |
  | `queries/audit_log/types.ts` | comment examples |
  | `migrations/0001_init.sql:14`, `0002_admin_auth.sql:22` | example comments → neutral (`studio details`, `login:global`) |
  | `apps/web/src/app/page.tsx` | D0.5: `<Section surface="ground">` with the app name as `<Heading level={1}>`; no form, no links |
  | `apps/web/src/app/admin/(panel)/page.tsx` | D0.5: title "Dashboard" (`Heading level={1}`), one line of muted `Text` ("Nothing here yet."), a link to `/admin/design` |
  | `AGENTS.md` | product description; Where-to-look (`contact/` row); reference modules → `site_settings`, `admin_sessions`; reference route → `app/api/admin/login/route.ts` (public write: same-origin, Turnstile, rate limit); the admin-write house pattern stays as a pattern with no reference file until Phase 2; "change + audit row in one batch" → `lib/auth/session.ts`; log example → `{ event: 'admin_login', … }` |
  | `docs/architecture.md` | diagram, tables (`contact_messages` row), the request-lifecycle line ("honeypot" no longer applies) |
  | `docs/recipes.md` | "Copy `contact_messages/`" → `site_settings/`; inbox and contact references → `session.ts` and the login route |
  | `docs/wiki-conventions.md` | front-matter example title |

- **T0.9** Grep gate (Git Bash, repo root):
  `git grep -nIiE "contact|inbox|my-app|My App|gitlab" -- . ':!package-lock.json' ':!docs/plans' ':!docs/design'`
  returns nothing. It covers tracked files only, so build output and local state are out of scope.
- **T0.10** Noindex (D0.4):
  - `lib/security/headers.mjs` adds `X-Robots-Tag: noindex, nofollow` to the set applied to
    `/:path*`; the two `/admin` header entries in `next.config.mjs` are removed.
  - `worker.ts` sets the header on every `edgeResponse`.
  - `robots.ts`: comment only.
- **T0.11** Local D1 reset (manual; noted in the commit message): stop dev/preview, delete
  `apps/web/.wrangler/state/v3/d1`, `npm run db:migrate:local` (Verification 2).

### D. Studio design tokens (`packages/ui/tailwind-preset.mjs`)

Source: `docs/design/HANDOFF.md` → Design tokens (Studio), cross-checked with the studio mockups' inline
styles (body Inter 14 px / 1.45; most used size 13 px; weights 600 × 174, 650 × 31, 700 × 30).

- **T0.12** Colours, nested groups, so `colorContrast.tokenHex` (splits on the first dash) resolves
  them. Shared values are JS constants in the preset (`danger` = `expired.fg`), so they cannot drift.

  | Group: key | Hex | Use |
  | --- | --- | --- |
  | `ground` | `#F6F6F4` | page background |
  | `white` (Tailwind) | `#FFFFFF` | surfaces |
  | `ink`: DEFAULT, `2`, `muted`, `faint`, `hover` | `#16171A`, `#3A3C41`, `#5D6066`, `#8A8C91`, `#2C2E33` | text. `faint` (3.36:1) is for disabled and decoration only; placeholders use `muted`. `hover` is the dark button's hover. |
  | `line`: DEFAULT, `control`, `input` | `#E4E4E0`, `#DADAD5`, `#C9CAC4` | borders (D0.7) |
  | `wash` | `#EEEEEB` | subtle fill |
  | `accent`: DEFAULT, `ink`, `tint` | `#1F6F5C`, `#17564A`, `#EAF2EF` | pine |
  | `live`, `proofing`, `draft`, `scheduled`, `expired`: `bg`, `fg` | `#E3F1EC`/`#17564A`, `#FCEFD9`/`#8A4B00`, `#EEEEEB`/`#45474C`, `#E4EBF8`/`#2747A0`, `#F7E3E1`/`#9B2C22` | status pills |
  | `alert` | `#B4530A` | count badge text, **on white only** (5.02:1; 4.64 on ground) |
  | `danger`: DEFAULT, `wash` | `#9B2C22`, `#F7E3E1` | destructive actions, errors |

  Removed: `brand`, the yellow `accent`, `page`, `success`, `ink.subtle`, `line.soft`, `danger.strong`.
- **T0.13** Type scale (replaces the whole marketing scale; every key goes into
  `cn.ts` `FONT_SIZE_TOKENS`):

  | Token | px / line-height / tracking | Use |
  | --- | --- | --- |
  | `micro` | 11 / 1.3 | badges, tab counts, avatar initials |
  | `caption` | 12 / 1.4 | meta lines, pills, filenames |
  | `body-sm` | 13 / 1.45 | list rows, labels, secondary text |
  | `body` | 14 / 1.45 | default |
  | `body-lg` | 15 / 1.45 | form fields from `sm` up |
  | `field` | 16 / 1.4 | form fields below `sm` (iOS zooms into inputs under 16 px) |
  | `title-sm` | 16 / 1.35 | card titles |
  | `title` | 17 / 1.35 | settings section titles |
  | `title-lg` | 18 / 1.3 | stat values, screen titles |
  | `heading` | 24 / 1.2 / −0.02em | gallery title (manager) |
  | `heading-lg` | 26 / 1.15 / −0.02em | page greeting |
  | `stat` | 28 / 1.1 / −0.02em | KPI values |
  | `eyebrow` | 12 / 1.4 / 0.08em | uppercase labels |

- **T0.14** Other tokens:
  - `fontFamily`: `sans: ['var(--font-text)', 'system-ui', 'sans-serif']`,
    `mono: ['var(--font-mono)', 'ui-monospace', 'monospace']` (`display` goes; Phase 4 brings it back).
  - `fontWeight.title = '650'`.
  - `borderRadius`: `control` 8 px, `button` 10 px, `card` 12 px, `panel` 14 px (the 9 px `field` and
    28 px `panel` go).
  - `boxShadow.control = '0 1px 2px rgba(0,0,0,0.12)'` (the `card` shadow goes).
  - `ringColor.DEFAULT` → accent-ink.
  - `spacing: {}` stays in `theme.extend` (the `section` token goes).
  - `maxWidth.content`, `maxWidth.prose` stay until Phase 2 sets the shell width.
  - `keyframes` / `animation` (`fade-in`) stay.
  - The preset gets a plugin (`tailwindcss/plugin`) whose only job here is
    `addVariant('coarse', '@media (pointer: coarse)')`.
- **T0.15** `packages/ui/cn.ts` exports `FONT_SIZE_TOKENS` (T0.13), `SPACING_TOKENS = []`,
  `RADIUS_TOKENS = ['control','button','card','panel']`, `FONT_WEIGHT_TOKENS = ['title']`,
  `SHADOW_TOKENS = ['control']`. `extendTailwindMerge` gets:
  - `extend.theme.spacing: SPACING_TOKENS`, `extend.theme.borderRadius: RADIUS_TOKENS`;
  - `extend.classGroups`: `'font-size': [{ text: FONT_SIZE_TOKENS }]`,
    `'font-weight': [{ font: FONT_WEIGHT_TOKENS }]`, `shadow: [{ shadow: SHADOW_TOKENS }]`.

  Without these, tailwind-merge keeps both `rounded-lg rounded-card`, reads `shadow-control` as a
  colour and reads `font-title` as a font family (dropping `font-sans`).
- **T0.16** `apps/web/src/app/globals.css`:
  - `:focus-visible` uses a 2 px `#17564A` outline with `outline-offset: 2px` and
    `box-shadow: 0 0 0 2px #fff`, so it stays visible on any surface.
  - Font fallbacks for `--font-text` and `--font-mono`; `--font-display` goes.
- **T0.17** Root `layout.tsx`: `themeColor` → `#F6F6F4`; `<body className="bg-ground font-sans text-body text-ink antialiased">`.

### E. Fonts

- **T0.18** `apps/web/src/app/fonts.ts`, imported only by the root layout. Both `variable` classes go
  on `<html>`.

  | Font | Options |
  | --- | --- |
  | Inter | `subsets: ['latin']`, weight `variable` (650 usable), `display: 'swap'`, `variable: '--font-text'`, preload (default) |
  | JetBrains Mono | `subsets: ['latin']`, weight `variable`, `display: 'swap'`, `variable: '--font-mono'`, `preload: false` |

  `subsets` controls preloading only. Cyrillic text still renders in Inter through `unicode-range`
  (Inter has Cyrillic); the design page shows a Cyrillic line to confirm. If it falls back instead,
  add `'cyrillic'` to Inter's subsets.

### F. Primitives (`packages/ui`)

- **T0.19** `typography.tsx`:

  | Component | Props (default) | Classes |
  | --- | --- | --- |
  | `Heading` | `level` 1–4 (2) sets the element; `size` (from level); `weight` `title`/`bold` (from size); `tone` `ink`/`ink2`/`muted`/`inverse` (`ink`) | `font-sans text-balance break-words text-{size} font-{weight}` + tone. Level → size: 1 `heading-lg`, 2 `title-lg`, 3 `title`, 4 `title-sm`. Size → weight: `title-*` → `title` (650); `heading`, `heading-lg`, `stat` → `bold` |
  | `Text` | `as` (`span`); `size` `micro`/`caption`/`body-sm`/`body`/`body-lg` (`body`); `tone` (`ink`); `weight` `normal`/`medium`/`semibold`/`title`/`bold` (`normal`) | `font-sans text-{size} font-{weight}` + tone |
  | `Label` | label attributes | `block font-sans text-body-sm font-semibold text-ink` |
  | `Caption` | p attributes | `font-sans text-caption text-ink-muted` |
  | `Eyebrow` | `as` (`p`); `tone` (`muted`) | `font-sans text-eyebrow font-semibold uppercase` + tone |
  | `Mono` | `as` (`span`); `size` `caption`/`body-sm` (`caption`) | `font-mono text-{size} text-ink-2` |

  Tones: `ink` → `text-ink`, `ink2` → `text-ink-2`, `muted` → `text-ink-muted`, `accent` →
  `text-accent`, `accentInk` → `text-accent-ink` (on `accent-tint`), `danger` → `text-danger`,
  `alert` → `text-alert`, `inverse` → `text-white`.

  `Display` and `Lead` are removed; callers use `<Heading level={1}>` and
  `<Text as="p" size="body-lg" tone="muted">`.
- **T0.20** `button.tsx`. Props: `variant` (`primary`), `size` (`md`), `pill`, `loading`, `arrow`
  (kept, with `ButtonArrow`). `size="icon"` requires `aria-label` (a discriminated union in the prop
  type). `buttonClassName` keeps its signature.
  - Base classes: `relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button font-sans font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 ring-offset-white disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none`.

  | Variant | Classes |
  | --- | --- |
  | `primary` | `bg-accent text-white hover:bg-accent-ink` |
  | `dark` | `bg-ink text-white hover:bg-ink-hover` |
  | `secondary` | `border border-line-control bg-white text-ink hover:bg-wash` |
  | `ghost` | `bg-transparent text-ink hover:bg-wash` |
  | `danger` | `bg-danger text-white hover:bg-danger/90` |
  | `link` | `h-auto bg-transparent px-0 text-accent-ink underline-offset-4 hover:underline` |

  | Size | Classes | Coarse-pointer hit area (44 px) |
  | --- | --- | --- |
  | `sm` | `h-9 px-3 text-body-sm` | `coarse:before:absolute coarse:before:inset-x-0 coarse:before:-inset-y-1 coarse:before:content-['']` |
  | `md` | `h-10 px-4 text-body` | same with `coarse:before:-inset-y-0.5` |
  | `lg` | `h-11 px-5 text-body` | — |
  | `xl` | `h-[52px] px-6 text-body-lg` | — |
  | `icon` | `h-10 w-10 p-0` | `coarse:before:-inset-0.5` |

  `pill` adds `rounded-full`. Callers: `outline` → `secondary`, `accent` → `primary`, `inverse` → removed.
- **T0.21** `input.tsx` (same exports and props as today: `Input`, `Textarea`, `Select`, `Checkbox`,
  `FormField`):
  - Shared field classes: `w-full rounded-control border border-line-input bg-white px-3 font-sans text-field text-ink placeholder:text-ink-muted transition-colors sm:text-body-lg focus:border-accent-ink focus:outline-none focus:ring-2 focus:ring-accent-ink/25 disabled:cursor-not-allowed disabled:bg-wash disabled:text-ink-faint aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25 motion-reduce:transition-none`.
  - `Input` and `Select`: `h-11`. `Textarea`: `min-h-[96px] py-2.5`.
  - `Checkbox`: the box is `h-[18px] w-[18px] accent-accent`, inside a label row with `min-h-11`.
  - `FormField` keeps the label above, the error linked through `aria-describedby`, and
    `aria-invalid`; error text is `text-body-sm text-danger`.
- **T0.22** `layout.tsx`:
  - `Container` unchanged.
  - `Section`: `surface` is `white` | `ground` (`white`); classes `relative py-10 lg:py-14` + surface.
  - `Card`: `tone` is `white` | `wash` (`white`). White → `rounded-card border border-line bg-white`,
    wash → `rounded-card bg-wash`.
  - `Pill` replaces `Chip`. Props `tone` (`neutral`), `size` (`md`). Classes:
    `inline-flex items-center rounded-full font-sans font-semibold whitespace-nowrap`; size
    `md` → `px-2.5 py-1 text-caption`, `sm` → `px-2 py-0.5 text-micro`.

    | Tone | Classes |
    | --- | --- |
    | `live` | `bg-live-bg text-live-fg` |
    | `proofing` | `bg-proofing-bg text-proofing-fg` |
    | `draft` | `bg-draft-bg text-draft-fg` |
    | `scheduled` | `bg-scheduled-bg text-scheduled-fg` |
    | `expired` | `bg-expired-bg text-expired-fg` |
    | `neutral` | `bg-wash text-ink-2` |
    | `accent` | `bg-accent-tint text-accent-ink` |
    | `alert` | `bg-white text-alert ring-1 ring-line` |

  - `SectionHeader`, `AccentBar` and `Chip` are removed.
- **T0.23** New primitives, one file each (the file name is the import path through
  `"./*": "./*.tsx"`):

  | File | API | Behaviour |
  | --- | --- | --- |
  | `toggle.tsx` (no hooks, no directive) | `Toggle({ checked, onCheckedChange, label, description?, disabled?, id? })` | `<button type="button" role="switch" aria-checked>` (Space/Enter are native). Track `h-[26px] w-11 rounded-full`: on `bg-accent`, off `bg-line-input`. White thumb 22 px. Wrapped with its visible label in a row of `min-h-11`; clicking the label toggles it; `description` is linked by `aria-describedby`. |
  | `segmented.tsx` (`'use client'`) | `Segmented({ 'aria-label', options: { value, label }[], value, onValueChange, disabled? })` | `role="radiogroup"` on `inline-flex rounded-control bg-wash p-1`. Each option is `role="radio" aria-checked`, `h-8 px-3 rounded-md text-body-sm`. Selected: `bg-white text-ink font-semibold shadow-control`. Others: `text-ink-2`. Roving tabindex (selected 0, others −1); Arrow keys move and select, Home and End go to the ends. Total height 40 px; coarse pointer adds the 44 px hit area. |

- **T0.24** Callers:

  | File | Change |
  | --- | --- |
  | `admin/login/page.tsx` | `surface="lavender"` → `ground` |
  | `components/admin/LoginForm.tsx` | button `primary` (unchanged name); the error alert uses `danger` on `danger-wash` |
  | `components/admin/LogoutButton.tsx` | `outline` → `secondary`, `size="sm"` |
  | `admin/(panel)/layout.tsx` | `bg-brand-wash` → `bg-ground`; header `bg-white border-line` |
  | `error.tsx` | `ground` surface; `Lead` → `Text`; `accent` button → `primary`; the inline link's classes → `buttonClassName({ variant: 'link' })` |
  | `not-found.tsx` | `ground` surface; `Lead` → `Text`; link button → `buttonClassName({ variant: 'primary' })` |
  | `page.tsx`, `admin/(panel)/page.tsx` | T0.8 |

- **T0.25** `/admin/design`: `app/admin/(panel)/design/page.tsx` (server, `metadata.robots` noindex)
  plus section components in the same folder. The interactive demos (Toggle, Segmented, loading
  button) are small `'use client'` components with local state. It shows:
  - colour swatches with token name and hex;
  - the type scale and weights;
  - buttons in every variant and size, with disabled and loading states;
  - fields with an error;
  - pills, toggle, segmented control, card;
  - the focus ring on ground and white;
  - a Cyrillic line in Inter (`Мария и Йонас`).

### G. Docs

- **T0.26** `AGENTS.md` rules:
  - Form fields 16 px below `sm`.
  - Placeholders use `ink-muted`; `ink-faint` is only for disabled and decoration.
  - `alert` only on white.
  - Every custom radius, shadow or weight token goes into `cn.ts` (its tests check it).
  - Touch targets reach 44 px on coarse pointers (`coarse:` variant).
  - Migrations are forward-only from the first remote apply (D0.3).
- **T0.27** `docs/architecture.md`: the planned shape (relay Worker, R2) beside the current diagram,
  marked "planned (Phases 1–3)". `docs/deployment.md`: Dependencies (accepted advisories), Backups
  (`backup.yml`, `D1_BACKUP_ENABLED`, `D1_BACKUP_PASSPHRASE`, restore steps), first deploy is manual.

## Tests

| Test | Change |
| --- | --- |
| `packages/ui/cn.test.ts` | `Object.keys(theme.spacing ?? {})` matches `SPACING_TOKENS`. The keys of `theme.extend.fontWeight`, `borderRadius` and `boxShadow` equal `FONT_WEIGHT_TOKENS`, `RADIUS_TOKENS` and `SHADOW_TOKENS`. Merge cases: `rounded-lg`+`rounded-card` → `rounded-card`; `shadow-md`+`shadow-control` → `shadow-control`; `font-sans`+`font-title` → both; `font-semibold`+`font-title` → `font-title`; each `FONT_SIZE_TOKENS` key beats `text-body`. |
| `packages/ui/colorContrast.test.ts` | Surfaces `white`, `ground`, `wash`, `accent-tint`. ≥ 4.5 for: `ink`, `ink-2`, `ink-muted` on each; `accent` on `white` and `ground`; `accent-ink` on `accent-tint`; white on `accent`, `ink`, `danger`; `alert` on `white`; `danger` on `danger-wash`; each status `fg` on its `bg`. |
| `packages/ui/primitives.test.tsx` | Override samples: `accent` → `primary`, `text-nav` → `text-body-lg`, `text-heading-md` → `text-heading`. The negative check becomes `/(?<![\w-])text-body(?![\w-])/`. The `section` spacing rows are removed. New: `dark` variant; icon button renders its `aria-label`; coarse classes on `sm`/`md`; Toggle (role, `aria-checked`, click on label toggles); Segmented (arrow keys move and select, roving tabindex, Home/End); Pill tones. |
| `apps/web/src/lib/security/headers.test.ts` | `X-Robots-Tag` in the global set |
| `apps/web/src/lib/edge/routes.test.ts` | edge responses carry `X-Robots-Tag` |
| `scripts/guards/admin-routes-require-admin.test.ts` | as T0.8 |
| `lib/turnstile/verify.test.ts`, `site_settings.test.ts` | as T0.8 |

Removed with the feature: the contact route, the admin messages routes, `ContactForm`,
`parseContactInput`, `parseInboxQuery` and `contact_messages` tests. The guards' scan counts stay
above their thresholds; `every-route-wrapped` still finds `login` and `logout`.

## Risks and edge cases

- **Dependency bump (T0.1)** moves Next, OpenNext, wrangler and the miniflare beta under the D1 test
  harness. Own commit, gated by verify, Worker build and preview; easy to revert.
- **Stale local D1.** Wrangler ignores applied-but-deleted migrations, so the old table stays until
  T0.11. Tests are unaffected (fresh in-memory D1 per file).
- **Windows file locks.** Stop dev/preview before deleting `.wrangler/state`.
- **Silent visual regressions.** Names that survive with new values (`text-body`, `text-body-sm`,
  `text-caption`, `text-eyebrow`, `text-heading-lg`, `rounded-panel`) do not fail the build. The design
  page catches them, and a grep for removed names must be empty in `apps/` and `packages/`:
  `brand-`, `accent-wash`, `accent-strong`, `bg-page`, `lavender`, `cream`, `text-nav`, `text-lead`,
  `heading-section`, `heading-xl`, `heading-md`, `heading-sm`, `heading-xs`, `eyebrow-sm`, `eyebrow-xs`,
  `text-label`, `display-`, `font-display`, `ink-subtle`, `line-soft`, `success`, `danger-strong`,
  `rounded-field`, `shadow-card`, `font-extrabold`.
- **Network at build.** `next/font/google` downloads during `next build`; without network the build
  fails loudly (D0.8 fallback).
- **Coarse hit areas** must not overlap: rows of `sm`/`md` buttons keep ≥ 8 px gaps.

## Verification

Git Bash, repo root.

1. `npm ci 2>&1 | grep -c allow-scripts` → `0`; `npm run ts-check`; `npm run test`;
   `npm run build:worker`.
2. Stop dev/preview, reset the local D1 and list the tables:

   ```sh
   rm -rf apps/web/.wrangler/state/v3/d1 && npm run db:migrate:local
   npx wrangler d1 execute DB --local --config apps/web/wrangler.jsonc \
     --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1"
   ```

   The list includes `admin_sessions`, `audit_log`, `rate_limits` and `site_settings`, plus
   wrangler's own tables, and not `contact_messages`.
3. `npm run dev`: log in; open `/admin/design` at 360 px and 1440 px; check every section and the
   Cyrillic line; tab through buttons, fields, toggle and segmented control; focus is visible on
   ground and white.
4. `npm run preview`, then:

   ```sh
   curl -sI http://localhost:8787/healthz | grep -i x-robots        # noindex, nofollow
   curl -sI http://localhost:8787/admin/login | grep -i x-robots    # noindex, nofollow
   curl -s  http://localhost:8787/robots.txt                        # disallows /admin and /api/
   curl -s  http://localhost:8787/admin/login | grep -o 'rel="preload"[^>]*woff2' | wc -l
   ```

   The last one shows one preloaded font file (Inter latin).
5. Push to `master` → the GitHub Actions `check` job is green; `backup.yml` runs are skipped
   (`D1_BACKUP_ENABLED` unset). Tick this after the push (it cannot be known inside the commit).

## Commits

Each commit is green on `npm run ts-check` and `npm run test`, plus the extra gate listed. The
checklist is ticked in the same commit as its tasks.

| # | Commit | Tasks | Extra gate |
| --- | --- | --- | --- |
| 0 | `docs: Memoria MVP plans` | the plans, index and wiki edits made before Phase 0 | — |
| 1 | `chore(deps): non-breaking audit fixes` | T0.1 | `build:worker`, `preview` |
| 2 | `ci: approve install scripts, CI on master, encrypted backups, drop GitLab CI` | T0.2–T0.5 | — |
| 3 | `chore: rename the app to Memoria` | T0.6 | `build:worker`, `preview` |
| 4 | `refactor: remove the contact example; noindex everywhere` | T0.7–T0.11 | `build:worker`, `preview` |
| 5 | `feat(ui): Memoria studio tokens and restyled primitives` | T0.12–T0.17, T0.19–T0.22, T0.24 | `build:worker` |
| 6 | `feat(web): Inter and JetBrains Mono` | T0.18 | `build:worker` |
| 7 | `feat(ui): toggle and segmented control` | T0.23 | — |
| 8 | `feat(web): /admin/design` | T0.25 | `build:worker`, Verification 3 |
| 9 | `docs: foundation rules and runbook` | T0.26–T0.27; status → `done` after Verification 5 | — |

Commit 5 is one commit on purpose: every caller breaks the moment the old tokens go.

## Checklist

- [ ] T0.1 Audit fixes (verify, build:worker, preview); accepted advisories recorded
- [ ] T0.2 Install scripts approved, unpinned
- [ ] T0.3 CI on `master`, permissions, cancel policy, informational audit
- [ ] T0.4 `backup.yml` (encrypted, dormant)
- [ ] T0.5 GitLab CI and every reference removed
- [ ] T0.6 Rename to Memoria (incl. cookie, logger)
- [ ] T0.7 Contact example deleted (incl. `validation/email.ts`)
- [ ] T0.8 Guards, Turnstile, samples, pages, docs fixed
- [ ] T0.9 Grep gate empty
- [ ] T0.10 `X-Robots-Tag` on Next and edge responses
- [ ] T0.11 Local D1 reset
- [ ] T0.12 Studio colours
- [ ] T0.13 Type scale
- [ ] T0.14 Families, weight, radii, shadow, ring, `coarse` variant
- [ ] T0.15 `cn.ts` registrations and exported token lists
- [ ] T0.16 `globals.css`
- [ ] T0.17 Root layout
- [ ] T0.18 Fonts
- [ ] T0.19 Typography
- [ ] T0.20 Button
- [ ] T0.21 Form fields
- [ ] T0.22 Layout primitives, Pill
- [ ] T0.23 Toggle, Segmented
- [ ] T0.24 Callers
- [ ] T0.25 `/admin/design`
- [ ] T0.26 AGENTS.md rules
- [ ] T0.27 architecture.md, deployment.md
- [ ] Verification 1–4
- [ ] Verification 5 (after the push)

## Open questions

None blocking Phase 0. The Cyrillic question (the default gallery display font, Instrument Serif, has
no Cyrillic) moves to Phase 4 with the gallery theming system. The time zone stays a Phase 4 setting
(T4.5).
