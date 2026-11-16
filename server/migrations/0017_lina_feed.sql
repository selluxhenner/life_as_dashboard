-- What reaches Lina: updates from the server's own jobs (agent tasks, Hermes, ops), from Workbench, and from Kevin's
-- other apps (housing, banking …) that post to /api/lina/events. told_at: Lina has mentioned it (get_updates).
CREATE TABLE lina_feed (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,                 -- hermes | workbench | agents | server | news | calendar | an app's name
  kind       TEXT NOT NULL DEFAULT 'update',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'info',  -- info | good | warn | alert
  url        TEXT,
  ref        TEXT,                          -- the same ref again updates the entry instead of adding one
  created_at INTEGER NOT NULL,
  told_at    INTEGER
);
CREATE INDEX idx_lina_feed_created ON lina_feed (created_at);
CREATE UNIQUE INDEX idx_lina_feed_ref ON lina_feed (ref) WHERE ref IS NOT NULL;
