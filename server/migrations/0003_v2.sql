-- Agentic OS v2. Single user today; user_id columns (default 1) keep the door open for more later.

CREATE TABLE settings (
  user_id    INTEGER NOT NULL DEFAULT 1,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,                -- JSON
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL DEFAULT 1,
  name         TEXT NOT NULL,
  platform     TEXT,
  token_hash   TEXT NOT NULL UNIQUE,       -- sha256 of the device token
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked      INTEGER NOT NULL DEFAULT 0
);

-- Google accounts, Slack workspace, ICS feeds. Secrets are AES-GCM encrypted.
CREATE TABLE connections (
  id                TEXT PRIMARY KEY,
  user_id           INTEGER NOT NULL DEFAULT 1,
  provider          TEXT NOT NULL CHECK (provider IN ('google', 'slack', 'ics')),
  account           TEXT,
  label             TEXT,
  color             TEXT,
  features          TEXT NOT NULL DEFAULT '[]',   -- JSON: ["calendar","gmail"]
  secret_enc        TEXT,                          -- refresh token / user token / ics url
  access_token_enc  TEXT,
  access_expires    INTEGER,
  config            TEXT NOT NULL DEFAULT '{}',    -- JSON
  status            TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'reauth', 'error')),
  last_error        TEXT,
  last_sync_at      INTEGER,
  created_at        INTEGER NOT NULL
);

CREATE TABLE job_runs (
  job         TEXT NOT NULL,
  slot        TEXT NOT NULL,
  status      TEXT NOT NULL,              -- running | done | error | skipped
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  info        TEXT,
  PRIMARY KEY (job, slot)
);

CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  feature       TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_usage_at ON ai_usage (at);

CREATE TABLE calendar_events (
  id            TEXT PRIMARY KEY,           -- connection:eventId
  connection_id TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('lesson', 'meeting', 'event')),
  calendar      TEXT,
  account       TEXT,
  color         TEXT,
  title         TEXT NOT NULL,
  start         TEXT NOT NULL,              -- ISO datetime, or YYYY-MM-DD for all-day
  end           TEXT NOT NULL,
  all_day       INTEGER NOT NULL DEFAULT 0,
  location      TEXT,
  link          TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_cal_start ON calendar_events (start);

CREATE TABLE emails (
  id            TEXT PRIMARY KEY,           -- connection:messageId
  connection_id TEXT NOT NULL,
  account       TEXT NOT NULL,
  thread_id     TEXT,
  from_name     TEXT,
  from_addr     TEXT,
  subject       TEXT,
  snippet       TEXT,
  received_at   INTEGER NOT NULL,
  unread        INTEGER NOT NULL DEFAULT 0,
  labels        TEXT,
  ai_category   TEXT,
  ai_priority   TEXT,
  ai_summary    TEXT
);
CREATE INDEX idx_emails_received ON emails (received_at);

CREATE TABLE slack_messages (
  id           TEXT PRIMARY KEY,            -- channel:ts
  kind         TEXT NOT NULL CHECK (kind IN ('channel', 'dm', 'mention')),
  channel_id   TEXT NOT NULL,
  channel_name TEXT,
  user_id      TEXT,
  user_name    TEXT,
  avatar       TEXT,
  text         TEXT,
  ts           INTEGER NOT NULL,            -- ms
  permalink    TEXT
);
CREATE INDEX idx_slack_kind_ts ON slack_messages (kind, ts);

CREATE TABLE slack_users (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  avatar     TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE briefings (
  date       TEXT PRIMARY KEY,              -- Berlin local date
  created_at INTEGER NOT NULL,
  model      TEXT,
  headline   TEXT NOT NULL,
  sections   TEXT NOT NULL,                 -- JSON
  focus      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL DEFAULT 1,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'agent',
  created_at INTEGER NOT NULL
);

CREATE TABLE feeds (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('news', 'ai')),
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  region_hint   TEXT,
  vendor        TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  etag          TEXT,
  last_modified TEXT,
  last_fetch_at INTEGER,
  last_error    TEXT
);

CREATE TABLE news_items (
  id           TEXT PRIMARY KEY,            -- hash of url
  feed_id      TEXT NOT NULL,
  source       TEXT,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  published_at INTEGER NOT NULL,
  region       TEXT,
  country      TEXT,
  country_n3   TEXT,
  significance INTEGER,
  cluster      TEXT,
  headline     TEXT,
  breaking     INTEGER NOT NULL DEFAULT 0,
  scored       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_news_pub ON news_items (published_at);
CREATE INDEX idx_news_scored ON news_items (scored);

CREATE TABLE news_digests (
  slot       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  regions    TEXT NOT NULL,                 -- JSON {region:[story]}
  top        TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE ai_updates (
  id           TEXT PRIMARY KEY,
  feed_id      TEXT NOT NULL,
  vendor       TEXT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  kind         TEXT,
  importance   INTEGER,
  summary      TEXT,
  classified   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_updates_pub ON ai_updates (published_at);

CREATE TABLE ai_daily (
  date        TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  summary_md  TEXT NOT NULL,
  best        TEXT NOT NULL DEFAULT '{}',
  leaderboard TEXT
);

CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  user_id          INTEGER NOT NULL DEFAULT 1,
  data             TEXT NOT NULL,           -- full job JSON as the app stores it
  updated_at       INTEGER NOT NULL,
  deleted          INTEGER NOT NULL DEFAULT 0,
  rev              INTEGER NOT NULL
);
CREATE INDEX idx_jobs_rev ON jobs (rev);

CREATE TABLE agent_runs (
  id          TEXT PRIMARY KEY,
  trigger     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL DEFAULT 'running',
  summary     TEXT
);

CREATE TABLE agent_actions (
  id          TEXT PRIMARY KEY,
  run_id      TEXT,
  tool        TEXT NOT NULL,
  input       TEXT NOT NULL,
  risk        TEXT NOT NULL CHECK (risk IN ('read', 'internal', 'outward')),
  status      TEXT NOT NULL CHECK (status IN ('done', 'pending', 'approved', 'rejected', 'executed', 'failed')),
  summary     TEXT,
  result      TEXT,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX idx_actions_status ON agent_actions (status);

CREATE TABLE agent_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,            -- JSON content blocks
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_agent_msgs_conv ON agent_messages (conversation_id, id);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('webpush', 'fcm', 'ntfy')),
  endpoint   TEXT NOT NULL,
  keys       TEXT,
  device     TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE calls (
  id           TEXT PRIMARY KEY,
  twilio_sid   TEXT,
  purpose      TEXT,
  questions    TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL,
  started_at   INTEGER,
  ended_at     INTEGER,
  duration_s   INTEGER,
  cost_eur     REAL,
  transcript   TEXT NOT NULL DEFAULT '[]',
  outcome      TEXT,
  created_at   INTEGER NOT NULL
);

-- Move the single Google Calendar connection into the multi-account table (encrypted on first use).
INSERT INTO connections (id, provider, account, label, features, secret_enc, config, status, created_at)
  SELECT 'google-legacy', 'google', account, account, '["calendar"]', 'plain:' || refresh_token, '{"pushTarget":true}', 'ok', connected_at
  FROM gcal_auth;
DROP TABLE gcal_auth;
