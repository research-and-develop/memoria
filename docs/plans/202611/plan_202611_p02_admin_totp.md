---
title: "Phase 2: Admin shell and TOTP"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 2: Admin shell and TOTP

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

The studio admin gets its real layout from the mockups, and signing in requires a TOTP code, enrolled from an admin page.

- **Depends on:** Phase 1
- **Unblocks:** Phases 4, 5 (every admin screen sits in this shell)
- **Mockups:** `Main.dc.html` (sidebar, header), `Settings.dc.html` ("Your sign-in")
- **Scope (feature IDs):** A1, A3 (TOTP only), A4

## Draft tasks

- [ ] T2.1 Migration: `admin_mfa` (encrypted secret, enabled_at, last_step), `admin_recovery_codes`; `TOTP_ENCRYPTION_KEY` secret
- [ ] T2.2 TOTP (RFC 6238, `crypto.subtle` HMAC-SHA1), table-driven tests incl. clock drift ±1 step
- [ ] T2.3 Setup page: secret → QR → confirm one code → 8 recovery codes shown once (stored hashed); disable needs password + code; CLI reset script
- [ ] T2.4 Login step 2 (code or recovery code), rate-limited, replay-protected (last accepted step), audit rows
- [ ] T2.5 Admin layout: sidebar navigation, header, search slot, mobile navigation
- [ ] T2.6 Active sessions list with sign-out per session

## Known open questions

- Is TOTP enforced from the first login (setup forced before anything else) or optional until enabled?
- The state between password and code: a short-lived pending-session row or a signed cookie?
- QR generation: a small client-side library, or rendered on the server?

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
