-- To-dos für LIFE OS. Gelöschte Einträge bleiben als Tombstone (deleted = 1),
-- damit alle Geräte die Löschung beim nächsten Sync mitbekommen.
CREATE TABLE todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  done         INTEGER NOT NULL DEFAULT 0,
  priority     TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('high', 'med', 'low')),
  due          TEXT,                         -- YYYY-MM-DD
  project      TEXT,
  sort         REAL NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'app',  -- app | widget | claude | api
  created_at   INTEGER NOT NULL,             -- ms
  updated_at   INTEGER NOT NULL,             -- ms, Zeit der letzten Bearbeitung (last write wins)
  completed_at INTEGER,
  deleted      INTEGER NOT NULL DEFAULT 0,
  rev          INTEGER NOT NULL              -- Server-Änderungszähler, Basis für inkrementelle Pulls
);
CREATE INDEX idx_todos_rev ON todos (rev);

-- Monoton steigender Zähler: jede Schreib-Transaktion bekommt eine neue rev.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('rev', 0);
