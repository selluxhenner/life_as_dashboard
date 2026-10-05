-- AI tracker: keep the feed excerpt so summaries can say what changed, and store the day's top 8 highlights.
ALTER TABLE ai_updates ADD COLUMN snippet TEXT;
ALTER TABLE ai_daily ADD COLUMN highlights TEXT NOT NULL DEFAULT '[]';
