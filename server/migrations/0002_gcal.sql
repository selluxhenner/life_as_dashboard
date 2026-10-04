-- Google-Kalender-Verbindung (genau eine, daher id = 1). Das Refresh-Token bleibt auf dem Server,
-- damit alle Geräte den Kalender nutzen, ohne sich einzeln bei Google anzumelden.
CREATE TABLE gcal_auth (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token  TEXT NOT NULL,
  access_token   TEXT,
  access_expires INTEGER,          -- ms
  account        TEXT,             -- ID des Hauptkalenders = Google-Adresse
  connected_at   INTEGER NOT NULL  -- ms
);
