-- Events Lina already looked at in the background (an ops report that wasn't ok, a service that went down), so each
-- one gets at most one look, also across restarts. task_ids: what she proposed (JSON array, empty when nothing).
CREATE TABLE watch_events (
  ref         TEXT PRIMARY KEY,             -- e.g. ops:morning-digest:2026-11-16:fail, svc:life-os:2026-11-16
  kind        TEXT NOT NULL,                -- ops | service
  summary     TEXT NOT NULL,
  run_id      TEXT,                         -- agent_runs id of her look
  task_ids    TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_watch_events_created ON watch_events (created_at);
