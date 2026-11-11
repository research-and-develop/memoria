-- 0003_contact_messages: what visitors send through the contact form — the
-- example feature (POST /api/contact, the admin inbox).
--
-- Personal data: keep only what the form asks for, never log it (log ids), and
-- let the admin delete it.
CREATE TABLE contact_messages (
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_contact_messages PRIMARY KEY (id),
  CONSTRAINT ck_contact_messages_name CHECK (length(name) BETWEEN 1 AND 100),
  CONSTRAINT ck_contact_messages_email CHECK (length(email) BETWEEN 3 AND 254),
  CONSTRAINT ck_contact_messages_message CHECK (length(message) BETWEEN 1 AND 2000),
  CONSTRAINT ck_contact_messages_is_read CHECK (is_read IN (0, 1))
);
-- The inbox lists newest first, bounded (LIMIT/OFFSET).
CREATE INDEX ix_contact_messages_created_at ON contact_messages (created_at);
