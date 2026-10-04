-- Notifications the server raised (briefing ready, breaking news, approvals, call summaries).
-- Desktop and app poll this; ntfy pushes to the phone when NTFY_TOPIC is set.
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  url        TEXT,
  priority   INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL
);
