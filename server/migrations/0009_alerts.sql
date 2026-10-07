-- Phone alerts. Every notification gets a kind (briefing, breaking, ai …), so the Android app can give each its own
-- channel and Settings can switch a kind off, plus a ref (news cluster, AI vendor) that stops the same event pinging twice.
ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN ref TEXT;
CREATE INDEX idx_notifications_kind ON notifications (kind, created_at);
-- AI updates remember whether they raised an alert. Everything already stored counts as done, so the first run after
-- this migration doesn't replay a week of AI news.
ALTER TABLE ai_updates ADD COLUMN alerted INTEGER NOT NULL DEFAULT 0;
UPDATE ai_updates SET alerted = 1;
-- Optional instant push (Firebase Cloud Messaging): the phone registers its FCM token here.
ALTER TABLE devices ADD COLUMN push_token TEXT;
