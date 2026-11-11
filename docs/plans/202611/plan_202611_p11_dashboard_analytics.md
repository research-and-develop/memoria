---
title: "Phase 11: Dashboard and analytics"
type: plan
status: placeholder
updated: 2026-11-11
related: [plan_202611_mvp.md]
---

# Phase 11: Dashboard and analytics

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

The studio dashboard shows what needs attention and how galleries are used; per-gallery stats show who viewed and downloaded.

- **Depends on:** Phases 6, 9
- **Unblocks:** —
- **Mockups:** `Main.dc.html`, `GalleryEditor.dc.html` (stats)
- **Scope (feature IDs):** L1–L5, L7

## Draft tasks

- [ ] T11.1 Migration: `gallery_stats_daily`, `photo_stats`; batched view beacon
- [ ] T11.2 Dashboard: KPIs, "Needs your attention", recent galleries with status filter, activity feed, search
- [ ] T11.3 Per-gallery stats and "who viewed and downloaded"
- [ ] T11.4 Relay job: clear IPs older than 30 days

## Known open questions

- Activity feed: derived from existing tables, or an `activity` table written alongside each event?
- Privacy notice text for visitors (IP, device, email).

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
