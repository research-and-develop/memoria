-- 0001_init: site-wide settings and the audit log.
--
-- D1 is SQLite. House conventions (AGENTS.md → Data rules; guard:
-- scripts/guards/migrations.test.ts):
--   * ids are TEXT uuids generated in the app (crypto.randomUUID()),
--   * timestamps are TEXT, ISO-8601 UTC with milliseconds — the DEFAULT below,
--   * booleans are INTEGER 0/1 with a CHECK, JSON is TEXT with json_valid(),
--   * every constraint, index and trigger is named (pk_/fk_/uq_/ck_/ix_/tr_),
--   * no BEGIN/COMMIT: D1 applies each file atomically and rejects them.
-- Applied by `wrangler d1 migrations apply DB` (local/remote) and by the test
-- harness (packages/db/test-utils.ts). Never edit a migration that has shipped
-- to the remote database: add a new one (`npm run db:migrations:new -- <name>`).

-- One JSON document per key (contact details, SEO defaults, …).
CREATE TABLE site_settings (
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_site_settings PRIMARY KEY (key),
  CONSTRAINT ck_site_settings_key CHECK (key GLOB '[a-z]*' AND length(key) <= 64),
  CONSTRAINT ck_site_settings_value_json CHECK (json_valid(value))
);

-- One row per admin change, written in the SAME batch as the change.
CREATE TABLE audit_log (
  id         TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  summary    TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_audit_log PRIMARY KEY (id),
  CONSTRAINT ck_audit_log_action CHECK (action IN ('create', 'update', 'delete', 'login', 'logout')),
  CONSTRAINT ck_audit_log_details_json CHECK (json_valid(details))
);
CREATE INDEX ix_audit_log_created_at ON audit_log (created_at);
