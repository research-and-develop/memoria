-- Background jobs (plan p03, D3.1, D3.5): written by the app in the same batch as the change that
-- causes them, run by the relay Worker (nudge + a cron every minute). A job is claimed with a lease
-- (status = 'running', run_after = the lease end) and every finishing write is fenced by
-- `status = 'running' AND attempts = ?`, so a stale runner never overwrites a newer attempt.
CREATE TABLE jobs (
  id           TEXT NOT NULL,                     -- crypto.randomUUID(); an email's Message-ID too
  kind         TEXT NOT NULL,                     -- 'housekeeping', 'email', later phases' kinds
  payload      TEXT NOT NULL DEFAULT '{}',        -- JSON with a version `v`, parsed by the kind
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | running | done | failed
  priority     INTEGER NOT NULL DEFAULT 0,        -- 0 = someone is waiting, 1 = bulk (reminders)
  attempts     INTEGER NOT NULL DEFAULT 0,        -- incremented at claim
  max_attempts INTEGER NOT NULL,
  run_after    TEXT NOT NULL,                     -- pending: when due; running: when the lease ends
  ref          TEXT,                              -- what it is about ('gallery:<id>'): cancel or purge by it
  dedupe_key   TEXT,                              -- system jobs only: one row per key while it exists
  last_error   TEXT,                              -- a code, or masked provider text (admin only)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at  TEXT,
  CONSTRAINT pk_jobs PRIMARY KEY (id),
  CONSTRAINT uq_jobs_dedupe_key UNIQUE (dedupe_key),
  CONSTRAINT ck_jobs_kind CHECK (length(kind) BETWEEN 1 AND 40 AND kind NOT GLOB '*[^a-z0-9_.]*'),
  CONSTRAINT ck_jobs_payload CHECK (json_valid(payload) AND length(payload) <= 16384),
  CONSTRAINT ck_jobs_status CHECK (status IN ('pending', 'running', 'done', 'failed')),
  CONSTRAINT ck_jobs_priority CHECK (priority IN (0, 1)),
  CONSTRAINT ck_jobs_max_attempts CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT ck_jobs_attempts CHECK (attempts BETWEEN 0 AND max_attempts),
  -- Exactly Date#toISOString() (ms, Z) and a real date, so comparing text compares time.
  -- (A GLOB of the shape is too long for D1: "LIKE or GLOB pattern too complex".)
  CONSTRAINT ck_jobs_run_after CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', run_after) = run_after),
  CONSTRAINT ck_jobs_finished CHECK ((status IN ('done', 'failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT ck_jobs_ref CHECK (ref IS NULL OR length(ref) BETWEEN 1 AND 100),
  CONSTRAINT ck_jobs_dedupe_key CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT ck_jobs_last_error CHECK (last_error IS NULL OR length(last_error) <= 500)
);

-- The claim: due pending jobs by priority, then run_after; also the expired-lease sweep.
CREATE INDEX ix_jobs_due ON jobs (status, priority, run_after);
-- Recent emails (Settings → Emails, Phase 3 commit 4).
CREATE INDEX ix_jobs_kind_created_at ON jobs (kind, created_at);
-- Housekeeping prunes finished jobs by age.
CREATE INDEX ix_jobs_finished_at ON jobs (finished_at);
