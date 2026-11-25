-- 预设数据脚本
-- 插入流派数据
INSERT INTO genres (name, parent_id, level, sort_order) VALUES
('流行', NULL, 1, 1),
('摇滚', NULL, 1, 2),
('民谣', NULL, 1, 3),
('电子', NULL, 1, 4),
('嘻哈', NULL, 1, 5),
('R&B', NULL, 1, 6),
('古典', NULL, 1, 7),
('爵士', NULL, 1, 8),
('金属', NULL, 1, 9),
('朋克', NULL, 1, 10);

INSERT INTO genres (name, parent_id, level, sort_order) VALUES
('华语流行', 1, 2, 1),
('欧美流行', 1, 2, 2),
('日韩流行', 1, 2, 3),
('House', 4, 2, 1),
('Techno', 4, 2, 2),
('Trance', 4, 2, 3),
('Dubstep', 4, 2, 4);

-- 插入语言数据
INSERT INTO languages (name, code) VALUES
('中文', 'zh'),
('英文', 'en'),
('日文', 'ja'),
('韩文', 'ko'),
('粤语', 'yue'),
('法语', 'fr'),
('西班牙语', 'es'),
('其他', 'other');

-- 插入场景数据
INSERT INTO scenes (name, icon) VALUES
('运动', '🏃'),
('学习', '📚'),
('工作', '💼'),
('睡眠', '😴'),
('驾驶', '🚗'),
('聚会', '🎉'),
('旅行', '✈️'),
('咖啡厅', '☕');

-- 插入情绪数据
INSERT INTO moods (name, icon) VALUES
('欢快', '😊'),
('悲伤', '😢'),
('励志', '💪'),
('浪漫', '💕'),
('平静', '😌'),
('激昂', '🔥'),
('怀旧', '🕰️'),
('神秘', '🔮');

-- 插入年代数据
INSERT INTO decades (name, start_year, end_year) VALUES
('2020s', 2020, 2029),
('2010s', 2010, 2019),
('2000s', 2000, 2009),
('90s', 1990, 1999),
('80s', 1980, 1989),
('70s', 1970, 1979),
('更早', 1900, 1969);