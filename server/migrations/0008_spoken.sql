-- Spoken versions for read-aloud: the 30-second morning briefing and world summary (JSON).
ALTER TABLE briefings ADD COLUMN spoken TEXT;
ALTER TABLE news_digests ADD COLUMN spoken TEXT;
