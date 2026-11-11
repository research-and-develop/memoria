---
title: Wiki conventions
type: reference
updated: 2026-11-09
---

# Wiki conventions

Durable planning and review artifacts are **committed** here, never left in a gitignored
`tmp/`. Three kinds:

| Kind | Path | Lifecycle |
| --- | --- | --- |
| Plan | `plans/YYYYMM/plan_YYYYMM_<topic>.md` | `placeholder` (outline only) → `draft` (detailed, under review) → `ready` (reviewed, can be coded) → `in-progress` → `done` / `abandoned`; tasks tracked inline |
| Audit | `audits/YYYYMM/audit_YYYYMMDD_<topic>.md` | point-in-time; findings carry a resolution (`open` / `fixed <sha>` / `wontfix: why`) |
| Reference | `<topic>.md` | evergreen: "how it works now", never a changelog |

## Frontmatter

```yaml
---
title: Gallery upload
type: plan            # plan | audit | reference
status: in-progress   # plans only
updated: 2026-11-09
related: [architecture.md]
---
```

## Rules

- A plan **links** to `AGENTS.md` for the ground rules rather than restating them.
- A plan's tasks are a checklist (`- [ ] T1 …`) so progress is visible in the diff.
- An audit ranks findings by severity (critical / high / medium / low) with a file:line anchor and
  a concrete failure scenario for each.
- A reference doc describes the current behaviour. When the code changes, update the doc in the same
  commit.
- Add every new doc to [`README.md`](README.md).
