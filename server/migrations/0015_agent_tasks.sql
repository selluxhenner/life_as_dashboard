-- Agent tasks: work Lina (or Kevin in the app) hands to an agent, and its whole life in one row.
-- target says who runs it (hermes on the agent box, workbench on the PC, the server itself); kind says what it is.
-- A task that needs Kevin's OK points at an ordinary approvals row, so the phone buttons, the Hub and the Telegram
-- relay decide it like any other approval. While status is 'awaiting_approval' the shown status follows that
-- approval (approved → queued, rejected → rejected, expired → expired); the worker then moves it on.
CREATE TABLE agent_tasks (
  id          TEXT PRIMARY KEY,             -- tsk_…
  user_id     INTEGER NOT NULL DEFAULT 1,
  target      TEXT NOT NULL,                -- hermes | workbench | server
  kind        TEXT NOT NULL,                -- server-op | coding | job
  title       TEXT NOT NULL,                -- one line, shown everywhere
  params      TEXT NOT NULL DEFAULT '{}',   -- JSON, shape depends on kind
  reason      TEXT,                         -- why, shown on the approval
  source      TEXT NOT NULL,                -- chat | voice | phone | app | rule
  status      TEXT NOT NULL,                -- awaiting_approval | queued | running | done | failed | cancelled
  approval_id TEXT,                         -- apr_… when it needed Kevin's OK
  worker      TEXT,                         -- device id of the token that started it
  progress    TEXT NOT NULL DEFAULT '[]',   -- JSON [{at, note}], newest last, at most 20
  result      TEXT,                         -- final text from the worker (untrusted)
  links       TEXT NOT NULL DEFAULT '{}',   -- JSON {pr, url, report}
  started_at  INTEGER,
  finished_at INTEGER,
  updated_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_agent_tasks_status ON agent_tasks (target, status, created_at);
CREATE INDEX idx_agent_tasks_approval ON agent_tasks (approval_id);
