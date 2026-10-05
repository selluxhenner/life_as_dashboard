-- Everything else the app keeps (plan blocks per day, habits, captures, goals, routines, reflections…)
-- synced as small JSON documents. One row per key, last write wins on updated_at, deletes are tombstones.
CREATE TABLE docs (
  user_id    INTEGER NOT NULL DEFAULT 1,
  key        TEXT NOT NULL,                -- e.g. "dayplan:2026-10-05", "habit:abc123", "settings"
  value      TEXT,                         -- JSON, NULL when deleted
  updated_at INTEGER NOT NULL,             -- ms, set by the device that made the change
  deleted    INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX docs_rev ON docs (rev);
