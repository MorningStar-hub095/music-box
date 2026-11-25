# 歌曲歌词评论系统设计文档

## 1. 概述

### 1.1 目标
为 Music Box 音乐播放器构建完整的评论系统，支持歌曲级评论和歌词时间点评论，提供发布、编辑、删除、点赞、举报、筛选、排序等功能。

### 1.2 核心需求
- 歌曲级评论：对整首歌曲发表评论
- 歌词时间点评论：在歌词的特定时间点发表评论
- 侧边栏评论面板：点击评论按钮，右侧滑出评论面板，分 Tab 展示
- 歌词行内显示评论图标 + 进度条上标记有评论的时间点
- 敏感内容过滤：关键词库 + 正则变体检测
- 智能排序：热度排序 + 新鲜度加权，支持时间/热度/回复数切换
- 点赞 + 举报机制
- 用户可删除自己的评论，管理员可删除任何评论

## 2. 数据模型

### 2.1 Comment 表
```prisma
model Comment {
  id          BigInt    @id @default(autoincrement())
  userId      Int       @map("user_id")
  songId      String    @map("song_id") @db.VarChar(50)
  commentType String    @map("comment_type") @db.VarChar(10)  // 'song' | 'lyric'
  timestampSec Int?     @map("timestamp_sec")                  // 歌词评论的时间点(秒)
  content     String    @db.Text
  likeCount   Int       @default(0) @map("like_count")
  reportCount Int       @default(0) @map("report_count")
  status      String    @default("active") @db.VarChar(10)     // active | hidden | deleted
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  
  user        User      @relation(fields: [userId], references: [id])
  song        Song      @relation(fields: [songId], references: [id], onDelete: Cascade)
  likes       CommentLike[]
  reports     CommentReport[]

  @@index([songId, commentType, createdAt])
  @@index([songId, commentType, likeCount])
  @@index([songId, timestampSec])
  @@index([userId])
  @@map("comments")
}
```

### 2.2 CommentLike 表
```prisma
model CommentLike {
  id        BigInt   @id @default(autoincrement())
  userId    Int      @map("user_id")
  commentId BigInt   @map("comment_id")
  createdAt DateTime @default(now()) @map("created_at")
  
  user      User     @relation(fields: [userId], references: [id])
  comment   Comment  @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@unique([userId, commentId])
  @@map("comment_likes")
}
```

### 2.3 CommentReport 表
```prisma
model CommentReport {
  id        BigInt   @id @default(autoincrement())
  userId    Int      @map("user_id")
  commentId BigInt   @map("comment_id")
  reason    String   @db.VarChar(200)
  status    String   @default("pending") @db.VarChar(10)  // pending | resolved | dismissed
  createdAt DateTime @default(now()) @map("created_at")
  
  user      User     @relation(fields: [userId], references: [id])
  comment   Comment  @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@unique([userId, commentId])
  @@map("comment_reports")
}
```

## 3. API 设计

### 3.1 评论 CRUD
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/comments` | 发布评论 |
| GET | `/api/comments/song/:songId` | 获取歌曲评论列表（分页） |
| GET | `/api/comments/lyric/:songId` | 获取歌词时间点评论 |
| DELETE | `/api/comments/:id` | 删除评论 |

### 3.2 点赞与举报
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/comments/:id/like` | 点赞/取消点赞（toggle） |
| POST | `/api/comments/:id/report` | 举报评论 |
| GET | `/api/comments/:id/liked` | 查询当前用户是否已点赞 |

### 3.3 管理接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/comments/reports` | 获取举报列表 |
| PUT | `/api/admin/comments/:id/status` | 修改评论状态（隐藏/恢复） |
| DELETE | `/api/admin/comments/:id` | 管理员删除评论 |

### 3.4 查询参数
- `sort`: `hot` | `time` | `replies` (默认 `hot`)
- `page`: 页码 (默认 1)
- `pageSize`: 每页数量 (默认 20, 最大 50)

## 4. 智能排序算法

### 4.1 热度分数计算
```
hotScore = (likeCount * 3 - reportCount * 5) + freshnessBonus

freshnessBonus = max(0, 48 - hoursElapsed) * 0.5
```
- 新评论在 48 小时内获得新鲜度加权
- 举报数权重高于点赞数，确保违规内容快速下沉

### 4.2 排序模式
- `hot`: 按 hotScore 降序
- `time`: 按 createdAt 降序
- `replies`: 按回复数降序（预留，当前无回复功能）

## 5. 敏感内容过滤

### 5.1 关键词过滤
- 维护敏感词库 `server/src/modules/comments/badwords.json`
- 发布评论时检查内容是否包含敏感词
- 匹配到敏感词则拒绝发布，返回提示

### 5.2 正则变体检测
- 支持谐音、符号间隔、数字替换等变体
- 预定义正则规则，如 `/s[e3]x/i` 匹配 "sex", "s3x", "S3X" 等
- 规则库可扩展

## 6. 前端组件设计

### 6.1 CommentPanel（侧边栏评论面板）
- 位置：右侧滑出面板
- Tab 切换：歌曲评论 | 歌词评论
- 排序选择器
- 评论列表（分页加载）
- 评论输入框

### 6.2 CommentItem（单条评论）
- 用户头像 + 用户名
- 评论内容
- 时间显示（相对时间）
- 点赞按钮 + 点赞数
- 举报按钮
- 删除按钮（仅本人或管理员可见）
- 歌词评论额外显示时间点标记

### 6.3 LyricCommentMarkers（歌词评论标记）
- 歌词行右侧显示评论数量气泡
- 进度条上标记有评论的时间点
- 点击气泡/标记展开该时间点的评论列表

### 6.4 CommentInput（评论输入框）
- 文本输入区域
- 字数限制提示（最大500字）
- 发布按钮
- 登录状态检查

## 7. 实施范围

### Phase 1（本次实施）
- 数据库模型 + Prisma migration
- 后端 API（CRUD + 点赞 + 举报 + 过滤）
- 前端 CommentPanel + CommentItem + CommentInput
- 歌词评论在歌词行内显示
- 进度条评论标记

### Phase 2（后续迭代）
- 评论回复功能
- 评论通知
- 管理后台举报处理界面
