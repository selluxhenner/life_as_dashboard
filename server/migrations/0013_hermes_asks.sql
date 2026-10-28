-- Questions Lina passes to Hermes ("ask Hermes why the sites are down"). Hermes has no inbound API: it polls the open
-- ones with its ops token and posts the answer back; Kevin gets a push and Lina can read it.
CREATE TABLE hermes_asks (
  id          TEXT PRIMARY KEY,             -- ask_…
  user_id     INTEGER NOT NULL DEFAULT 1,
  question    TEXT NOT NULL,
  source      TEXT NOT NULL,                -- chat | voice | phone | …
  status      TEXT NOT NULL DEFAULT 'open', -- open | answered
  answer      TEXT,
  picked_at   INTEGER,                      -- first time Hermes fetched it
  answered_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_hermes_asks_status ON hermes_asks (status, created_at);
