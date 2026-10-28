-- Approvals: the agent box (Hermes) asks before it changes anything on the server (restart a container, deploy …).
-- Kevin approves or rejects on the phone, the desktop app or Telegram; the server script on the main box checks the
-- approval here and consumes it, so one yes runs one action once.
CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,             -- apr_…
  user_id     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL,                -- device id of the asking token
  verb        TEXT NOT NULL,                -- e.g. restart-container
  args        TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  reason      TEXT NOT NULL,                -- why the agent wants it, shown to Kevin
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | used (expired is computed)
  decided_by  TEXT,                         -- device id that approved or rejected
  decided_at  INTEGER,
  used_at     INTEGER,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_approvals_status ON approvals (status, created_at);
