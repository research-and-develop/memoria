# Docs

The project wiki. Conventions: [wiki-conventions.md](wiki-conventions.md).

## Reference docs

- [architecture.md](architecture.md) — one Worker, packages, configuration, request lifecycle, admin auth
- [deployment.md](deployment.md) — one-time setup, CI/CD, secrets, rollback, backups, logs, CPU
- [recipes.md](recipes.md) — how to add a table, a route, a secret, a binding (R2, email, KV, cron), caching

## Design

- [design/HANDOFF.md](design/HANDOFF.md) — Proofsheet product spec: screens, design tokens, data model, jobs;
  mockups in `design/*.dc.html`

## Plans

- [plans/202611/plan_202611_mvp.md](plans/202611/plan_202611_mvp.md) — Memoria MVP **index**: decisions,
  scope, architecture in brief, phase order — `draft`
  - [p00 Foundation](plans/202611/plan_202611_p00_foundation.md) — `done`
  - [p01 Core and adapters](plans/202611/plan_202611_p01_core_adapters.md) — `done`
  - [p02 Admin shell and TOTP](plans/202611/plan_202611_p02_admin_totp.md) — `done`
  - [p03 Relay Worker and email](plans/202611/plan_202611_p03_relay_email.md) — `placeholder`
  - [p04 Studio settings](plans/202611/plan_202611_p04_studio_settings.md) — `placeholder`
  - [p05 Galleries and upload](plans/202611/plan_202611_p05_galleries_upload.md) — `placeholder`
  - [p06 Client gallery](plans/202611/plan_202611_p06_client_gallery.md) — `placeholder`
  - [p07 Proofing](plans/202611/plan_202611_p07_proofing.md) — `placeholder`
  - [p08 Review and delivery](plans/202611/plan_202611_p08_review_delivery.md) — `placeholder`
  - [p09 Downloads](plans/202611/plan_202611_p09_downloads.md) — `placeholder`
  - [p10 Expiry and lifecycle](plans/202611/plan_202611_p10_expiry.md) — `placeholder`
  - [p11 Dashboard and analytics](plans/202611/plan_202611_p11_dashboard_analytics.md) — `placeholder`

New plans go in `plans/YYYYMM/plan_YYYYMM_<topic>.md`; list each here with its status
(see the plan lifecycle in [wiki-conventions.md](wiki-conventions.md)).

## Audits

_None yet._ New audits go in `audits/YYYYMM/audit_YYYYMMDD_<topic>.md`.
