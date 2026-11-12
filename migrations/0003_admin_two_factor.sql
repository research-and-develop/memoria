-- 0003_admin_two_factor: two-factor sign-in (docs/plans/202611/plan_202611_p02_admin_totp.md).
--
-- Signing in takes the password, then a code from an authenticator app (TOTP)
-- or a one-time recovery code. The first authenticator is enrolled with a
-- setup code printed by `npm run admin:mfa -- setup`.

-- Password-only sessions end: from now on a session exists only after a
-- second factor. (Rebuilt rather than altered: this migration ships before
-- the first remote D1.)
DROP TABLE admin_sessions;
CREATE TABLE admin_sessions (
  id               TEXT NOT NULL,
  password_version TEXT NOT NULL,
  second_factor    TEXT NOT NULL,
  -- Which app signed in. No foreign key: kept after the app is removed.
  authenticator_id TEXT,
  user_agent       TEXT NOT NULL DEFAULT '',
  -- CF-IPCountry at sign-in, when it is two letters.
  country          TEXT,
  -- "Confirm with a code": sensitive settings need a code entered before this time. NULL after sign-in.
  verified_until   TEXT,
  -- Wrong confirm codes on this session; five end it.
  code_failures    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at       TEXT NOT NULL,
  CONSTRAINT pk_admin_sessions PRIMARY KEY (id),
  CONSTRAINT ck_admin_sessions_id CHECK (length(id) = 64),
  CONSTRAINT ck_admin_sessions_second_factor CHECK (second_factor IN ('authenticator', 'recovery_code')),
  CONSTRAINT ck_admin_sessions_authenticator CHECK ((second_factor = 'authenticator') = (authenticator_id IS NOT NULL)),
  CONSTRAINT ck_admin_sessions_user_agent CHECK (length(user_agent) <= 300),
  CONSTRAINT ck_admin_sessions_country CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]'),
  CONSTRAINT ck_admin_sessions_code_failures CHECK (code_failures BETWEEN 0 AND 5)
);
CREATE INDEX ix_admin_sessions_expires_at ON admin_sessions (expires_at);

-- One row per authenticator app. `secret_enc` is AES-GCM under a key derived
-- from TOTP_ENCRYPTION_KEY, bound to this row's id. `last_step` is the last
-- accepted 30-second step: a code is accepted only for a later one.
CREATE TABLE admin_authenticators (
  id           TEXT NOT NULL,
  label        TEXT NOT NULL,
  secret_enc   TEXT NOT NULL,
  last_step    INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  CONSTRAINT pk_admin_authenticators PRIMARY KEY (id),
  CONSTRAINT ck_admin_authenticators_label CHECK (length(label) BETWEEN 1 AND 60),
  CONSTRAINT ck_admin_authenticators_secret CHECK (secret_enc LIKE 'v1:%'),
  CONSTRAINT ck_admin_authenticators_last_step CHECK (last_step >= 0)
);

-- Single-use recovery codes. `id` is an HMAC (hex) of the normalised code;
-- the code itself is shown once and never stored.
CREATE TABLE admin_recovery_codes (
  id              TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  acknowledged_at TEXT,
  used_at         TEXT,
  CONSTRAINT pk_admin_recovery_codes PRIMARY KEY (id),
  CONSTRAINT ck_admin_recovery_codes_id CHECK (length(id) = 64)
);

-- The setup code that allows enrolling the first authenticator; `id` is its SHA-256 (hex).
CREATE TABLE admin_setup_codes (
  id         TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  CONSTRAINT pk_admin_setup_codes PRIMARY KEY (id),
  CONSTRAINT ck_admin_setup_codes_id CHECK (length(id) = 64)
);

-- The step between the password and the code ('login', 'enroll'), or adding
-- an app from the settings ('add'). Sign-in challenges are found by the
-- SHA-256 of a cookie token; 'add' by a UUID bound to its session.
CREATE TABLE admin_mfa_challenges (
  id                 TEXT NOT NULL,
  kind               TEXT NOT NULL,
  password_version   TEXT NOT NULL,
  session_id         TEXT,
  setup_code_id      TEXT,
  pending_secret_enc TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  user_agent         TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at         TEXT NOT NULL,
  CONSTRAINT pk_admin_mfa_challenges PRIMARY KEY (id),
  CONSTRAINT ck_admin_mfa_challenges_kind CHECK (kind IN ('login', 'enroll', 'add')),
  CONSTRAINT ck_admin_mfa_challenges_session CHECK ((kind = 'add') = (session_id IS NOT NULL)),
  CONSTRAINT ck_admin_mfa_challenges_setup CHECK (kind = 'enroll' OR setup_code_id IS NULL),
  CONSTRAINT ck_admin_mfa_challenges_secret CHECK (CASE kind
    WHEN 'login' THEN pending_secret_enc IS NULL
    WHEN 'add' THEN pending_secret_enc IS NOT NULL
    ELSE (setup_code_id IS NULL) = (pending_secret_enc IS NULL) END),
  CONSTRAINT ck_admin_mfa_challenges_attempts CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT ck_admin_mfa_challenges_user_agent CHECK (length(user_agent) <= 300)
);
CREATE INDEX ix_admin_mfa_challenges_expires_at ON admin_mfa_challenges (expires_at);
CREATE INDEX ix_admin_mfa_challenges_session_id ON admin_mfa_challenges (session_id);
