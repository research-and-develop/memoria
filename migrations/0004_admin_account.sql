-- 0004_admin_account: the sign-in account in the database (docs/plans/202611/plan_202611_p02b_settings_db.md).
--
-- One row (id = 1). While it is absent, ADMIN_EMAIL / ADMIN_PASSWORD_HASH from
-- the environment are used (development and a first install, D2b.2); once it
-- exists it wins. `set_by` says who chose the password: the photographer in
-- the studio, the developer with `npm run admin:mfa -- password`, or the env
-- account carried over on the first save of the email.
CREATE TABLE admin_account (
  id            INTEGER NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  set_by        TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_admin_account PRIMARY KEY (id),
  CONSTRAINT ck_admin_account_id CHECK (id = 1),
  CONSTRAINT ck_admin_account_email CHECK (length(email) BETWEEN 6 AND 254 AND email = lower(email) AND email LIKE '%_@_%._%'),
  CONSTRAINT ck_admin_account_password_hash CHECK (password_hash LIKE 'pbkdf2-sha256$%' AND length(password_hash) <= 200),
  CONSTRAINT ck_admin_account_set_by CHECK (set_by IN ('studio', 'cli', 'env'))
);
