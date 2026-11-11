-- 0002_admin_auth: the single admin's sessions and the shared rate limiter
-- (docs/architecture.md → Admin).

-- One row per signed-in browser. `id` is sha256(token) in hex — the token
-- itself only ever lives in the cookie. `password_version` ties the session to
-- the password it was created under: rotating ADMIN_PASSWORD_HASH logs out
-- every session.
CREATE TABLE admin_sessions (
  id               TEXT NOT NULL,
  password_version TEXT NOT NULL,
  user_agent       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at       TEXT NOT NULL,
  CONSTRAINT pk_admin_sessions PRIMARY KEY (id),
  CONSTRAINT ck_admin_sessions_id CHECK (length(id) = 64),
  CONSTRAINT ck_admin_sessions_user_agent CHECK (length(user_agent) <= 300)
);
CREATE INDEX ix_admin_sessions_expires_at ON admin_sessions (expires_at);

-- Fixed-window counters: `bucket` names what is limited ("login:ip:<hash>",
-- "login:global"), `window_start` the window's start (ISO). Incremented with
-- an upsert, so two concurrent requests can never both pass.
CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT pk_rate_limits PRIMARY KEY (bucket, window_start),
  CONSTRAINT ck_rate_limits_bucket CHECK (length(bucket) BETWEEN 1 AND 120),
  CONSTRAINT ck_rate_limits_count CHECK (count >= 0)
);
CREATE INDEX ix_rate_limits_window_start ON rate_limits (window_start);
