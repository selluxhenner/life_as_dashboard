-- Workbench link: each computer's Workbench connects out to this server (scope 'workbench'), posts what it sees and
-- picks up Kevin's answers. One row per paired computer with its newest snapshot.
CREATE TABLE workbench_links (
  device_id   TEXT PRIMARY KEY,              -- dev_… of the workbench-scope token
  user_id     INTEGER NOT NULL DEFAULT 1,
  machine     TEXT,                          -- e.g. kev-pc, from the snapshot
  snapshot    TEXT,                          -- JSON, cleaned (workbench/snapshot.js)
  seen_at     INTEGER,                       -- last contact
  snapshot_at INTEGER,                       -- last snapshot
  created_at  INTEGER NOT NULL
);

-- Kevin's answers to what Workbench offered. Delivered at most once; Workbench checks again that it still offers
-- exactly this (item_key + rev + option) before it runs it.
CREATE TABLE workbench_decisions (
  id          TEXT PRIMARY KEY,              -- wbd_…
  user_id     INTEGER NOT NULL DEFAULT 1,
  device_id   TEXT NOT NULL,                 -- the computer that runs it
  item_key    TEXT NOT NULL,
  rev         TEXT NOT NULL,
  option_id   TEXT NOT NULL,
  title       TEXT NOT NULL,                 -- what Kevin saw, for the log
  label       TEXT NOT NULL,
  text        TEXT,                          -- his words, for options that take an answer
  decided_by  TEXT NOT NULL,                 -- device id, or lina-voice
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | sent | done | failed (expired / unknown are computed)
  message     TEXT,                          -- what Workbench said (text from another machine)
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER,
  finished_at INTEGER,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_workbench_decisions_device ON workbench_decisions (device_id, status, created_at);
CREATE INDEX idx_workbench_decisions_item ON workbench_decisions (item_key, created_at);

-- What Kevin was already told: an ask per key and rev, an event per key.
CREATE TABLE workbench_told (
  ref     TEXT PRIMARY KEY,                  -- item:<key> | event:<key>
  rev     TEXT,
  told_at INTEGER NOT NULL
);
