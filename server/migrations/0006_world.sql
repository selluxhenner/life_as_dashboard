-- World page: topic per story (politics, economy, elections …), the digest's big-picture briefs and election tracker.
ALTER TABLE news_items ADD COLUMN topic TEXT;
ALTER TABLE news_digests ADD COLUMN elections TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_news_sig ON news_items (significance, published_at);
