# 个人曲库系统设计文档

**创建日期**: 2026-07-08
**版本**: 1.0
**状态**: 待审核

---

## 1. 项目概述

### 1.1 项目目标

建立一个大型个人音乐曲库系统，支持：
- **大规模曲库**：2000-10000首歌曲
- **多维度分类**：流派、语言、场景、情绪、年代、热度、自定义标签
- **自动化管理**：爬虫自动获取、自动分类、URL自动维护
- **Web管理界面**：独立的管理后台和分类浏览页面

### 1.2 核心需求

1. **数据来源**：通过爬虫从网易云音乐、QQ音乐、酷狗音乐、汽水音乐等平台获取歌曲数据
2. **分类系统**：
   - 流派（支持子流派）
   - 语言
   - 场景
   - 情绪
   - 年代
   - 热度（基于播放量、评论量、点赞量、收藏量）
   - 自定义标签（支持层级）
3. **分类方式**：自动分类 + 人工校正
4. **爬取策略**：增量更新，每天爬取500-1000首
5. **URL维护**：每天检查，自动刷新失效URL

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  播放器前端   │  │  管理后台     │  │   分类浏览页面    │   │
│  │  (React)     │  │  (React)     │  │   (React)        │   │
│  │  端口:5173   │  │  端口:5174   │  │   端口:5175      │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        服务层                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Node.js Express API服务                    ││
│  │                    端口:3000                            ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      ││
│  │  │用户模块 │ │歌曲模块 │ │分类模块 │ │搜索模块 │      ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘      ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────────────────────┐  ││
│  │  │日志模块 │ │统计模块 │ │URL刷新模块               │  ││
│  │  └─────────┘ └─────────┘ └─────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Python Flask 爬虫服务                      ││
│  │                    端口:5000                            ││
│  │  ┌─────────────────────────────────────────────────┐   ││
│  │  │ 爬虫模块 | 自动分类模块 | 定时任务模块           │   ││
│  │  └─────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        数据层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │    MySQL     │  │    Redis     │  │      CDN         │   │
│  │   端口:3306  │  │   端口:6379  │  │   (音频文件)     │   │
│  │  (主数据库)  │  │   (缓存)     │  │                  │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React + Vite + Three.js | 播放器、管理后台、分类浏览 |
| 后端API | Node.js Express + Prisma | REST API服务 |
| 爬虫服务 | Python Flask + SQLAlchemy | 数据爬取和处理 |
| 数据库 | MySQL 8.0 | 主数据库 |
| 缓存 | Redis 7.0 | 热门数据缓存 |
| CDN | 阿里云/腾讯云/七牛云 | 音频文件加速 |
| 部署 | Nginx + PM2 + Systemd | 生产环境部署 |

### 2.3 服务间通信

- **前端 ↔ Node.js API**：REST API（JSON）
- **Node.js API ↔ MySQL**：Prisma ORM
- **Node.js API ↔ Redis**：缓存查询结果
- **Python Flask ↔ MySQL**：SQLAlchemy ORM
- **Python Flask ↔ Node.js API**：共享数据库，无需直接通信

---

## 3. 数据库设计

### 3.1 核心表结构

#### 3.1.1 歌曲表 (songs)

```sql
CREATE TABLE songs (
    id VARCHAR(50) PRIMARY KEY,           -- 格式: "platform:songId"
    title VARCHAR(200) NOT NULL,
    artist VARCHAR(200) NOT NULL,
    album VARCHAR(200),
    album_cover VARCHAR(500),
    audio_url VARCHAR(500) NOT NULL,
    audio_url_mp3 VARCHAR(500),
    lyric_content TEXT,
    cover_color VARCHAR(20),
    platform VARCHAR(20),                 -- netease, kugou, qq, qishui, open-library
    playable BOOLEAN DEFAULT TRUE,
    
    -- 热度指标
    play_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    like_count INT DEFAULT 0,
    favorite_count INT DEFAULT 0,
    hot_score FLOAT DEFAULT 0,            -- 综合热度评分
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    url_checked_at TIMESTAMP,             -- URL最后检查时间
    
    -- 索引
    INDEX idx_title (title),
    INDEX idx_artist (artist),
    INDEX idx_platform (platform),
    INDEX idx_hot_score (hot_score),
    INDEX idx_created_at (created_at)
);
```

#### 3.1.2 分类维度表

**流派表 (genres)**
```sql
CREATE TABLE genres (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id INT,                        -- 父流派ID（支持子流派）
    level INT DEFAULT 1,                  -- 层级（1=一级流派，2=子流派）
    sort_order INT DEFAULT 0,
    FOREIGN KEY (parent_id) REFERENCES genres(id)
);
```

**语言表 (languages)**
```sql
CREATE TABLE languages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    code VARCHAR(10) UNIQUE               -- 语言代码（zh, en, ja, ko等）
);
```

**场景表 (scenes)**
```sql
CREATE TABLE scenes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(50)
);
```

**情绪表 (moods)**
```sql
CREATE TABLE moods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(50)
);
```

**年代表 (decades)**
```sql
CREATE TABLE decades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(20) NOT NULL,
    start_year INT,
    end_year INT
);
```

**自定义标签表 (tags)**
```sql
CREATE TABLE tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id INT,                        -- 父标签ID（支持层级）
    level INT DEFAULT 1,
    user_id INT,                          -- 创建者
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES tags(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### 3.1.3 歌曲-分类关联表

```sql
-- 歌曲-流派关联
CREATE TABLE song_genres (
    song_id VARCHAR(50),
    genre_id INT,
    PRIMARY KEY (song_id, genre_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id)
);

-- 歌曲-语言关联
CREATE TABLE song_languages (
    song_id VARCHAR(50),
    language_id INT,
    PRIMARY KEY (song_id, language_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (language_id) REFERENCES languages(id)
);

-- 歌曲-场景关联
CREATE TABLE song_scenes (
    song_id VARCHAR(50),
    scene_id INT,
    PRIMARY KEY (song_id, scene_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES scenes(id)
);

-- 歌曲-情绪关联
CREATE TABLE song_moods (
    song_id VARCHAR(50),
    mood_id INT,
    PRIMARY KEY (song_id, mood_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (mood_id) REFERENCES moods(id)
);

-- 歌曲-年代关联
CREATE TABLE song_decades (
    song_id VARCHAR(50),
    decade_id INT,
    PRIMARY KEY (song_id, decade_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (decade_id) REFERENCES decades(id)
);

-- 歌曲-标签关联
CREATE TABLE song_tags (
    song_id VARCHAR(50),
    tag_id INT,
    PRIMARY KEY (song_id, tag_id),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);
```

#### 3.1.4 用户系统表

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin', 'admin', 'editor', 'user') DEFAULT 'user',
    status ENUM('active', 'disabled') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    reset_token VARCHAR(255),             -- 密码重置令牌
    reset_token_expires_at TIMESTAMP
);
```

#### 3.1.5 日志表

```sql
-- 操作日志
CREATE TABLE operation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(50) NOT NULL,          -- login, edit, delete, etc.
    target_type VARCHAR(50),              -- song, genre, user, etc.
    target_id VARCHAR(50),
    details JSON,                         -- 操作详情
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 爬取日志
CREATE TABLE crawl_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_type VARCHAR(50) NOT NULL,       -- crawl, refresh_url, check_url
    platform VARCHAR(20),
    status ENUM('running', 'success', 'failed') DEFAULT 'running',
    total_count INT DEFAULT 0,
    success_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

### 3.2 预定义数据

#### 流派预设数据
```sql
INSERT INTO genres (name, parent_id, level, sort_order) VALUES
-- 一级流派
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

-- 子流派（以流行和电子为例）
INSERT INTO genres (name, parent_id, level, sort_order) VALUES
('华语流行', 1, 2, 1),
('欧美流行', 1, 2, 2),
('日韩流行', 1, 2, 3),
('House', 4, 2, 1),
('Techno', 4, 2, 2),
('Trance', 4, 2, 3),
('Dubstep', 4, 2, 4);
```

#### 语言预设数据
```sql
INSERT INTO languages (name, code) VALUES
('中文', 'zh'),
('英文', 'en'),
('日文', 'ja'),
('韩文', 'ko'),
('粤语', 'yue'),
('法语', 'fr'),
('西班牙语', 'es'),
('其他', 'other');
```

#### 场景预设数据
```sql
INSERT INTO scenes (name, icon) VALUES
('运动', '🏃'),
('学习', '📚'),
('工作', '💼'),
('睡眠', '😴'),
('驾驶', '🚗'),
('聚会', '🎉'),
('旅行', '✈️'),
('咖啡厅', '☕');
```

#### 情绪预设数据
```sql
INSERT INTO moods (name, icon) VALUES
('欢快', '😊'),
('悲伤', '😢'),
('励志', '💪'),
('浪漫', '💕'),
('平静', '😌'),
('激昂', '🔥'),
('怀旧', '🕰️'),
('神秘', '🔮');
```

#### 年代预设数据
```sql
INSERT INTO decades (name, start_year, end_year) VALUES
('2020s', 2020, 2029),
('2010s', 2010, 2019),
('2000s', 2000, 2009),
('90s', 1990, 1999),
('80s', 1980, 1989),
('70s', 1970, 1979),
('更早', 1900, 1969);
```

---

## 4. API接口设计

### 4.1 用户认证API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/auth/register` | POST | 用户注册 | 公开 |
| `/api/auth/login` | POST | 用户登录 | 公开 |
| `/api/auth/logout` | POST | 用户登出 | 已登录 |
| `/api/auth/me` | GET | 获取当前用户信息 | 已登录 |
| `/api/auth/password-reset-request` | POST | 请求密码重置 | 公开 |
| `/api/auth/password-reset` | POST | 执行密码重置 | 公开 |

### 4.2 歌曲管理API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/songs` | GET | 获取歌曲列表（支持筛选、排序、分页） | 公开 |
| `/api/songs/:id` | GET | 获取单首歌曲详情 | 公开 |
| `/api/songs` | POST | 添加歌曲 | admin+ |
| `/api/songs/:id` | PUT | 更新歌曲信息 | editor+ |
| `/api/songs/:id` | DELETE | 删除歌曲 | admin+ |
| `/api/songs/batch-update` | POST | 批量更新歌曲分类 | editor+ |
| `/api/songs/batch-delete` | POST | 批量删除歌曲 | admin+ |
| `/api/songs/:id/url-status` | GET | 检查歌曲URL状态 | 公开 |
| `/api/songs/:id/refresh-url` | POST | 刷新歌曲URL | admin+ |

### 4.3 分类管理API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/genres` | GET | 获取所有流派 | 公开 |
| `/api/genres` | POST | 添加流派 | admin+ |
| `/api/genres/:id` | PUT | 更新流派 | admin+ |
| `/api/genres/:id` | DELETE | 删除流派 | admin+ |
| `/api/languages` | GET | 获取所有语言 | 公开 |
| `/api/languages` | POST | 添加语言 | admin+ |
| `/api/scenes` | GET | 获取所有场景 | 公开 |
| `/api/scenes` | POST | 添加场景 | admin+ |
| `/api/moods` | GET | 获取所有情绪 | 公开 |
| `/api/moods` | POST | 添加情绪 | admin+ |
| `/api/decades` | GET | 获取所有年代 | 公开 |
| `/api/tags` | GET | 获取所有标签 | 公开 |
| `/api/tags` | POST | 添加标签 | editor+ |
| `/api/tags/:id` | PUT | 更新标签 | editor+ |
| `/api/tags/:id` | DELETE | 删除标签 | admin+ |

### 4.4 搜索API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/search` | GET | 全局搜索歌曲 | 公开 |
| `/api/search/suggestions` | GET | 搜索建议 | 公开 |

### 4.5 爬虫任务API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/crawl/tasks` | GET | 获取爬取任务列表 | admin+ |
| `/api/crawl/tasks/:id` | GET | 获取任务详情 | admin+ |
| `/api/crawl/start` | POST | 手动启动爬取任务 | admin+ |
| `/api/crawl/stop/:id` | POST | 停止任务 | admin+ |
| `/api/crawl/refresh-all-urls` | POST | 批量刷新所有URL | admin+ |
| `/api/crawl/check-all-urls` | POST | 检查所有URL状态 | admin+ |

### 4.6 用户管理API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/users` | GET | 获取用户列表 | admin+ |
| `/api/users/:id` | GET | 获取用户详情 | admin+ |
| `/api/users` | POST | 创建用户 | super_admin |
| `/api/users/:id` | PUT | 更新用户信息 | admin+ |
| `/api/users/:id` | DELETE | 删除用户 | super_admin |
| `/api/users/:id/disable` | POST | 禁用用户 | admin+ |
| `/api/users/:id/enable` | POST | 启用用户 | admin+ |

### 4.7 统计API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/stats/overview` | GET | 获取总览统计 | admin+ |
| `/api/stats/genres` | GET | 获取流派分布 | admin+ |
| `/api/stats/languages` | GET | 获取语言分布 | admin+ |
| `/api/stats/platforms` | GET | 获取平台分布 | admin+ |
| `/api/stats/url-status` | GET | 获取URL状态统计 | admin+ |

### 4.8 日志API

| 端点 | 方法 | 功能 | 权限 |
|------|------|------|------|
| `/api/logs/operations` | GET | 获取操作日志 | admin+ |
| `/api/logs/crawls` | GET | 获取爬取日志 | admin+ |
| `/api/logs/errors` | GET | 获取错误日志 | admin+ |

---

## 5. 前端页面设计

### 5.1 管理后台页面

**页面结构**：
```
┌─────────────────────────────────────────────────────────────┐
│                        顶部导航栏                           │
│  Logo | 曲库管理 | 分类管理 | 爬取任务 | 用户管理 | 数据统计 │
└─────────────────────────────────────────────────────────────┘
┌──────────────┐  ┌───────────────────────────────────────────┐
│              │  │                                           │
│   侧边栏     │  │              主内容区                     │
│              │  │                                           │
│  - 歌曲列表  │  │   根据顶部导航显示不同内容                 │
│  - 流派管理  │  │                                           │
│  - 语言管理  │  │                                           │
│  - 场景管理  │  │                                           │
│  - 情绪管理  │  │                                           │
│  - 年代管理  │  │                                           │
│  - 标签管理  │  │                                           │
│              │  │                                           │
└──────────────┘  └───────────────────────────────────────────┘
```

**主要页面**：

1. **歌曲列表页**
   - 顶部：搜索框 + 筛选条件（流派、语言、场景、情绪、年代、标签、平台）
   - 中间：歌曲卡片网格（显示封面、标题、艺术家、热度、分类标签）
   - 底部：无限滚动加载
   - 操作按钮：编辑、删除、批量操作、刷新URL

2. **分类管理页**
   - 左侧：分类树形结构（支持拖拽排序）
   - 右侧：该分类下的歌曲列表
   - 操作：添加子分类、编辑、删除、批量移动歌曲

3. **爬取任务页**
   - 任务列表：显示历史任务（时间、状态、数量）
   - 手动触发：选择平台、策略、数量
   - 实时进度：显示当前任务进度
   - 日志查看：查看详细爬取日志

4. **用户管理页**
   - 用户列表：用户名、邮箱、角色、状态、最后登录时间
   - 操作：添加用户、编辑角色、禁用/启用、删除

5. **数据统计页**
   - 总览卡片：歌曲总数、可播放数、用户数、今日爬取数
   - 图表：流派分布饼图、语言分布柱状图、平台分布饼图、URL状态统计、爬取趋势折线图

### 5.2 分类浏览页面

**页面结构**：
```
┌─────────────────────────────────────────────────────────────┐
│                        顶部导航栏                           │
│  Logo | 分类浏览 | 搜索框                                   │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                        筛选区域                             │
│  流派: [流行] [摇滚] [电子] [民谣] ...                      │
│  语言: [中文] [英文] [日文] [韩文] ...                      │
│  场景: [运动] [学习] [工作] [睡眠] ...                      │
│  情绪: [欢快] [悲伤] [励志] [浪漫] ...                      │
│  年代: [2020s] [2010s] [2000s] [90s] ...                   │
│  排序: [热度] [时间] [名称] [艺术家]                        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                        歌曲网格                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ 封面    │  │ 封面    │  │ 封面    │  │ 封面    │       │
│  │ 标题    │  │ 标题    │  │ 标题    │  │ 标题    │       │
│  │ 艺术家  │  │ 艺术家  │  │ 艺术家  │  │ 艺术家  │       │
│  │ 热度    │  │ 热度    │  │ 热度    │  │ 热度    │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│                        (无限滚动)                           │
└─────────────────────────────────────────────────────────────┘
```

**交互设计**：
- 筛选：点击标签进行多选筛选，支持组合筛选
- 排序：点击排序按钮选择排序方式
- 搜索：在筛选结果中搜索
- 播放：点击歌曲卡片开始播放
- 详情：点击歌曲卡片显示详情弹窗（歌词、分类信息）

### 5.3 播放器前端改动

**需要修改的部分**：

1. **数据源切换**
   - 从读取 `tracks.json` 改为调用 `/api/songs` API
   - 保持现有的 `Track` 接口不变，确保兼容性

2. **新增功能**
   - 分类筛选：在播放器界面添加简单的分类筛选（可选）
   - 搜索增强：搜索时调用 `/api/search` API，支持在线搜索

3. **保持不变**
   - 播放器核心逻辑
   - 频谱分析
   - 歌词显示
   - 3D背景

---

## 6. 爬虫系统设计

### 6.1 爬虫架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Python Flask 爬虫服务                    │
│                         端口:5000                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      爬虫调度器                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  APScheduler (定时任务调度)                          │   │
│  │  - 每日爬取任务 (凌晨2:00)                          │   │
│  │  - 每日URL检查任务 (凌晨3:00)                       │   │
│  │  - 每周URL刷新任务 (周日凌晨4:00)                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      爬虫引擎                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ 网易云爬虫   │  │ QQ音乐爬虫  │  │ 酷狗音乐爬虫        │ │
│  │ (已有代码)  │  │ (新增)      │  │ (新增)              │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────────────────────────────┐  │
│  │ 汽水音乐    │  │ 代理池管理器                        │  │
│  │ (新增)      │  │ - 自建代理服务器                    │  │
│  └─────────────┘  │ - 代理验证和轮换                    │  │
│                   │ - 失败重试机制                      │  │
│                   └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      自动分类系统                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  分类策略                                            │   │
│  │  1. 基于平台标签 (优先级最高)                        │   │
│  │  2. 基于元数据 (标题、艺术家、专辑)                  │   │
│  │  3. 基于歌词分析 (情绪、主题)                        │   │
│  │  4. 热度计算 (播放量、评论量、点赞量、收藏量)        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      数据存储                                │
│  ┌─────────────┐  ┌─────────────────────────────────────┐  │
│  │   MySQL     │  │   tracks.json (过渡期双写)          │  │
│  │   (主库)    │  │   (确认无误后删除)                  │  │
│  └─────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 爬取策略

1. **热门优先策略**
   - 排行榜爬取：各平台热歌榜、新歌榜、飙升榜
   - 热门歌单：爬取热门歌单中的歌曲
   - 数量分配：每次爬取70%热门歌曲 + 30%随机歌曲

2. **按需补充策略**
   - 分类缺口分析：统计各分类的歌曲数量
   - 针对性爬取：优先爬取数量较少的分类
   - 平衡策略：确保各分类歌曲数量相对均衡

3. **增量更新策略**
   - 去重机制：通过歌曲ID去重，避免重复爬取
   - 更新机制：已存在的歌曲只更新热度数据
   - 新歌检测：优先爬取最近发布的新歌

### 6.3 反爬虫策略

1. **请求控制**
   - 请求间隔：每次请求间隔5-10秒（随机）
   - 并发控制：单次爬取只使用一个代理IP
   - 失败重试：失败后等待30秒重试，最多重试3次

2. **代理池管理**
   - 自建代理服务器：使用自己的服务器/VPN
   - 代理验证：定期验证代理可用性
   - 代理轮换：每次请求使用不同代理
   - 失败标记：连续失败的代理暂时禁用

3. **User-Agent轮换**
   - 预定义列表：准备20+个常见浏览器User-Agent
   - 随机选择：每次请求随机选择User-Agent
   - 定期更新：每月更新User-Agent列表

### 6.4 自动分类系统

1. **基于平台标签**
   - 使用网易云/QQ音乐等平台的官方分类
   - 映射到内部分类系统

2. **基于元数据**
   - 语言检测：通过标题和艺术家名称检测语言
   - 年代推断：通过歌曲发布时间推断年代
   - 流派推断：通过艺术家已知风格推断流派

3. **基于歌词分析**
   - 情绪分析：通过关键词匹配分析情绪
   - 场景推断：通过歌词内容和情绪推断场景

4. **热度计算**
   - 加权计算：播放量 0.4，评论量 0.2，点赞量 0.2，收藏量 0.2
   - 归一化：归一化到 0-100

### 6.5 URL维护机制

1. **每日URL检查**
   - 检查所有歌曲URL状态
   - 标记失效URL
   - 记录检查时间

2. **URL自动刷新**
   - 调用各平台API获取新URL
   - 更新数据库
   - 记录刷新时间

3. **定时任务配置**
   - 每日凌晨2:00：执行爬取任务
   - 每日凌晨3:00：检查URL状态
   - 每周日凌晨4:00：批量刷新失效URL

---

## 7. 数据迁移与部署方案

### 7.1 数据迁移方案

#### 迁移策略：双写过渡期

**阶段一：双写准备**
- 修改现有代码，同时写入JSON和MySQL
- 确保两边数据一致性
- 运行1-2周，观察数据差异

**阶段二：数据验证**
- 编写验证脚本，对比JSON和MySQL数据
- 检查数据完整性、一致性
- 修复发现的问题

**阶段三：切换主库**
- 将MySQL作为主数据库
- 停止写入JSON
- 保留JSON作为备份

**阶段四：清理**
- 确认系统稳定运行1个月后
- 删除JSON文件

### 7.2 本地部署方案

**系统要求**：
- Windows 10/11
- Python 3.8+
- Node.js 18+
- MySQL 8.0+
- Redis 7.0+

**本地访问地址**：
| 服务 | 地址 |
|------|------|
| 播放器前端 | http://localhost:5173 |
| 管理后台 | http://localhost:5174 |
| 分类浏览 | http://localhost:5175 |
| Node.js API | http://localhost:3000 |
| Python 爬虫服务 | http://localhost:5000 |
| MySQL | localhost:3306 |
| Redis | localhost:6379 |

### 7.3 服务器部署方案

**服务器要求**：
- CPU: 4核（推荐）
- 内存: 8GB（推荐）
- 硬盘: 200GB SSD（推荐）
- 带宽: 10Mbps（推荐）
- 操作系统: Ubuntu 22.04 LTS（推荐）

**服务器访问地址**：
| 服务 | 地址 |
|------|------|
| 播放器前端 | https://your-domain.com |
| 管理后台 | https://your-domain.com/admin |
| 分类浏览 | https://your-domain.com/browse |
| API服务 | https://your-domain.com/api |
| 爬虫服务 | https://your-domain.com/crawler |

### 7.4 CDN配置

**CDN服务选择**：
- 阿里云CDN：国内访问快，价格适中
- 腾讯云CDN：与微信生态集成好
- 七牛云CDN：价格便宜，适合个人项目
- Cloudflare：全球节点，免费额度大

---

## 8. 项目结构

```
music_box/
├── web/                          # Web前端
│   ├── src/
│   │   ├── components/           # 播放器组件
│   │   ├── hooks/                # 自定义Hooks
│   │   └── ...
│   ├── admin/                    # 管理后台（新增）
│   │   ├── src/
│   │   │   ├── components/       # 管理后台组件
│   │   │   ├── pages/            # 页面
│   │   │   └── ...
│   │   └── ...
│   ├── browse/                   # 分类浏览（新增）
│   │   ├── src/
│   │   │   ├── components/       # 浏览组件
│   │   │   ├── pages/            # 页面
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── server/                       # Node.js API服务（新增）
│   ├── src/
│   │   ├── modules/              # 业务模块
│   │   │   ├── auth/             # 用户认证
│   │   │   ├── songs/            # 歌曲管理
│   │   │   ├── genres/           # 流派管理
│   │   │   ├── languages/        # 语言管理
│   │   │   ├── scenes/           # 场景管理
│   │   │   ├── moods/            # 情绪管理
│   │   │   ├── decades/          # 年代管理
│   │   │   ├── tags/             # 标签管理
│   │   │   ├── search/           # 搜索
│   │   │   ├── crawl/            # 爬虫任务
│   │   │   ├── stats/            # 统计
│   │   │   └── logs/             # 日志
│   │   ├── prisma/               # Prisma配置
│   │   └── ...
│   ├── package.json
│   └── ...
├── tools/                        # Python爬虫服务
│   ├── audio_server.py           # 音频服务（已有）
│   ├── netease_crawler.py        # 网易云爬虫（已有）
│   ├── kugou_crawler.py          # 酷狗爬虫（新增）
│   ├── qq_crawler.py             # QQ音乐爬虫（新增）
│   ├── qishui_crawler.py         # 汽水音乐爬虫（新增）
│   ├── auto_classifier.py        # 自动分类（新增）
│   ├── proxy_manager.py          # 代理管理（新增）
│   ├── scheduler.py              # 定时任务（新增）
│   └── requirements.txt
├── shared/                       # 共享代码
│   ├── types.ts                  # TypeScript类型定义
│   ├── tracks.json               # 曲目数据（过渡期）
│   └── ...
├── docs/                         # 文档
│   └── superpowers/
│       └── specs/
│           └── 2026-07-08-personal-music-library-design.md
├── scripts/                      # 脚本
│   ├── init_database.py          # 数据库初始化
│   ├── migrate_json_to_mysql.py  # 数据迁移
│   └── validate_migration.py     # 迁移验证
├── start-local.bat               # 本地启动脚本
├── docker-compose.yml            # Docker配置（可选）
└── ...
```

---

## 9. 开发计划

### 阶段一：基础设施搭建（1-2周）

1. **数据库设计和初始化**
   - 创建MySQL数据库
   - 执行SQL建表语句
   - 插入预定义数据

2. **Node.js API服务搭建**
   - 初始化项目
   - 配置Prisma
   - 实现用户认证模块

3. **Python爬虫服务改造**
   - 重构现有爬虫代码
   - 添加新平台爬虫
   - 实现自动分类系统

### 阶段二：核心功能开发（2-3周）

1. **歌曲管理API**
   - 实现歌曲CRUD
   - 实现分类关联
   - 实现搜索功能

2. **分类管理API**
   - 实现各分类维度的CRUD
   - 实现歌曲-分类关联

3. **爬虫任务API**
   - 实现任务管理
   - 实现手动触发
   - 实现状态查询

### 阶段三：前端开发（2-3周）

1. **管理后台**
   - 歌曲列表页
   - 分类管理页
   - 爬取任务页
   - 用户管理页
   - 数据统计页

2. **分类浏览页面**
   - 筛选区域
   - 歌曲网格
   - 无限滚动

3. **播放器前端改造**
   - 数据源切换
   - 搜索增强

### 阶段四：数据迁移和测试（1-2周）

1. **数据迁移**
   - 编写迁移脚本
   - 执行迁移
   - 验证数据

2. **测试**
   - 单元测试
   - 集成测试
   - 性能测试

### 阶段五：部署和优化（1周）

1. **本地部署**
   - 配置本地环境
   - 测试本地运行

2. **服务器部署**
   - 配置服务器环境
   - 部署应用
   - 配置CDN

3. **优化**
   - 性能优化
   - 缓存优化
   - 安全加固

---

## 10. 风险和注意事项

### 10.1 技术风险

1. **爬虫被封禁**
   - 解决方案：使用代理池、控制请求频率、随机User-Agent

2. **API接口变动**
   - 解决方案：定期检查API可用性、准备备用方案

3. **数据量过大**
   - 解决方案：分页查询、索引优化、缓存热门数据

### 10.2 法律风险

1. **版权问题**
   - 注意事项：仅用于个人学习和研究，不得用于商业用途

2. **用户协议**
   - 注意事项：遵守各平台的用户协议和robots.txt

### 10.3 维护风险

1. **URL失效**
   - 解决方案：自动检查和刷新机制

2. **数据一致性**
   - 解决方案：事务处理、数据验证

3. **系统稳定性**
   - 解决方案：日志监控、错误处理、自动重启

---

## 11. 附录

### 11.1 参考资料

- [网易云音乐API文档](https://github.com/Binaryify/NeteaseCloudMusicApi)
- [QQ音乐API文档](https://github.com/jsososo/QQMusicApi)
- [Prisma文档](https://www.prisma.io/docs)
- [Express文档](https://expressjs.com/)
- [Flask文档](https://flask.palletsprojects.com/)

### 11.2 术语表

| 术语 | 说明 |
|------|------|
| 热度评分 | 基于播放量、评论量、点赞量、收藏量的综合评分 |
| 自动分类 | 通过算法自动为歌曲分配分类标签 |
| 人工校正 | 管理员手动修改歌曲的分类标签 |
| 双写过渡期 | 同时写入JSON和MySQL，确认无误后切换的过渡阶段 |

---

**文档结束**

如有任何问题或建议，请联系项目负责人。
