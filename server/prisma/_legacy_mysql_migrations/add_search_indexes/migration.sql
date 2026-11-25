-- 添加 FULLTEXT 索引（支持中文分词）
ALTER TABLE songs ADD FULLTEXT INDEX ft_title (title) WITH PARSER ngram;
ALTER TABLE songs ADD FULLTEXT INDEX ft_artist (artist) WITH PARSER ngram;
ALTER TABLE songs ADD FULLTEXT INDEX ft_album (album) WITH PARSER ngram;
ALTER TABLE songs ADD FULLTEXT INDEX ft_search (title, artist, album) WITH PARSER ngram;

-- 添加复合索引优化查询性能
CREATE INDEX idx_playable_hot_score ON songs(playable, hot_score DESC);
CREATE INDEX idx_playable_created_at ON songs(playable, created_at DESC);
CREATE INDEX idx_playable_play_count ON songs(playable, play_count DESC);
