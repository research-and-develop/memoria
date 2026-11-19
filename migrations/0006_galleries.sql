-- Migration number: 0006 	 2026-11-19T19:51:23.461Z
-- Galleries, their sets and photos (plan p05 → Data). Forward-only once it reaches the remote D1.
-- Invariants live here, not in reads: a set belongs to its photo's gallery (composite FK, D5.18), a
-- photo's content hash is unique per gallery until it is deleted (D5.9), the status/published and
-- access/password pairs hold in one statement (D5.19, D5.11). No cascades: the purge jobs delete
-- dependents, then photos, then sets, then the gallery (D5.17).

CREATE TABLE galleries (
  id                 TEXT NOT NULL,
  slug               TEXT NOT NULL,
  title              TEXT NOT NULL,
  shoot_date         TEXT,                              -- YYYY-MM-DD
  client_name        TEXT,
  client_email       TEXT,
  purpose            TEXT NOT NULL,                     -- selection | sharing
  status             TEXT NOT NULL DEFAULT 'draft',     -- draft | published (D5.19)
  access             TEXT NOT NULL,                     -- link | password
  password_sealed    TEXT,                              -- D5.11: sealed, never hashed
  password_version   INTEGER NOT NULL DEFAULT 1,
  delivery           TEXT NOT NULL DEFAULT 'public',    -- public | protected (Phase 6 M2)
  settings           TEXT NOT NULL DEFAULT '{}',        -- D5.10: processing, theme, accent, font, grid, sort, welcome
  cover_photo_id     TEXT,                              -- no FK: read through a join; cleared with its photo
  photo_count        INTEGER NOT NULL DEFAULT 0,        -- D5.13: ready, not hidden
  content_version    INTEGER NOT NULL DEFAULT 1,        -- D5.12: Phase 6's cache key
  published_at       TEXT,
  first_published_at TEXT,
  deleted_at         TEXT,                              -- soft delete; purged 7 days later (D5.17)
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_galleries PRIMARY KEY (id),
  CONSTRAINT uq_galleries_slug UNIQUE (slug),
  CONSTRAINT ck_galleries_slug CHECK (length(slug) BETWEEN 3 AND 60 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-'),
  CONSTRAINT ck_galleries_title CHECK (length(title) BETWEEN 1 AND 120),
  CONSTRAINT ck_galleries_shoot_date CHECK (shoot_date IS NULL OR date(shoot_date) = shoot_date),
  CONSTRAINT ck_galleries_client CHECK ((client_name IS NULL OR length(client_name) BETWEEN 1 AND 80) AND (client_email IS NULL OR length(client_email) BETWEEN 3 AND 254)),
  CONSTRAINT ck_galleries_purpose CHECK (purpose IN ('selection', 'sharing')),
  CONSTRAINT ck_galleries_status CHECK (status IN ('draft', 'published')),
  CONSTRAINT ck_galleries_access CHECK (access IN ('link', 'password')),
  CONSTRAINT ck_galleries_password CHECK ((access = 'password') = (password_sealed IS NOT NULL)),
  CONSTRAINT ck_galleries_delivery CHECK (delivery IN ('public', 'protected')),
  CONSTRAINT ck_galleries_settings CHECK (json_valid(settings) AND json_type(settings) = 'object' AND length(settings) <= 16384),
  CONSTRAINT ck_galleries_published CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT ck_galleries_counts CHECK (photo_count >= 0 AND content_version >= 1 AND password_version >= 1),
  -- Exactly Date#toISOString(): the restore and purge windows compare it as text (D5.17).
  CONSTRAINT ck_galleries_deleted_at CHECK (deleted_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) = deleted_at)
);
-- The galleries list (newest first; the Deleted filter) and housekeeping's purge sweep.
CREATE INDEX ix_galleries_list ON galleries (deleted_at, created_at);

CREATE TABLE photo_sets (
  id          TEXT NOT NULL,
  gallery_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  photo_count INTEGER NOT NULL DEFAULT 0,               -- D5.13: ready, not hidden
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_photo_sets PRIMARY KEY (id),
  CONSTRAINT uq_photo_sets_id_gallery UNIQUE (id, gallery_id),       -- target of fk_photos_set (D5.18)
  CONSTRAINT fk_photo_sets_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id),
  CONSTRAINT ck_photo_sets_name CHECK (length(name) BETWEEN 1 AND 60),
  CONSTRAINT ck_photo_sets_counts CHECK (position >= 0 AND photo_count >= 0)
);
CREATE INDEX ix_photo_sets_gallery_position ON photo_sets (gallery_id, position);

CREATE TABLE photos (
  id             TEXT NOT NULL,
  gallery_id     TEXT NOT NULL,
  set_id         TEXT NOT NULL,
  filename       TEXT NOT NULL,                         -- the photographer's filename (metadata; Phase 8 export)
  name_key       TEXT NOT NULL,                         -- natural-order form of the filename (D5.23)
  taken_key      TEXT NOT NULL,                         -- taken_at or '~' (D5.23)
  sort_key       TEXT NOT NULL,                         -- composed in SQL from the gallery's sort (D5.23)
  content_type   TEXT NOT NULL,                         -- of the original
  original_bytes INTEGER NOT NULL,                      -- Phase 9 ZIP progress
  bytes          INTEGER NOT NULL,                      -- original + derivatives
  width          INTEGER NOT NULL,                      -- oriented pixels of the original
  height         INTEGER NOT NULL,
  taken_at       TEXT,                                  -- EXIF DateTimeOriginal as written (local, no zone)
  sha256         TEXT,                                  -- D5.9; NULL once deleted
  rev            TEXT NOT NULL,                         -- D5.7
  derivative_ext TEXT NOT NULL,                         -- webp | jpg
  display_width  INTEGER NOT NULL,
  display_height INTEGER NOT NULL,
  color          TEXT NOT NULL,                         -- placeholder #RRGGBB
  processing     TEXT NOT NULL,                         -- the profile used (D5.4)
  meta           TEXT NOT NULL DEFAULT '{}',            -- camera, lens, focal, aperture, shutter, iso
  status         TEXT NOT NULL DEFAULT 'uploading',     -- uploading | ready | deleted
  hidden         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT pk_photos PRIMARY KEY (id),
  CONSTRAINT fk_photos_gallery FOREIGN KEY (gallery_id) REFERENCES galleries (id),
  CONSTRAINT fk_photos_set FOREIGN KEY (set_id, gallery_id) REFERENCES photo_sets (id, gallery_id),
  CONSTRAINT uq_photos_gallery_sha256 UNIQUE (gallery_id, sha256),
  CONSTRAINT ck_photos_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_photos_sha256 CHECK ((sha256 IS NULL AND status = 'deleted') OR (sha256 IS NOT NULL AND length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  CONSTRAINT ck_photos_rev CHECK (length(rev) = 8 AND rev NOT GLOB '*[^a-z2-9]*'),
  CONSTRAINT ck_photos_ext CHECK (derivative_ext IN ('webp', 'jpg')),
  CONSTRAINT ck_photos_status CHECK (status IN ('uploading', 'ready', 'deleted')),
  CONSTRAINT ck_photos_hidden CHECK (hidden IN (0, 1)),
  CONSTRAINT ck_photos_filename CHECK (length(filename) BETWEEN 1 AND 255),
  CONSTRAINT ck_photos_keys CHECK (length(name_key) <= 120 AND length(taken_key) BETWEEN 1 AND 19 AND length(sort_key) <= 200),
  -- #RRGGBB. (A GLOB of six classes is too long for D1: "LIKE or GLOB pattern too complex".)
  CONSTRAINT ck_photos_color CHECK (length(color) = 7 AND substr(color, 1, 1) = '#' AND substr(color, 2) NOT GLOB '*[^0-9A-Fa-f]*'),
  CONSTRAINT ck_photos_json CHECK (json_valid(meta) AND length(meta) <= 2048 AND json_valid(processing) AND length(processing) <= 1024),
  CONSTRAINT ck_photos_dims CHECK (width > 0 AND height > 0 AND display_width > 0 AND display_height > 0 AND bytes > 0 AND original_bytes > 0),
  -- Exactly Date#toISOString(): the stale-upload claim compares it as text (D5.17).
  CONSTRAINT ck_photos_updated_at CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at)
);
-- One order index for both lists (the client page and the manager), in either sort (D5.23).
CREATE INDEX ix_photos_set_order ON photos (set_id, sort_key);
-- Only uploading and deleted rows: the purge's claim and reads repeat this predicate (D5.17).
CREATE INDEX ix_photos_purge ON photos (updated_at) WHERE status IN ('uploading', 'deleted');

-- Left for this phase by plan p03: cancel or find a gallery's jobs by `ref` (gallery.purge, D5.17).
CREATE INDEX ix_jobs_ref ON jobs (ref);
