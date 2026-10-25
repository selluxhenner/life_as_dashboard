-- Ops reports from the agent box (Hermes). The box gets its own device token with scope 'ops': it may post reports
-- and nothing else, so a compromised agent box cannot read mails, calendar or Slack. Every other device keeps 'full'.
ALTER TABLE devices ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';

-- One row per job run on the agent box (morning digest, site check …). findings and metrics are JSON.
CREATE TABLE ops_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL DEFAULT 1,
  source     TEXT NOT NULL,                -- device id of the reporting token
  job        TEXT NOT NULL,                -- e.g. morning-digest
  status     TEXT NOT NULL,                -- ok | warn | fail
  summary    TEXT NOT NULL,                -- first line of the report, e.g. "🔴 3 problems"
  findings   TEXT NOT NULL DEFAULT '[]',   -- [{level, text}]
  metrics    TEXT NOT NULL DEFAULT '{}',   -- {"disk_pct": 81, …}
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ops_reports_job ON ops_reports (job, created_at);
