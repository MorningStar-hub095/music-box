# 个人曲库系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个支持多维度分类、自动爬取、人工校正的大型个人音乐曲库系统

**Architecture:** 三层架构（前端React + Node.js Express API + Python Flask爬虫），共享MySQL数据库，Redis缓存，CDN加速音频文件

**Tech Stack:** React, Node.js Express, Prisma, Python Flask, SQLAlchemy, MySQL 8.0, Redis 7.0, APScheduler

---

## 文件结构

### 新增文件

```
music_box/
├── server/                           # Node.js API服务
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma             # Prisma数据模型
│   ├── src/
│   │   ├── index.ts                  # 服务入口
│   │   ├── config.ts                 # 配置文件
│   │   ├── middleware/
│   │   │   ├── auth.ts               # 认证中间件
│   │   │   ├── logger.ts             # 日志中间件
│   │   │   └── errorHandler.ts       # 错误处理
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── auth.routes.ts
│   │   │   ├── songs/
│   │   │   │   ├── songs.controller.ts
│   │   │   │   ├── songs.service.ts
│   │   │   │   └── songs.routes.ts
│   │   │   ├── genres/
│   │   │   │   ├── genres.controller.ts
│   │   │   │   ├── genres.service.ts
│   │   │   │   └── genres.routes.ts
│   │   │   ├── languages/
│   │   │   │   ├── languages.controller.ts
│   │   │   │   ├── languages.service.ts
│   │   │   │   └── languages.routes.ts
│   │   │   ├── scenes/
│   │   │   │   ├── scenes.controller.ts
│   │   │   │   ├── scenes.service.ts
│   │   │   │   └── scenes.routes.ts
│   │   │   ├── moods/
│   │   │   │   ├── moods.controller.ts
│   │   │   │   ├── moods.service.ts
│   │   │   │   └── moods.routes.ts
│   │   │   ├── decades/
│   │   │   │   ├── decades.controller.ts
│   │   │   │   ├── decades.service.ts
│   │   │   │   └── decades.routes.ts
│   │   │   ├── tags/
│   │   │   │   ├── tags.controller.ts
│   │   │   │   ├── tags.service.ts
│   │   │   │   └── tags.routes.ts
│   │   │   ├── search/
│   │   │   │   ├── search.controller.ts
│   │   │   │   ├── search.service.ts
│   │   │   │   └── search.routes.ts
│   │   │   ├── crawl/
│   │   │   │   ├── crawl.controller.ts
│   │   │   │   ├── crawl.service.ts
│   │   │   │   └── crawl.routes.ts
│   │   │   ├── stats/
│   │   │   │   ├── stats.controller.ts
│   │   │   │   ├── stats.service.ts
│   │   │   │   └── stats.routes.ts
│   │   │   └── logs/
│   │   │       ├── logs.controller.ts
│   │   │       ├── logs.service.ts
│   │   │       └── logs.routes.ts
│   │   └── utils/
│   │       ├── redis.ts              # Redis客户端
│   │       └── logger.ts             # 日志工具
│   └── tests/
│       └── ...
├── web/admin/                        # 管理后台前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── styles/
│   └── ...
├── web/browse/                       # 分类浏览前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── styles/
│   └── ...
├── tools/
│   ├── kugou_crawler.py              # 酷狗爬虫
│   ├── qq_crawler.py                 # QQ音乐爬虫
│   ├── qishui_crawler.py             # 汽水音乐爬虫
│   ├── auto_classifier.py            # 自动分类
│   ├── proxy_manager.py              # 代理管理
│   └── scheduler.py                  # 定时任务
├── scripts/
│   ├── init_database.py              # 数据库初始化
│   ├── migrate_json_to_mysql.py      # 数据迁移
│   └── validate_migration.py         # 迁移验证
└── docs/superpowers/
    ├── specs/
    │   └── 2026-07-08-personal-music-library-design.md
    └── plans/
        └── 2026-07-08-personal-music-library.md
```

---

## 任务分解

### Task 1: 数据库初始化

**Files:**
- Create: `scripts/init_database.py`
- Create: `scripts/seed_data.sql`

- [ ] **Step 1: 创建数据库初始化脚本**

```python
# scripts/init_database.py
import mysql.connector
from mysql.connector import Error

def init_database():
    """初始化MySQL数据库"""
    try:
        # 连接MySQL
        connection = mysql.connector.connect(
            host='localhost',
            user='root',
            password='your_password'
        )
        
        if connection.is_connected():
            cursor = connection.cursor()
            
            # 创建数据库
            cursor.execute("""
                CREATE DATABASE IF NOT EXISTS music_box 
                CHARACTER SET utf8mb4 
                COLLATE utf8mb4_unicode_ci
            """)
            
            # 使用数据库
            cursor.execute("USE music_box")
            
            # 创建歌曲表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS songs (
                    id VARCHAR(50) PRIMARY KEY,
                    title VARCHAR(200) NOT NULL,
                    artist VARCHAR(200) NOT NULL,
                    album VARCHAR(200),
                    album_cover VARCHAR(500),
                    audio_url VARCHAR(500) NOT NULL,
                    audio_url_mp3 VARCHAR(500),
                    lyric_content TEXT,
                    cover_color VARCHAR(20),
                    platform VARCHAR(20),
                    playable BOOLEAN DEFAULT TRUE,
                    play_count INT DEFAULT 0,
                    comment_count INT DEFAULT 0,
                    like_count INT DEFAULT 0,
                    favorite_count INT DEFAULT 0,
                    hot_score FLOAT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    url_checked_at TIMESTAMP,
                    INDEX idx_title (title),
                    INDEX idx_artist (artist),
                    INDEX idx_platform (platform),
                    INDEX idx_hot_score (hot_score),
                    INDEX idx_created_at (created_at)
                )
            """)
            
            # 创建流派表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS genres (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) NOT NULL,
                    parent_id INT,
                    level INT DEFAULT 1,
                    sort_order INT DEFAULT 0,
                    FOREIGN KEY (parent_id) REFERENCES genres(id)
                )
            """)
            
            # 创建语言表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS languages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) NOT NULL,
                    code VARCHAR(10) UNIQUE
                )
            """)
            
            # 创建场景表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS scenes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) NOT NULL,
                    icon VARCHAR(50)
                )
            """)
            
            # 创建情绪表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS moods (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) NOT NULL,
                    icon VARCHAR(50)
                )
            """)
            
            # 创建年代表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS decades (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(20) NOT NULL,
                    start_year INT,
                    end_year INT
                )
            """)
            
            # 创建自定义标签表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tags (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(50) NOT NULL,
                    parent_id INT,
                    level INT DEFAULT 1,
                    user_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (parent_id) REFERENCES tags(id)
                )
            """)
            
            # 创建歌曲-流派关联表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS song_genres (
                    song_id VARCHAR(50),
                    genre_id INT,
                    PRIMARY KEY (song_id, genre_id),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                    FOREIGN KEY (genre_id) REFERENCES genres(id)
                )
            """)
            
            # 创建歌曲-语言关联表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS song_languages (
                    song_id VARCHAR(50),
                    language_id INT,
                    PRIMARY KEY (song_id, language_id),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                    FOREIGN KEY (language_id) REFERENCES languages(id)
                )
            """)
            
            # 创建歌曲-场景关联表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS song_scenes (
                    song_id VARCHAR(50),
                    scene_id INT,
                    PRIMARY KEY (song_id, scene_id),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                    FOREIGN KEY (scene_id) REFERENCES scenes(id)
                )
            """)
            
            # 创建歌曲-情绪关联表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS song_moods (
                    song_id VARCHAR(50),
                    mood_id INT,
                    PRIMARY KEY (song_id, mood_id),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                    FOREIGN KEY (mood_id) REFERENCES moods(id)
                )
            """)
            
            # 创建歌曲-年代关联表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS song_decades (
                    song_id VARCHAR(50),
                    decade_id INT,
                    PRIMARY KEY (song_id, decade_id),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                    FOREIGN KEY (decade_id) REFERENCES decades(id)
                )
            """)
            
            # 创建歌曲-标签关联表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS song_tags (
                    song_id VARCHAR(50),
                    tag_id INT,
                    PRIMARY KEY (song_id, tag_id),
                    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
                    FOREIGN KEY (tag_id) REFERENCES tags(id)
                )
            """)
            
            # 创建用户表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    email VARCHAR(100) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    role ENUM('super_admin', 'admin', 'editor', 'user') DEFAULT 'user',
                    status ENUM('active', 'disabled') DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login_at TIMESTAMP,
                    reset_token VARCHAR(255),
                    reset_token_expires_at TIMESTAMP
                )
            """)
            
            # 创建操作日志表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS operation_logs (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT,
                    action VARCHAR(50) NOT NULL,
                    target_type VARCHAR(50),
                    target_id VARCHAR(50),
                    details JSON,
                    ip_address VARCHAR(45),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            
            # 创建爬取日志表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS crawl_logs (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    task_type VARCHAR(50) NOT NULL,
                    platform VARCHAR(20),
                    status ENUM('running', 'success', 'failed') DEFAULT 'running',
                    total_count INT DEFAULT 0,
                    success_count INT DEFAULT 0,
                    failed_count INT DEFAULT 0,
                    error_message TEXT,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP
                )
            """)
            
            connection.commit()
            print("数据库初始化成功！")
            
    except Error as e:
        print(f"数据库初始化失败: {e}")
        
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()

if __name__ == '__main__':
    init_database()
```

- [ ] **Step 2: 创建预设数据脚本**

```sql
-- scripts/seed_data.sql

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

-- 插入默认管理员用户（密码: admin123）
INSERT INTO users (username, email, password_hash, role) VALUES
('admin', 'admin@example.com', '$2b$10$your_hashed_password_here', 'super_admin');
```

- [ ] **Step 3: 运行初始化脚本**

Run: `python scripts/init_database.py`
Expected: 输出 "数据库初始化成功！"

Run: `mysql -u root -p music_box < scripts/seed_data.sql`
Expected: 无错误输出

- [ ] **Step 4: 提交代码**

```bash
git add scripts/init_database.py scripts/seed_data.sql
git commit -m "feat: add database initialization scripts"
```

---

### Task 2: Node.js API服务搭建

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`
- Create: `server/src/config.ts`
- Create: `server/prisma/schema.prisma`

- [ ] **Step 1: 初始化Node.js项目**

```bash
cd d:\music_box
mkdir server
cd server
npm init -y
```

- [ ] **Step 2: 安装依赖**

```bash
npm install express cors dotenv
npm install @prisma/client prisma
npm install bcryptjs jsonwebtoken
npm install -D typescript @types/express @types/node @types/cors @types/bcryptjs @types/jsonwebtoken ts-node nodemon
```

- [ ] **Step 3: 创建tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: 更新package.json**

```json
{
  "name": "music-box-api",
  "version": "1.0.0",
  "description": "Music Box API Server",
  "main": "dist/index.js",
  "scripts": {
    "dev": "nodemon src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:push": "prisma db push"
  },
  "dependencies": {
    "@prisma/client": "^5.0.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.1",
    "prisma": "^5.0.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.2",
    "@types/cors": "^2.8.13",
    "@types/express": "^4.17.17",
    "@types/jsonwebtoken": "^9.0.2",
    "@types/node": "^20.4.5",
    "nodemon": "^3.0.1",
    "ts-node": "^10.9.1",
    "typescript": "^5.1.6"
  }
}
```

- [ ] **Step 5: 创建配置文件**

```typescript
// server/src/config.ts
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/music_box',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
};
```

- [ ] **Step 6: 创建Prisma schema**

```prisma
// server/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Song {
  id            String   @id @db.VarChar(50)
  title         String   @db.VarChar(200)
  artist        String   @db.VarChar(200)
  album         String?  @db.VarChar(200)
  albumCover    String?  @db.VarChar(500) @map("album_cover")
  audioUrl      String   @db.VarChar(500) @map("audio_url")
  audioUrlMp3   String?  @db.VarChar(500) @map("audio_url_mp3")
  lyricContent  String?  @db.Text @map("lyric_content")
  coverColor    String?  @db.VarChar(20) @map("cover_color")
  platform      String?  @db.VarChar(20)
  playable      Boolean  @default(true)
  playCount     Int      @default(0) @map("play_count")
  commentCount  Int      @default(0) @map("comment_count")
  likeCount     Int      @default(0) @map("like_count")
  favoriteCount Int      @default(0) @map("favorite_count")
  hotScore      Float    @default(0) @map("hot_score")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  urlCheckedAt  DateTime? @map("url_checked_at")

  genres        SongGenre[]
  languages     SongLanguage[]
  scenes        SongScene[]
  moods         SongMood[]
  decades       SongDecade[]
  tags          SongTag[]

  @@map("songs")
  @@index([title])
  @@index([artist])
  @@index([platform])
  @@index([hotScore])
  @@index([createdAt])
}

model Genre {
  id        Int      @id @default(autoincrement())
  name      String   @db.VarChar(50)
  parentId  Int?     @map("parent_id")
  level     Int      @default(1)
  sortOrder Int      @default(0) @map("sort_order")

  parent    Genre?   @relation("GenreHierarchy", fields: [parentId], references: [id])
  children  Genre[]  @relation("GenreHierarchy")
  songs     SongGenre[]

  @@map("genres")
}

model Language {
  id    Int    @id @default(autoincrement())
  name  String @db.VarChar(50)
  code  String @unique @db.VarChar(10)

  songs SongLanguage[]

  @@map("languages")
}

model Scene {
  id   Int    @id @default(autoincrement())
  name String @db.VarChar(50)
  icon String? @db.VarChar(50)

  songs SongScene[]

  @@map("scenes")
}

model Mood {
  id   Int    @id @default(autoincrement())
  name String @db.VarChar(50)
  icon String? @db.VarChar(50)

  songs SongMood[]

  @@map("moods")
}

model Decade {
  id        Int    @id @default(autoincrement())
  name      String @db.VarChar(20)
  startYear Int?   @map("start_year")
  endYear   Int?   @map("end_year")

  songs     SongDecade[]

  @@map("decades")
}

model Tag {
  id        Int      @id @default(autoincrement())
  name      String   @db.VarChar(50)
  parentId  Int?     @map("parent_id")
  level     Int      @default(1)
  userId    Int?     @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")

  parent    Tag?     @relation("TagHierarchy", fields: [parentId], references: [id])
  children  Tag[]    @relation("TagHierarchy")
  songs     SongTag[]

  @@map("tags")
}

model SongGenre {
  songId  String @map("song_id")
  genreId Int    @map("genre_id")

  song  Song  @relation(fields: [songId], references: [id], onDelete: Cascade)
  genre Genre @relation(fields: [genreId], references: [id])

  @@id([songId, genreId])
  @@map("song_genres")
}

model SongLanguage {
  songId     String @map("song_id")
  languageId Int    @map("language_id")

  song     Song     @relation(fields: [songId], references: [id], onDelete: Cascade)
  language Language @relation(fields: [languageId], references: [id])

  @@id([songId, languageId])
  @@map("song_languages")
}

model SongScene {
  songId  String @map("song_id")
  sceneId Int    @map("scene_id")

  song  Song  @relation(fields: [songId], references: [id], onDelete: Cascade)
  scene Scene @relation(fields: [sceneId], references: [id])

  @@id([songId, sceneId])
  @@map("song_scenes")
}

model SongMood {
  songId String @map("song_id")
  moodId Int    @map("mood_id")

  song Song @relation(fields: [songId], references: [id], onDelete: Cascade)
  mood Mood @relation(fields: [moodId], references: [id])

  @@id([songId, moodId])
  @@map("song_moods")
}

model SongDecade {
  songId   String @map("song_id")
  decadeId Int    @map("decade_id")

  song   Song   @relation(fields: [songId], references: [id], onDelete: Cascade)
  decade Decade @relation(fields: [decadeId], references: [id])

  @@id([songId, decadeId])
  @@map("song_decades")
}

model SongTag {
  songId String @map("song_id")
  tagId  Int    @map("tag_id")

  song Song @relation(fields: [songId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id])

  @@id([songId, tagId])
  @@map("song_tags")
}

model User {
  id                 Int      @id @default(autoincrement())
  username           String   @unique @db.VarChar(50)
  email              String   @unique @db.VarChar(100)
  passwordHash       String   @db.VarChar(255) @map("password_hash")
  role               UserRole @default(user)
  status             UserStatus @default(active)
  createdAt          DateTime @default(now()) @map("created_at")
  lastLoginAt        DateTime? @map("last_login_at")
  resetToken         String?  @db.VarChar(255) @map("reset_token")
  resetTokenExpiresAt DateTime? @map("reset_token_expires_at")

  operationLogs     OperationLog[]

  @@map("users")
}

enum UserRole {
  super_admin
  admin
  editor
  user
}

enum UserStatus {
  active
  disabled
}

model OperationLog {
  id         BigInt   @id @default(autoincrement())
  userId     Int?     @map("user_id")
  action     String   @db.VarChar(50)
  targetType String?  @db.VarChar(50) @map("target_type")
  targetId   String?  @db.VarChar(50) @map("target_id")
  details    Json?
  ipAddress  String?  @db.VarChar(45) @map("ip_address")
  createdAt  DateTime @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id])

  @@map("operation_logs")
}

model CrawlLog {
  id           BigInt      @id @default(autoincrement())
  taskType     String      @db.VarChar(50) @map("task_type")
  platform     String?     @db.VarChar(20)
  status       CrawlStatus @default(running)
  totalCount   Int         @default(0) @map("total_count")
  successCount Int         @default(0) @map("success_count")
  failedCount  Int         @default(0) @map("failed_count")
  errorMessage String?     @db.Text @map("error_message")
  startedAt    DateTime    @default(now()) @map("started_at")
  completedAt  DateTime?   @map("completed_at")

  @@map("crawl_logs")
}

enum CrawlStatus {
  running
  success
  failed
}
```

- [ ] **Step 7: 创建服务入口**

```typescript
// server/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务
app.listen(config.port, () => {
  console.log(`API服务运行在 http://localhost:${config.port}`);
});
```

- [ ] **Step 8: 创建环境变量文件**

```env
# server/.env
DATABASE_URL="mysql://root:password@localhost:3306/music_box"
JWT_SECRET="your-secret-key-here"
REDIS_URL="redis://localhost:6379"
PORT=3000
```

- [ ] **Step 9: 运行Prisma生成和迁移**

```bash
cd d:\music_box\server
npx prisma generate
npx prisma db push
```

- [ ] **Step 10: 测试服务启动**

```bash
npm run dev
```

Expected: 输出 "API服务运行在 http://localhost:3000"

- [ ] **Step 11: 提交代码**

```bash
git add server/
git commit -m "feat: initialize Node.js API server with Prisma"
```

---

### Task 3: 用户认证模块

**Files:**
- Create: `server/src/modules/auth/auth.controller.ts`
- Create: `server/src/modules/auth/auth.service.ts`
- Create: `server/src/modules/auth/auth.routes.ts`
- Create: `server/src/middleware/auth.ts`

- [ ] **Step 1: 创建认证服务**

```typescript
// server/src/modules/auth/auth.service.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

const prisma = new PrismaClient();

export class AuthService {
  async register(username: string, email: string, password: string) {
    // 检查用户名是否已存在
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    });

    if (existingUser) {
      throw new Error('用户名或邮箱已存在');
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        role: 'user'
      }
    });

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };
  }

  async login(username: string, password: string) {
    // 查找用户
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email: username }
        ]
      }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    if (user.status === 'disabled') {
      throw new Error('账户已被禁用');
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('密码错误');
    }

    // 更新最后登录时间
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // 生成JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    };
  }

  async getCurrentUser(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };
  }

  async requestPasswordReset(email: string) {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new Error('邮箱不存在');
    }

    // 生成重置令牌
    const resetToken = Math.random().toString(36).substring(2, 15);
    const resetTokenExpiresAt = new Date(Date.now() + 3600000); // 1小时后过期

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetTokenExpiresAt
      }
    });

    // TODO: 发送重置邮件
    // 实际项目中应该发送邮件，这里简化处理
    return { message: '重置链接已发送到邮箱' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiresAt: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      throw new Error('重置令牌无效或已过期');
    }

    // 加密新密码
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // 更新密码并清除重置令牌
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null
      }
    });

    return { message: '密码重置成功' };
  }
}
```

- [ ] **Step 2: 创建认证控制器**

```typescript
// server/src/modules/auth/auth.controller.ts
import { Request, Response } from 'express';
import { AuthService } from './auth.service';

const authService = new AuthService();

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { username, email, password } = req.body;
      const user = await authService.register(username, email, password);
      res.status(201).json({ success: true, data: user });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { username, password } = req.body;
      const result = await authService.login(username, password);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(401).json({ success: false, error: error.message });
    }
  }

  async getCurrentUser(req: Request, res: Response) {
    try {
      const userId = (req as any).userId;
      const user = await authService.getCurrentUser(userId);
      res.json({ success: true, data: user });
    } catch (error: any) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async requestPasswordReset(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const result = await authService.requestPasswordReset(email);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async resetPassword(req: Request, res: Response) {
    try {
      const { token, newPassword } = req.body;
      const result = await authService.resetPassword(token, newPassword);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}
```

- [ ] **Step 3: 创建认证中间件**

```typescript
// server/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未提供认证令牌' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: number; role: string };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: '无效的认证令牌' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ success: false, error: '权限不足' });
    }
    next();
  };
};
```

- [ ] **Step 4: 创建认证路由**

```typescript
// server/src/modules/auth/auth.routes.ts
import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const authController = new AuthController();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authenticate, authController.getCurrentUser);
router.post('/password-reset-request', authController.requestPasswordReset);
router.post('/password-reset', authController.resetPassword);

export default router;
```

- [ ] **Step 5: 更新服务入口**

```typescript
// server/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './modules/auth/auth.routes';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.use('/api/auth', authRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务
app.listen(config.port, () => {
  console.log(`API服务运行在 http://localhost:${config.port}`);
});
```

- [ ] **Step 6: 测试认证API**

```bash
# 启动服务
npm run dev

# 测试注册
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123"}'

# 测试登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'
```

- [ ] **Step 7: 提交代码**

```bash
git add server/src/modules/auth/ server/src/middleware/auth.ts
git commit -m "feat: add user authentication module"
```

---

### Task 4: 歌曲管理模块

**Files:**
- Create: `server/src/modules/songs/songs.controller.ts`
- Create: `server/src/modules/songs/songs.service.ts`
- Create: `server/src/modules/songs/songs.routes.ts`

- [ ] **Step 1: 创建歌曲服务**

```typescript
// server/src/modules/songs/songs.service.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SongsService {
  async getSongs(filters: any = {}) {
    const {
      genres,
      languages,
      scenes,
      moods,
      decades,
      tags,
      platform,
      sort = 'hot_score',
      order = 'desc',
      page = 1,
      limit = 20
    } = filters;

    const where: any = {};

    // 应用筛选条件
    if (genres) {
      where.genres = {
        some: {
          genreId: { in: genres.split(',').map(Number) }
        }
      };
    }

    if (languages) {
      where.languages = {
        some: {
          languageId: { in: languages.split(',').map(Number) }
        }
      };
    }

    if (scenes) {
      where.scenes = {
        some: {
          sceneId: { in: scenes.split(',').map(Number) }
        }
      };
    }

    if (moods) {
      where.moods = {
        some: {
          moodId: { in: moods.split(',').map(Number) }
        }
      };
    }

    if (decades) {
      where.decades = {
        some: {
          decadeId: { in: decades.split(',').map(Number) }
        }
      };
    }

    if (tags) {
      where.tags = {
        some: {
          tagId: { in: tags.split(',').map(Number) }
        }
      };
    }

    if (platform) {
      where.platform = platform;
    }

    // 排序
    const orderBy: any = {};
    if (sort === 'hot_score') {
      orderBy.hotScore = order;
    } else if (sort === 'created_at') {
      orderBy.createdAt = order;
    } else if (sort === 'title') {
      orderBy.title = order;
    } else if (sort === 'artist') {
      orderBy.artist = order;
    }

    // 分页
    const skip = (page - 1) * limit;

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        include: {
          genres: { include: { genre: true } },
          languages: { include: { language: true } },
          scenes: { include: { scene: true } },
          moods: { include: { mood: true } },
          decades: { include: { decade: true } },
          tags: { include: { tag: true } }
        },
        orderBy,
        skip,
        take: limit
      }),
      prisma.song.count({ where })
    ]);

    return {
      songs,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    };
  }

  async getSongById(id: string) {
    const song = await prisma.song.findUnique({
      where: { id },
      include: {
        genres: { include: { genre: true } },
        languages: { include: { language: true } },
        scenes: { include: { scene: true } },
        moods: { include: { mood: true } },
        decades: { include: { decade: true } },
        tags: { include: { tag: true } }
      }
    });

    if (!song) {
      throw new Error('歌曲不存在');
    }

    return song;
  }

  async createSong(data: any) {
    const {
      id, title, artist, album, albumCover, audioUrl, audioUrlMp3,
      lyricContent, coverColor, platform, genres, languages, scenes,
      moods, decades, tags
    } = data;

    const song = await prisma.song.create({
      data: {
        id,
        title,
        artist,
        album,
        albumCover,
        audioUrl,
        audioUrlMp3,
        lyricContent,
        coverColor,
        platform,
        genres: genres ? {
          create: genres.map((genreId: number) => ({ genreId }))
        } : undefined,
        languages: languages ? {
          create: languages.map((languageId: number) => ({ languageId }))
        } : undefined,
        scenes: scenes ? {
          create: scenes.map((sceneId: number) => ({ sceneId }))
        } : undefined,
        moods: moods ? {
          create: moods.map((moodId: number) => ({ moodId }))
        } : undefined,
        decades: decades ? {
          create: decades.map((decadeId: number) => ({ decadeId }))
        } : undefined,
        tags: tags ? {
          create: tags.map((tagId: number) => ({ tagId }))
        } : undefined
      },
      include: {
        genres: { include: { genre: true } },
        languages: { include: { language: true } },
        scenes: { include: { scene: true } },
        moods: { include: { mood: true } },
        decades: { include: { decade: true } },
        tags: { include: { tag: true } }
      }
    });

    return song;
  }

  async updateSong(id: string, data: any) {
    const {
      title, artist, album, albumCover, audioUrl, audioUrlMp3,
      lyricContent, coverColor, platform, playable, genres, languages,
      scenes, moods, decades, tags
    } = data;

    // 先删除旧的关联关系
    await prisma.songGenre.deleteMany({ where: { songId: id } });
    await prisma.songLanguage.deleteMany({ where: { songId: id } });
    await prisma.songScene.deleteMany({ where: { songId: id } });
    await prisma.songMood.deleteMany({ where: { songId: id } });
    await prisma.songDecade.deleteMany({ where: { songId: id } });
    await prisma.songTag.deleteMany({ where: { songId: id } });

    const song = await prisma.song.update({
      where: { id },
      data: {
        title,
        artist,
        album,
        albumCover,
        audioUrl,
        audioUrlMp3,
        lyricContent,
        coverColor,
        platform,
        playable,
        genres: genres ? {
          create: genres.map((genreId: number) => ({ genreId }))
        } : undefined,
        languages: languages ? {
          create: languages.map((languageId: number) => ({ languageId }))
        } : undefined,
        scenes: scenes ? {
          create: scenes.map((sceneId: number) => ({ sceneId }))
        } : undefined,
        moods: moods ? {
          create: moods.map((moodId: number) => ({ moodId }))
        } : undefined,
        decades: decades ? {
          create: decades.map((decadeId: number) => ({ decadeId }))
        } : undefined,
        tags: tags ? {
          create: tags.map((tagId: number) => ({ tagId }))
        } : undefined
      },
      include: {
        genres: { include: { genre: true } },
        languages: { include: { language: true } },
        scenes: { include: { scene: true } },
        moods: { include: { mood: true } },
        decades: { include: { decade: true } },
        tags: { include: { tag: true } }
      }
    });

    return song;
  }

  async deleteSong(id: string) {
    await prisma.song.delete({ where: { id } });
    return { message: '歌曲已删除' };
  }

  async batchUpdateSongs(songIds: string[], data: any) {
    const results = [];
    for (const songId of songIds) {
      try {
        const song = await this.updateSong(songId, data);
        results.push({ id: songId, success: true });
      } catch (error: any) {
        results.push({ id: songId, success: false, error: error.message });
      }
    }
    return results;
  }

  async batchDeleteSongs(songIds: string[]) {
    const results = [];
    for (const songId of songIds) {
      try {
        await this.deleteSong(songId);
        results.push({ id: songId, success: true });
      } catch (error: any) {
        results.push({ id: songId, success: false, error: error.message });
      }
    }
    return results;
  }

  async checkUrlStatus(id: string) {
    const song = await prisma.song.findUnique({ where: { id } });
    if (!song) {
      throw new Error('歌曲不存在');
    }

    // TODO: 实际检查URL是否有效
    // 这里简化处理
    return {
      id: song.id,
      audioUrl: song.audioUrl,
      playable: song.playable,
      urlCheckedAt: song.urlCheckedAt
    };
  }

  async refreshUrl(id: string) {
    const song = await prisma.song.findUnique({ where: { id } });
    if (!song) {
      throw new Error('歌曲不存在');
    }

    // TODO: 调用各平台API获取新URL
    // 这里简化处理
    const newUrl = song.audioUrl; // 实际应该获取新URL

    await prisma.song.update({
      where: { id },
      data: {
        audioUrl: newUrl,
        playable: true,
        urlCheckedAt: new Date()
      }
    });

    return { message: 'URL已刷新', newUrl };
  }
}
```

- [ ] **Step 2: 创建歌曲控制器**

```typescript
// server/src/modules/songs/songs.controller.ts
import { Request, Response } from 'express';
import { SongsService } from './songs.service';

const songsService = new SongsService();

export class SongsController {
  async getSongs(req: Request, res: Response) {
    try {
      const filters = req.query;
      const result = await songsService.getSongs(filters);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getSongById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const song = await songsService.getSongById(id);
      res.json({ success: true, data: song });
    } catch (error: any) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async createSong(req: Request, res: Response) {
    try {
      const data = req.body;
      const song = await songsService.createSong(data);
      res.status(201).json({ success: true, data: song });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async updateSong(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const song = await songsService.updateSong(id, data);
      res.json({ success: true, data: song });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async deleteSong(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await songsService.deleteSong(id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async batchUpdateSongs(req: Request, res: Response) {
    try {
      const { songIds, ...data } = req.body;
      const result = await songsService.batchUpdateSongs(songIds, data);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async batchDeleteSongs(req: Request, res: Response) {
    try {
      const { songIds } = req.body;
      const result = await songsService.batchDeleteSongs(songIds);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async checkUrlStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await songsService.checkUrlStatus(id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async refreshUrl(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await songsService.refreshUrl(id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}
```

- [ ] **Step 3: 创建歌曲路由**

```typescript
// server/src/modules/songs/songs.routes.ts
import { Router } from 'express';
import { SongsController } from './songs.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const songsController = new SongsController();

// 公开路由
router.get('/', songsController.getSongs);
router.get('/:id', songsController.getSongById);
router.get('/:id/url-status', songsController.checkUrlStatus);

// 需要认证的路由
router.post('/', authenticate, authorize('super_admin', 'admin'), songsController.createSong);
router.put('/:id', authenticate, authorize('super_admin', 'admin', 'editor'), songsController.updateSong);
router.delete('/:id', authenticate, authorize('super_admin', 'admin'), songsController.deleteSong);
router.post('/batch-update', authenticate, authorize('super_admin', 'admin', 'editor'), songsController.batchUpdateSongs);
router.post('/batch-delete', authenticate, authorize('super_admin', 'admin'), songsController.batchDeleteSongs);
router.post('/:id/refresh-url', authenticate, authorize('super_admin', 'admin'), songsController.refreshUrl);

export default router;
```

- [ ] **Step 4: 更新服务入口**

```typescript
// server/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './modules/auth/auth.routes';
import songsRoutes from './modules/songs/songs.routes';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/songs', songsRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务
app.listen(config.port, () => {
  console.log(`API服务运行在 http://localhost:${config.port}`);
});
```

- [ ] **Step 5: 测试歌曲API**

```bash
# 获取歌曲列表
curl http://localhost:3000/api/songs

# 获取单首歌曲
curl http://localhost:3000/api/songs/netease:123456

# 创建歌曲（需要认证）
curl -X POST http://localhost:3000/api/songs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"id":"test:123","title":"Test Song","artist":"Test Artist","audioUrl":"http://example.com/song.mp3"}'
```

- [ ] **Step 6: 提交代码**

```bash
git add server/src/modules/songs/
git commit -m "feat: add songs management module"
```

---

### Task 5: 分类管理模块

**Files:**
- Create: `server/src/modules/genres/genres.controller.ts`
- Create: `server/src/modules/genres/genres.service.ts`
- Create: `server/src/modules/genres/genres.routes.ts`
- Create: `server/src/modules/languages/languages.controller.ts`
- Create: `server/src/modules/languages/languages.service.ts`
- Create: `server/src/modules/languages/languages.routes.ts`
- Create: `server/src/modules/scenes/scenes.controller.ts`
- Create: `server/src/modules/scenes/scenes.service.ts`
- Create: `server/src/modules/scenes/scenes.routes.ts`
- Create: `server/src/modules/moods/moods.controller.ts`
- Create: `server/src/modules/moods/moods.service.ts`
- Create: `server/src/modules/moods/moods.routes.ts`
- Create: `server/src/modules/decades/decades.controller.ts`
- Create: `server/src/modules/decades/decades.service.ts`
- Create: `server/src/modules/decades/decades.routes.ts`
- Create: `server/src/modules/tags/tags.controller.ts`
- Create: `server/src/modules/tags/tags.service.ts`
- Create: `server/src/modules/tags/tags.routes.ts`

- [ ] **Step 1: 创建流派服务**

```typescript
// server/src/modules/genres/genres.service.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class GenresService {
  async getGenres() {
    const genres = await prisma.genre.findMany({
      include: {
        children: true
      },
      orderBy: { sortOrder: 'asc' }
    });

    // 构建树形结构
    const rootGenres = genres.filter(g => !g.parentId);
    const buildTree = (parentId: number | null): any[] => {
      return genres
        .filter(g => g.parentId === parentId)
        .map(g => ({
          ...g,
          children: buildTree(g.id)
        }));
    };

    return buildTree(null);
  }

  async createGenre(data: { name: string; parentId?: number; sortOrder?: number }) {
    const { name, parentId, sortOrder } = data;

    // 计算层级
    let level = 1;
    if (parentId) {
      const parent = await prisma.genre.findUnique({ where: { id: parentId } });
      if (parent) {
        level = parent.level + 1;
      }
    }

    const genre = await prisma.genre.create({
      data: {
        name,
        parentId,
        level,
        sortOrder: sortOrder || 0
      }
    });

    return genre;
  }

  async updateGenre(id: number, data: { name?: string; parentId?: number; sortOrder?: number }) {
    const { name, parentId, sortOrder } = data;

    // 计算层级
    let level = 1;
    if (parentId) {
      const parent = await prisma.genre.findUnique({ where: { id: parentId } });
      if (parent) {
        level = parent.level + 1;
      }
    }

    const genre = await prisma.genre.update({
      where: { id },
      data: {
        name,
        parentId,
        level,
        sortOrder
      }
    });

    return genre;
  }

  async deleteGenre(id: number) {
    // 检查是否有子分类
    const children = await prisma.genre.findMany({ where: { parentId: id } });
    if (children.length > 0) {
      throw new Error('无法删除有子分类的流派');
    }

    // 检查是否有关联的歌曲
    const songGenres = await prisma.songGenre.findMany({ where: { genreId: id } });
    if (songGenres.length > 0) {
      throw new Error('无法删除有关联歌曲的流派');
    }

    await prisma.genre.delete({ where: { id } });
    return { message: '流派已删除' };
  }
}
```

- [ ] **Step 2: 创建流派控制器**

```typescript
// server/src/modules/genres/genres.controller.ts
import { Request, Response } from 'express';
import { GenresService } from './genres.service';

const genresService = new GenresService();

export class GenresController {
  async getGenres(req: Request, res: Response) {
    try {
      const genres = await genresService.getGenres();
      res.json({ success: true, data: genres });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createGenre(req: Request, res: Response) {
    try {
      const data = req.body;
      const genre = await genresService.createGenre(data);
      res.status(201).json({ success: true, data: genre });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async updateGenre(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const genre = await genresService.updateGenre(Number(id), data);
      res.json({ success: true, data: genre });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async deleteGenre(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await genresService.deleteGenre(Number(id));
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}
```

- [ ] **Step 3: 创建流派路由**

```typescript
// server/src/modules/genres/genres.routes.ts
import { Router } from 'express';
import { GenresController } from './genres.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const genresController = new GenresController();

// 公开路由
router.get('/', genresController.getGenres);

// 需要认证的路由
router.post('/', authenticate, authorize('super_admin', 'admin'), genresController.createGenre);
router.put('/:id', authenticate, authorize('super_admin', 'admin'), genresController.updateGenre);
router.delete('/:id', authenticate, authorize('super_admin', 'admin'), genresController.deleteGenre);

export default router;
```

- [ ] **Step 4: 创建其他分类模块（语言、场景、情绪、年代、标签）**

由于篇幅限制，其他分类模块的实现方式类似，可以按照相同的模式创建：
- languages.service.ts, languages.controller.ts, languages.routes.ts
- scenes.service.ts, scenes.controller.ts, scenes.routes.ts
- moods.service.ts, moods.controller.ts, moods.routes.ts
- decades.service.ts, decades.controller.ts, decades.routes.ts
- tags.service.ts, tags.controller.ts, tags.routes.ts

- [ ] **Step 5: 更新服务入口**

```typescript
// server/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './modules/auth/auth.routes';
import songsRoutes from './modules/songs/songs.routes';
import genresRoutes from './modules/genres/genres.routes';
import languagesRoutes from './modules/languages/languages.routes';
import scenesRoutes from './modules/scenes/scenes.routes';
import moodsRoutes from './modules/moods/moods.routes';
import decadesRoutes from './modules/decades/decades.routes';
import tagsRoutes from './modules/tags/tags.routes';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/songs', songsRoutes);
app.use('/api/genres', genresRoutes);
app.use('/api/languages', languagesRoutes);
app.use('/api/scenes', scenesRoutes);
app.use('/api/moods', moodsRoutes);
app.use('/api/decades', decadesRoutes);
app.use('/api/tags', tagsRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务
app.listen(config.port, () => {
  console.log(`API服务运行在 http://localhost:${config.port}`);
});
```

- [ ] **Step 6: 测试分类API**

```bash
# 获取所有流派
curl http://localhost:3000/api/genres

# 创建流派（需要认证）
curl -X POST http://localhost:3000/api/genres \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name":"新流派","sortOrder":11}'

# 获取所有语言
curl http://localhost:3000/api/languages
```

- [ ] **Step 7: 提交代码**

```bash
git add server/src/modules/genres/ server/src/modules/languages/ server/src/modules/scenes/ server/src/modules/moods/ server/src/modules/decades/ server/src/modules/tags/
git commit -m "feat: add classification management modules"
```

---

### Task 6: 数据迁移

**Files:**
- Create: `scripts/migrate_json_to_mysql.py`
- Create: `scripts/validate_migration.py`

- [ ] **Step 1: 创建数据迁移脚本**

```python
# scripts/migrate_json_to_mysql.py
import json
import mysql.connector
from mysql.connector import Error

def migrate_tracks():
    """迁移 tracks.json 数据到 MySQL"""
    
    # 读取 JSON 文件
    with open('shared/tracks.json', 'r', encoding='utf-8') as f:
        tracks = json.load(f)
    
    # 连接数据库
    connection = mysql.connector.connect(
        host='localhost',
        user='root',
        password='your_password',
        database='music_box'
    )
    
    if connection.is_connected():
        cursor = connection.cursor()
        
        # 预定义的分类数据
        genres_map = {
            '流行': 1, '摇滚': 2, '民谣': 3, '电子': 4, 
            '嘻哈': 5, 'R&B': 6, '古典': 7, '爵士': 8
        }
        
        languages_map = {
            '中文': 1, '英文': 2, '日文': 3, '韩文': 4, '粤语': 5
        }
        
        # 迁移每首歌曲
        success_count = 0
        failed_count = 0
        
        for track in tracks:
            try:
                # 插入歌曲
                cursor.execute("""
                    INSERT INTO songs (id, title, artist, album, album_cover, audio_url, 
                                      audio_url_mp3, lyric_content, cover_color, platform, playable)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    track['id'],
                    track['title'],
                    track['artist'],
                    track.get('album', ''),
                    track.get('albumCover', ''),
                    track['audioUrl'],
                    track.get('audioUrlMp3'),
                    track.get('lyricContent', ''),
                    track.get('coverColor', '#17C3B2'),
                    track.get('platform', 'netease'),
                    track.get('playable', True)
                ))
                
                # 自动分类
                auto_classify(cursor, track)
                
                connection.commit()
                success_count += 1
                print(f"迁移成功: {track['title']}")
                
            except Exception as e:
                connection.rollback()
                failed_count += 1
                print(f"迁移失败: {track['title']} - {str(e)}")
        
        cursor.close()
        connection.close()
        
        print(f"\n迁移完成！成功: {success_count}, 失败: {failed_count}")

def auto_classify(cursor, track):
    """自动分类"""
    
    # 语言检测
    title = track.get('title', '')
    artist = track.get('artist', '')
    
    # 简单的语言检测逻辑
    chinese_chars = sum(1 for char in title + artist if '\u4e00' <= char <= '\u9fff')
    if chinese_chars > 0:
        cursor.execute("INSERT INTO song_languages (song_id, language_id) VALUES (%s, %s)", 
                      (track['id'], 1))  # 中文
    
    # 年代推断（简化）
    # 实际应该根据歌曲发布时间推断
    cursor.execute("INSERT INTO song_decades (song_id, decade_id) VALUES (%s, %s)", 
                  (track['id'], 1))  # 2020s

if __name__ == '__main__':
    migrate_tracks()
```

- [ ] **Step 2: 创建迁移验证脚本**

```python
# scripts/validate_migration.py
import json
import mysql.connector
from mysql.connector import Error

def validate_migration():
    """验证迁移数据"""
    
    # 读取 JSON 文件
    with open('shared/tracks.json', 'r', encoding='utf-8') as f:
        json_tracks = json.load(f)
    
    # 连接数据库
    connection = mysql.connector.connect(
        host='localhost',
        user='root',
        password='your_password',
        database='music_box'
    )
    
    if connection.is_connected():
        cursor = connection.cursor()
        
        # 检查数量
        cursor.execute("SELECT COUNT(*) FROM songs")
        db_count = cursor.fetchone()[0]
        json_count = len(json_tracks)
        
        print(f"JSON 歌曲数量: {json_count}")
        print(f"数据库歌曲数量: {db_count}")
        
        if db_count != json_count:
            print("警告: 数量不一致!")
        
        # 检查每首歌曲
        missing_songs = []
        for track in json_tracks:
            cursor.execute("SELECT id FROM songs WHERE id = %s", (track['id'],))
            if not cursor.fetchone():
                missing_songs.append(track['id'])
                print(f"缺失歌曲: {track['title']} ({track['id']})")
        
        if not missing_songs:
            print("所有歌曲迁移成功!")
        else:
            print(f"缺失 {len(missing_songs)} 首歌曲")
        
        # 检查数据完整性
        for track in json_tracks:
            cursor.execute("SELECT title, artist, audio_url FROM songs WHERE id = %s", (track['id'],))
            db_track = cursor.fetchone()
            if db_track:
                if db_track[0] != track['title']:
                    print(f"标题不匹配: {track['id']}")
                if db_track[1] != track['artist']:
                    print(f"艺术家不匹配: {track['id']}")
                if db_track[2] != track['audioUrl']:
                    print(f"音频URL不匹配: {track['id']}")
        
        cursor.close()
        connection.close()

if __name__ == '__main__':
    validate_migration()
```

- [ ] **Step 3: 运行迁移脚本**

```bash
python scripts/migrate_json_to_mysql.py
python scripts/validate_migration.py
```

- [ ] **Step 4: 提交代码**

```bash
git add scripts/migrate_json_to_mysql.py scripts/validate_migration.py
git commit -m "feat: add data migration scripts"
```

---

### Task 7: 管理后台前端

**Files:**
- Create: `web/admin/package.json`
- Create: `web/admin/vite.config.ts`
- Create: `web/admin/src/App.tsx`
- Create: `web/admin/src/main.tsx`
- Create: `web/admin/src/pages/SongsPage.tsx`
- Create: `web/admin/src/pages/GenresPage.tsx`
- Create: `web/admin/src/pages/CrawlPage.tsx`
- Create: `web/admin/src/pages/UsersPage.tsx`
- Create: `web/admin/src/pages/StatsPage.tsx`
- Create: `web/admin/src/services/api.ts`
- Create: `web/admin/src/components/Layout.tsx`
- Create: `web/admin/src/components/SongCard.tsx`

- [ ] **Step 1: 初始化管理后台项目**

```bash
cd d:\music_box\web
npm create vite@latest admin -- --template react-ts
cd admin
npm install
npm install react-router-dom axios
npm install -D @types/react-router-dom
```

- [ ] **Step 2: 创建API服务**

```typescript
// web/admin/src/services/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
});

// 请求拦截器
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  register: (username: string, email: string, password: string) =>
    api.post('/auth/register', { username, email, password }),
  getMe: () => api.get('/auth/me'),
};

export const songsApi = {
  getSongs: (params?: any) => api.get('/songs', { params }),
  getSong: (id: string) => api.get(`/songs/${id}`),
  createSong: (data: any) => api.post('/songs', data),
  updateSong: (id: string, data: any) => api.put(`/songs/${id}`, data),
  deleteSong: (id: string) => api.delete(`/songs/${id}`),
  batchUpdate: (songIds: string[], data: any) =>
    api.post('/songs/batch-update', { songIds, ...data }),
  batchDelete: (songIds: string[]) =>
    api.post('/songs/batch-delete', { songIds }),
};

export const genresApi = {
  getGenres: () => api.get('/genres'),
  createGenre: (data: any) => api.post('/genres', data),
  updateGenre: (id: number, data: any) => api.put(`/genres/${id}`, data),
  deleteGenre: (id: number) => api.delete(`/genres/${id}`),
};

export const languagesApi = {
  getLanguages: () => api.get('/languages'),
  createLanguage: (data: any) => api.post('/languages', data),
};

export const scenesApi = {
  getScenes: () => api.get('/scenes'),
  createScene: (data: any) => api.post('/scenes', data),
};

export const moodsApi = {
  getMoods: () => api.get('/moods'),
  createMood: (data: any) => api.post('/moods', data),
};

export const decadesApi = {
  getDecades: () => api.get('/decades'),
  createDecade: (data: any) => api.post('/decades', data),
};

export const tagsApi = {
  getTags: () => api.get('/tags'),
  createTag: (data: any) => api.post('/tags', data),
};

export const crawlApi = {
  getTasks: () => api.get('/crawl/tasks'),
  startCrawl: (data: any) => api.post('/crawl/start', data),
  refreshAllUrls: () => api.post('/crawl/refresh-all-urls'),
  checkAllUrls: () => api.post('/crawl/check-all-urls'),
};

export const statsApi = {
  getOverview: () => api.get('/stats/overview'),
  getGenres: () => api.get('/stats/genres'),
  getLanguages: () => api.get('/stats/languages'),
  getPlatforms: () => api.get('/stats/platforms'),
  getUrlStatus: () => api.get('/stats/url-status'),
};

export default api;
```

- [ ] **Step 3: 创建布局组件**

```tsx
// web/admin/src/components/Layout.tsx
import React from 'react';
import { Link, Outlet } from 'react-router-dom';

const Layout: React.FC = () => {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#1a1a1a', color: '#fff' }}>
      {/* 侧边栏 */}
      <aside style={{ width: '250px', background: '#2a2a2a', padding: '20px' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '30px' }}>🎵 音乐曲库管理</h1>
        <nav>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li style={{ marginBottom: '10px' }}>
              <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>📊 数据统计</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <Link to="/songs" style={{ color: '#fff', textDecoration: 'none' }}>🎵 歌曲管理</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <Link to="/genres" style={{ color: '#fff', textDecoration: 'none' }}>🎸 流派管理</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <Link to="/crawl" style={{ color: '#fff', textDecoration: 'none' }}>🕷️ 爬取任务</Link>
            </li>
            <li style={{ marginBottom: '10px' }}>
              <Link to="/users" style={{ color: '#fff', textDecoration: 'none' }}>👥 用户管理</Link>
            </li>
          </ul>
        </nav>
      </aside>

      {/* 主内容区 */}
      <main style={{ flex: 1, padding: '20px' }}>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
```

- [ ] **Step 4: 创建歌曲管理页面**

```tsx
// web/admin/src/pages/SongsPage.tsx
import React, { useState, useEffect } from 'react';
import { songsApi, genresApi, languagesApi } from '../services/api';

const SongsPage: React.FC = () => {
  const [songs, setSongs] = useState<any[]>([]);
  const [genres, setGenres] = useState<any[]>([]);
  const [languages, setLanguages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    genres: '',
    languages: '',
    platform: '',
    sort: 'hot_score',
    order: 'desc',
    page: 1,
    limit: 20
  });
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });

  useEffect(() => {
    loadSongs();
    loadGenres();
    loadLanguages();
  }, [filters]);

  const loadSongs = async () => {
    setLoading(true);
    try {
      const result: any = await songsApi.getSongs(filters);
      setSongs(result.data.songs);
      setPagination(result.data.pagination);
    } catch (error) {
      console.error('加载歌曲失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadGenres = async () => {
    try {
      const result: any = await genresApi.getGenres();
      setGenres(result.data);
    } catch (error) {
      console.error('加载流派失败:', error);
    }
  };

  const loadLanguages = async () => {
    try {
      const result: any = await languagesApi.getLanguages();
      setLanguages(result.data);
    } catch (error) {
      console.error('加载语言失败:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('确定要删除这首歌曲吗？')) {
      try {
        await songsApi.deleteSong(id);
        loadSongs();
      } catch (error) {
        console.error('删除失败:', error);
      }
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '20px' }}>歌曲管理</h2>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <select
          value={filters.genres}
          onChange={(e) => setFilters({ ...filters, genres: e.target.value, page: 1 })}
          style={{ padding: '8px', background: '#333', color: '#fff', border: '1px solid #555' }}
        >
          <option value="">所有流派</option>
          {genres.map((genre: any) => (
            <option key={genre.id} value={genre.id}>{genre.name}</option>
          ))}
        </select>

        <select
          value={filters.languages}
          onChange={(e) => setFilters({ ...filters, languages: e.target.value, page: 1 })}
          style={{ padding: '8px', background: '#333', color: '#fff', border: '1px solid #555' }}
        >
          <option value="">所有语言</option>
          {languages.map((lang: any) => (
            <option key={lang.id} value={lang.id}>{lang.name}</option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
          style={{ padding: '8px', background: '#333', color: '#fff', border: '1px solid #555' }}
        >
          <option value="hot_score">热度</option>
          <option value="created_at">添加时间</option>
          <option value="title">名称</option>
          <option value="artist">艺术家</option>
        </select>
      </div>

      {/* 歌曲列表 */}
      {loading ? (
        <div>加载中...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {songs.map((song: any) => (
            <div key={song.id} style={{ background: '#2a2a2a', padding: '15px', borderRadius: '8px' }}>
              <h3 style={{ marginBottom: '10px' }}>{song.title}</h3>
              <p style={{ color: '#aaa', marginBottom: '5px' }}>{song.artist}</p>
              <p style={{ color: '#888', fontSize: '14px' }}>热度: {song.hotScore}</p>
              <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleDelete(song.id)}
                  style={{ padding: '5px 10px', background: '#ff4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '10px' }}>
        <button
          disabled={filters.page <= 1}
          onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          style={{ padding: '8px 16px', background: '#333', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}
        >
          上一页
        </button>
        <span style={{ padding: '8px 16px' }}>
          第 {filters.page} 页 / 共 {pagination.total_pages} 页
        </span>
        <button
          disabled={filters.page >= pagination.total_pages}
          onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
          style={{ padding: '8px 16px', background: '#333', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export default SongsPage;
```

- [ ] **Step 5: 创建数据统计页面**

```tsx
// web/admin/src/pages/StatsPage.tsx
import React, { useState, useEffect } from 'react';
import { statsApi } from '../services/api';

const StatsPage: React.FC = () => {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const result: any = await statsApi.getOverview();
      setOverview(result.data);
    } catch (error) {
      console.error('加载统计失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>加载中...</div>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: '20px' }}>数据统计</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
        <div style={{ background: '#2a2a2a', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <h3 style={{ color: '#4CAF50', fontSize: '36px', marginBottom: '10px' }}>
            {overview?.total_songs || 0}
          </h3>
          <p>歌曲总数</p>
        </div>

        <div style={{ background: '#2a2a2a', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <h3 style={{ color: '#2196F3', fontSize: '36px', marginBottom: '10px' }}>
            {overview?.playable_songs || 0}
          </h3>
          <p>可播放歌曲</p>
        </div>

        <div style={{ background: '#2a2a2a', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <h3 style={{ color: '#ff9800', fontSize: '36px', marginBottom: '10px' }}>
            {overview?.broken_urls || 0}
          </h3>
          <p>失效URL</p>
        </div>

        <div style={{ background: '#2a2a2a', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <h3 style={{ color: '#9C27B0', fontSize: '36px', marginBottom: '10px' }}>
            {overview?.total_users || 0}
          </h3>
          <p>用户总数</p>
        </div>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h3 style={{ marginBottom: '15px' }}>流派分布</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
          {overview?.genre_distribution?.map((genre: any, index: number) => (
            <div key={index} style={{ background: '#333', padding: '10px', borderRadius: '4px' }}>
              <p style={{ fontWeight: 'bold' }}>{genre.name}</p>
              <p style={{ color: '#aaa' }}>{genre.count} 首</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StatsPage;
```

- [ ] **Step 6: 创建主应用和路由**

```tsx
// web/admin/src/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import StatsPage from './pages/StatsPage';
import SongsPage from './pages/SongsPage';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<StatsPage />} />
          <Route path="songs" element={<SongsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
```

- [ ] **Step 7: 更新入口文件**

```tsx
// web/admin/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: 创建CSS文件**

```css
/* web/admin/src/index.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: #1a1a1a;
  color: #fff;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

- [ ] **Step 9: 测试管理后台**

```bash
cd d:\music_box\web\admin
npm run dev
```

Expected: 管理后台运行在 http://localhost:5174

- [ ] **Step 10: 提交代码**

```bash
git add web/admin/
git commit -m "feat: add admin dashboard frontend"
```

---

### Task 8: 分类浏览前端

**Files:**
- Create: `web/browse/package.json`
- Create: `web/browse/vite.config.ts`
- Create: `web/browse/src/App.tsx`
- Create: `web/browse/src/main.tsx`
- Create: `web/browse/src/pages/BrowsePage.tsx`
- Create: `web/browse/src/components/SongCard.tsx`
- Create: `web/browse/src/components/FilterBar.tsx`
- Create: `web/browse/src/services/api.ts`

- [ ] **Step 1: 初始化分类浏览项目**

```bash
cd d:\music_box\web
npm create vite@latest browse -- --template react-ts
cd browse
npm install
npm install react-router-dom axios
```

- [ ] **Step 2: 创建API服务**

```typescript
// web/browse/src/services/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
});

export const songsApi = {
  getSongs: (params?: any) => api.get('/songs', { params }),
  getSong: (id: string) => api.get(`/songs/${id}`),
};

export const genresApi = {
  getGenres: () => api.get('/genres'),
};

export const languagesApi = {
  getLanguages: () => api.get('/languages'),
};

export const scenesApi = {
  getScenes: () => api.get('/scenes'),
};

export const moodsApi = {
  getMoods: () => api.get('/moods'),
};

export const decadesApi = {
  getDecades: () => api.get('/decades'),
};

export default api;
```

- [ ] **Step 3: 创建筛选栏组件**

```tsx
// web/browse/src/components/FilterBar.tsx
import React from 'react';

interface FilterBarProps {
  genres: any[];
  languages: any[];
  scenes: any[];
  moods: any[];
  decades: any[];
  filters: any;
  onFilterChange: (filters: any) => void;
}

const FilterBar: React.FC<FilterBarProps> = ({
  genres, languages, scenes, moods, decades, filters, onFilterChange
}) => {
  const handleGenreClick = (genreId: number) => {
    const current = filters.genres ? filters.genres.split(',').map(Number) : [];
    const newGenres = current.includes(genreId)
      ? current.filter(id => id !== genreId)
      : [...current, genreId];
    onFilterChange({ ...filters, genres: newGenres.join(','), page: 1 });
  };

  const handleLanguageClick = (langId: number) => {
    const current = filters.languages ? filters.languages.split(',').map(Number) : [];
    const newLangs = current.includes(langId)
      ? current.filter(id => id !== langId)
      : [...current, langId];
    onFilterChange({ ...filters, languages: newLangs.join(','), page: 1 });
  };

  const handleSceneClick = (sceneId: number) => {
    const current = filters.scenes ? filters.scenes.split(',').map(Number) : [];
    const newScenes = current.includes(sceneId)
      ? current.filter(id => id !== sceneId)
      : [...current, sceneId];
    onFilterChange({ ...filters, scenes: newScenes.join(','), page: 1 });
  };

  const handleMoodClick = (moodId: number) => {
    const current = filters.moods ? filters.moods.split(',').map(Number) : [];
    const newMoods = current.includes(moodId)
      ? current.filter(id => id !== moodId)
      : [...current, moodId];
    onFilterChange({ ...filters, moods: newMoods.join(','), page: 1 });
  };

  const handleDecadeClick = (decadeId: number) => {
    const current = filters.decades ? filters.decades.split(',').map(Number) : [];
    const newDecades = current.includes(decadeId)
      ? current.filter(id => id !== decadeId)
      : [...current, decadeId];
    onFilterChange({ ...filters, decades: newDecades.join(','), page: 1 });
  };

  const tagStyle = (isSelected: boolean) => ({
    padding: '8px 16px',
    background: isSelected ? '#4CAF50' : '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '20px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  });

  return (
    <div style={{ background: '#2a2a2a', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ marginBottom: '10px' }}>流派</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {genres.map((genre: any) => (
            <button
              key={genre.id}
              onClick={() => handleGenreClick(genre.id)}
              style={tagStyle(filters.genres?.includes(genre.id))}
            >
              {genre.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ marginBottom: '10px' }}>语言</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {languages.map((lang: any) => (
            <button
              key={lang.id}
              onClick={() => handleLanguageClick(lang.id)}
              style={tagStyle(filters.languages?.includes(lang.id))}
            >
              {lang.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ marginBottom: '10px' }}>场景</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {scenes.map((scene: any) => (
            <button
              key={scene.id}
              onClick={() => handleSceneClick(scene.id)}
              style={tagStyle(filters.scenes?.includes(scene.id))}
            >
              {scene.icon} {scene.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ marginBottom: '10px' }}>情绪</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {moods.map((mood: any) => (
            <button
              key={mood.id}
              onClick={() => handleMoodClick(mood.id)}
              style={tagStyle(filters.moods?.includes(mood.id))}
            >
              {mood.icon} {mood.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 style={{ marginBottom: '10px' }}>年代</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {decades.map((decade: any) => (
            <button
              key={decade.id}
              onClick={() => handleDecadeClick(decade.id)}
              style={tagStyle(filters.decades?.includes(decade.id))}
            >
              {decade.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FilterBar;
```

- [ ] **Step 4: 创建歌曲卡片组件**

```tsx
// web/browse/src/components/SongCard.tsx
import React from 'react';

interface SongCardProps {
  song: any;
  onPlay: (song: any) => void;
}

const SongCard: React.FC<SongCardProps> = ({ song, onPlay }) => {
  return (
    <div
      style={{
        background: '#2a2a2a',
        padding: '15px',
        borderRadius: '8px',
        cursor: 'pointer',
        transition: 'transform 0.2s',
      }}
      onClick={() => onPlay(song)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
      }}
    >
      <div
        style={{
          width: '100%',
          height: '150px',
          background: song.albumCover
            ? `url(${song.albumCover}) center/cover`
            : `linear-gradient(135deg, ${song.coverColor || '#4CAF50'}, #333)`,
          borderRadius: '4px',
          marginBottom: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px'
        }}
      >
        {!song.albumCover && '🎵'}
      </div>
      <h3 style={{ marginBottom: '5px', fontSize: '16px' }}>{song.title}</h3>
      <p style={{ color: '#aaa', fontSize: '14px' }}>{song.artist}</p>
      <div style={{ marginTop: '10px', display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        {song.genres?.slice(0, 2).map((g: any) => (
          <span key={g.genre.id} style={{ padding: '2px 8px', background: '#444', borderRadius: '12px', fontSize: '12px' }}>
            {g.genre.name}
          </span>
        ))}
      </div>
    </div>
  );
};

export default SongCard;
```

- [ ] **Step 5: 创建浏览页面**

```tsx
// web/browse/src/pages/BrowsePage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { songsApi, genresApi, languagesApi, scenesApi, moodsApi, decadesApi } from '../services/api';
import FilterBar from '../components/FilterBar';
import SongCard from '../components/SongCard';

const BrowsePage: React.FC = () => {
  const [songs, setSongs] = useState<any[]>([]);
  const [genres, setGenres] = useState<any[]>([]);
  const [languages, setLanguages] = useState<any[]>([]);
  const [scenes, setScenes] = useState<any[]>([]);
  const [moods, setMoods] = useState<any[]>([]);
  const [decades, setDecades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    genres: '',
    languages: '',
    scenes: '',
    moods: '',
    decades: '',
    sort: 'hot_score',
    order: 'desc',
    page: 1,
    limit: 20
  });
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    loadSongs();
  }, [filters]);

  const loadFilters = async () => {
    try {
      const [genresRes, languagesRes, scenesRes, moodsRes, decadesRes] = await Promise.all([
        genresApi.getGenres(),
        languagesApi.getLanguages(),
        scenesApi.getScenes(),
        moodsApi.getMoods(),
        decadesApi.getDecades()
      ]);
      setGenres((genresRes as any).data);
      setLanguages((languagesRes as any).data);
      setScenes((scenesRes as any).data);
      setMoods((moodsRes as any).data);
      setDecades((decadesRes as any).data);
    } catch (error) {
      console.error('加载筛选条件失败:', error);
    }
  };

  const loadSongs = async () => {
    setLoading(true);
    try {
      const result: any = await songsApi.getSongs(filters);
      setSongs(result.data.songs);
      setPagination(result.data.pagination);
    } catch (error) {
      console.error('加载歌曲失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (song: any) => {
    // TODO: 集成播放器
    console.log('播放:', song);
  };

  const handleFilterChange = useCallback((newFilters: any) => {
    setFilters(newFilters);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#fff', padding: '20px' }}>
      <header style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '32px' }}>🎵 音乐曲库</h1>
        <p style={{ color: '#aaa', marginTop: '10px' }}>发现你喜欢的音乐</p>
      </header>

      <FilterBar
        genres={genres}
        languages={languages}
        scenes={scenes}
        moods={moods}
        decades={decades}
        filters={filters}
        onFilterChange={handleFilterChange}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <p>共 {pagination.total} 首歌曲</p>
        <select
          value={filters.sort}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
          style={{ padding: '8px', background: '#333', color: '#fff', border: '1px solid #555' }}
        >
          <option value="hot_score">按热度排序</option>
          <option value="created_at">按时间排序</option>
          <option value="title">按名称排序</option>
          <option value="artist">按艺术家排序</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>加载中...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
          {songs.map((song: any) => (
            <SongCard key={song.id} song={song} onPlay={handlePlay} />
          ))}
        </div>
      )}

      <div style={{ marginTop: '30px', display: 'flex', justifyContent: 'center', gap: '10px' }}>
        <button
          disabled={filters.page <= 1}
          onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          style={{ padding: '10px 20px', background: '#333', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}
        >
          上一页
        </button>
        <span style={{ padding: '10px 20px' }}>
          第 {filters.page} 页 / 共 {pagination.total_pages} 页
        </span>
        <button
          disabled={filters.page >= pagination.total_pages}
          onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
          style={{ padding: '10px 20px', background: '#333', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export default BrowsePage;
```

- [ ] **Step 6: 创建主应用**

```tsx
// web/browse/src/App.tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import BrowsePage from './pages/BrowsePage';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BrowsePage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
```

- [ ] **Step 7: 测试分类浏览**

```bash
cd d:\music_box\web\browse
npm run dev
```

Expected: 分类浏览运行在 http://localhost:5175

- [ ] **Step 8: 提交代码**

```bash
git add web/browse/
git commit -m "feat: add browse page frontend"
```

---

## 执行建议

### 推荐执行顺序

1. **Task 1: 数据库初始化** - 基础设施
2. **Task 2: Node.js API服务搭建** - 后端基础
3. **Task 3: 用户认证模块** - 认证系统
4. **Task 4: 歌曲管理模块** - 核心功能
5. **Task 5: 分类管理模块** - 分类系统
6. **Task 6: 数据迁移** - 数据导入
7. **Task 7: 管理后台前端** - 管理界面
8. **Task 8: 分类浏览前端** - 用户界面

### 执行方式

**方式一：Subagent-Driven（推荐）**
- 使用 `subagent-driven-development` 技能
- 每个Task分配一个独立的子代理
- 任务间可以并行执行

**方式二：Inline Execution**
- 使用 `executing-plans` 技能
- 在当前会话中逐步执行
- 每个Task完成后进行检查点

### 验证命令

每个Task完成后，使用以下命令验证：

```bash
# 检查TypeScript编译
cd d:\music_box\server && npm run build

# 检查前端构建
cd d:\music_box\web\admin && npm run build
cd d:\music_box\web\browse && npm run build

# 运行测试
cd d:\music_box\server && npm test
```

---

**计划完成！**

如有任何问题或需要调整的地方，请告诉我。