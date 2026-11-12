---
title: "Phase 8: Review and delivery"
type: plan
status: placeholder
updated: 2026-11-12
related: [plan_202611_mvp.md]
---

# Phase 8: Review and delivery

> **Placeholder.** Outline only, carried over from the [index](plan_202611_mvp.md). The detailed plan
> is written and reviewed when this phase is next in build order.

## Goal

The photographer reviews a submitted selection, exports filenames to Lightroom/Capture One, works the retouch list and delivers the edits.

- **Depends on:** Phase 7
- **Unblocks:** —
- **Mockups:** `ProofReview.dc.html`
- **Scope (feature IDs):** I1, I2, I4–I7

## Draft tasks

- [ ] T8.1 Selections screen: lists, filters (notes, retouch)
- [ ] T8.2 Filename export: space/comma/newline, strip extensions, copy, .txt, .csv with notes
- [ ] T8.3 Retouch checklist, reopen, message the client
- [ ] T8.4 Deliver: upload edits → replace proofs → one email to the client; unlock "after selection" downloads

## Known open questions

- "Message the client": an email through the relay, or a thread in the gallery?

## From Phase 2

- The sidebar lists *Selections* as *Soon* (`components/admin/nav.ts`, `soonPhase: 8`): the commit that adds
  its page drops the flag (`nav.test.ts`). Pages start with `PageHeader`.

## To be written

Design (modules, routes, migration SQL, query modules, components) · edge cases and limits (CPU,
requests, rows, security) · tests (pure helpers, routes, guards) · final checklist · definition of done.
