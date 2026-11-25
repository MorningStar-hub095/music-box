# 歌曲歌词评论系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Music Box 构建完整的评论系统，支持歌曲级评论和歌词时间点评论，含发布、删除、点赞、举报、敏感词过滤、智能排序功能。

**Architecture:** 后端新增 `comments` 模块（routes → controller → service），使用 Prisma ORM 访问 MySQL。前端新增 `CommentPanel`、`CommentItem`、`CommentInput` 组件，集成到 `App.tsx` 侧边栏。歌词评论标记集成到 `NebulaLyrics` 组件。

**Tech Stack:** Express, Prisma, MySQL, React, TypeScript, Vite

---

## 文件结构

### 后端（新建）
- `server/src/modules/comments/comments.routes.ts` — 路由定义
- `server/src/modules/comments/comments.controller.ts` — 请求处理
- `server/src/modules/comments/comments.service.ts` — 业务逻辑 + 敏感词过滤
- `server/src/modules/comments/badwords.json` — 敏感词库

### 后端（修改）
- `server/prisma/schema.prisma` — 新增 Comment/CommentLike/CommentReport 模型
- `server/src/index.ts` — 注册 comments 路由

### 前端（新建）
- `web/src/components/CommentPanel.tsx` — 侧边栏评论面板
- `web/src/components/CommentItem.tsx` — 单条评论组件
- `web/src/components/CommentInput.tsx` — 评论输入框
- `web/src/components/CommentPanel.css` — 评论面板样式

### 前端（修改）
- `web/src/services/api.ts` — 新增评论 API 函数
- `web/src/App.tsx` — 集成 CommentPanel 侧边栏
- `web/src/components/NebulaLyrics.tsx` — 歌词评论标记

---

## Task 1: 数据库模型

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 添加 Comment 模型**

在 `schema.prisma` 末尾添加：

```prisma
model Comment {
  id          BigInt   @id @default(autoincrement())
  userId      Int      @map("user_id")
  songId      String   @map("song_id") @db.VarChar(50)
  commentType String   @map("comment_type") @db.VarChar(10)
  timestampSec Int?    @map("timestamp_sec")
  content     String   @db.Text
  likeCount   Int      @default(0) @map("like_count")
  reportCount Int      @default(0) @map("report_count")
  status      String   @default("active") @db.VarChar(10)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user      User     @relation(fields: [userId], references: [id])
  song      Song     @relation(fields: [songId], references: [id], onDelete: Cascade)
  likes     CommentLike[]
  reports   CommentReport[]

  @@index([songId, commentType, createdAt])
  @@index([songId, commentType, likeCount])
  @@index([songId, timestampSec])
  @@index([userId])
  @@map("comments")
}

model CommentLike {
  id        BigInt   @id @default(autoincrement())
  userId    Int      @map("user_id")
  commentId BigInt   @map("comment_id")
  createdAt DateTime @default(now()) @map("created_at")

  user    User    @relation(fields: [userId], references: [id])
  comment Comment @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@unique([userId, commentId])
  @@map("comment_likes")
}

model CommentReport {
  id        BigInt   @id @default(autoincrement())
  userId    Int      @map("user_id")
  commentId BigInt   @map("comment_id")
  reason    String   @db.VarChar(200)
  status    String   @default("pending") @db.VarChar(10)
  createdAt DateTime @default(now()) @map("created_at")

  user    User    @relation(fields: [userId], references: [id])
  comment Comment @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@unique([userId, commentId])
  @@map("comment_reports")
}
```

- [ ] **Step 2: 在 Song 模型添加 relation**

在 `Song` 模型的 `urlRefreshLogs` 行后添加：

```prisma
  comments      Comment[]
```

- [ ] **Step 3: 在 User 模型添加 relation**

在 `User` 模型的 `capsules` 行后添加：

```prisma
  comments        Comment[]
  commentLikes    CommentLike[]
  commentReports  CommentReport[]
```

- [ ] **Step 4: 运行 Prisma migration**

```bash
cd d:\music_box\server
npx prisma migrate dev --name add-comments
```

Expected: Migration created successfully, Prisma Client regenerated.

- [ ] **Step 5: 验证**

```bash
npx prisma studio
```

Expected: `comments`, `comment_likes`, `comment_reports` 表出现在数据库中。

---

## Task 2: 敏感词库

**Files:**
- Create: `server/src/modules/comments/badwords.json`

- [ ] **Step 1: 创建敏感词库文件**

```json
{
  "keywords": [
    "傻逼", "操你", "他妈", "狗日", "混蛋", "王八蛋", "去死",
    "废物", "垃圾人", "白痴", "智障", "脑残", "神经病",
    "fuck", "shit", "bitch", "asshole", "damn",
    "色情", "赌博", "毒品", "枪支", "暴力"
  ],
  "regexPatterns": [
    "s[e3]x",
    "f[u\\*]c?k",
    "s[h\\*][i1\\*]t",
    "b[i1\\*]tch",
    "a[s$]{2}"
  ]
}
```

- [ ] **Step 2: 验证文件可读取**

```bash
cd d:\music_box\server
node -e "const d=require('./src/modules/comments/badwords.json'); console.log('keywords:', d.keywords.length, 'patterns:', d.regexPatterns.length)"
```

Expected: `keywords: 25 patterns: 5`

---

## Task 3: 后端 Service 层

**Files:**
- Create: `server/src/modules/comments/comments.service.ts`

- [ ] **Step 1: 创建 comments.service.ts**

```typescript
import prisma from '../../lib/prisma';
import badwordsData from './badwords.json';

// === 敏感词过滤 ===

const BADWORDS: string[] = badwordsData.keywords;
const BADWORD_PATTERNS: RegExp[] = badwordsData.regexPatterns.map(p => new RegExp(p, 'i'));

function checkContent(content: string): { ok: boolean; reason?: string } {
  const lower = content.toLowerCase();
  for (const word of BADWORDS) {
    if (lower.includes(word.toLowerCase())) {
      return { ok: false, reason: '评论包含敏感词，请修改后重试' };
    }
  }
  for (const pattern of BADWORD_PATTERNS) {
    if (pattern.test(content)) {
      return { ok: false, reason: '评论包含敏感词，请修改后重试' };
    }
  }
  if (content.trim().length === 0) {
    return { ok: false, reason: '评论内容不能为空' };
  }
  if (content.length > 500) {
    return { ok: false, reason: '评论内容不能超过500字' };
  }
  return { ok: true };
}

// === 热度分数计算 ===

function calcHotScore(likeCount: number, reportCount: number, createdAt: Date): number {
  const hoursElapsed = (Date.now() - createdAt.getTime()) / 3600000;
  const freshnessBonus = Math.max(0, 48 - hoursElapsed) * 0.5;
  return likeCount * 3 - reportCount * 5 + freshnessBonus;
}

// === 评论 CRUD ===

export async function createComment(
  userId: number,
  songId: string,
  commentType: 'song' | 'lyric',
  content: string,
  timestampSec?: number
) {
  const check = checkContent(content);
  if (!check.ok) return { error: check.reason };

  const comment = await prisma.comment.create({
    data: {
      userId,
      songId,
      commentType,
      timestampSec: commentType === 'lyric' ? timestampSec ?? null : null,
      content: content.trim(),
    },
    include: { user: { select: { id: true, username: true } } },
  });

  // 更新歌曲评论计数
  await prisma.song.update({
    where: { id: songId },
    data: { commentCount: { increment: 1 } },
  });

  return { comment };
}

export async function getSongComments(
  songId: string,
  sort: 'hot' | 'time' = 'hot',
  page: number = 1,
  pageSize: number = 20
) {
  const skip = (page - 1) * pageSize;
  const where = { songId, commentType: 'song', status: 'active' };

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      include: { user: { select: { id: true, username: true } } },
      orderBy: sort === 'hot'
        ? [{ likeCount: 'desc' }, { createdAt: 'desc' }]
        : { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.comment.count({ where }),
  ]);

  // 计算热度分数用于排序
  const sorted = sort === 'hot'
    ? comments.sort((a, b) => calcHotScore(b.likeCount, b.reportCount, b.createdAt) - calcHotScore(a.likeCount, a.reportCount, a.createdAt))
    : comments;

  return { comments: sorted, total, page, pageSize };
}

export async function getLyricComments(songId: string) {
  const comments = await prisma.comment.findMany({
    where: { songId, commentType: 'lyric', status: 'active' },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { timestampSec: 'asc' },
  });

  // 按时间点分组
  const grouped: Record<number, typeof comments> = {};
  for (const c of comments) {
    const key = c.timestampSec ?? 0;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  return { comments, grouped };
}

export async function deleteComment(commentId: bigint, userId: number, isAdmin: boolean) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) return { error: '评论不存在' };
  if (!isAdmin && comment.userId !== userId) return { error: '无权删除此评论' };

  await prisma.comment.update({
    where: { id: commentId },
    data: { status: 'deleted' },
  });

  await prisma.song.update({
    where: { id: comment.songId },
    data: { commentCount: { decrement: 1 } },
  });

  return { success: true };
}

// === 点赞 ===

export async function toggleLike(commentId: bigint, userId: number) {
  const existing = await prisma.commentLike.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });

  if (existing) {
    await prisma.commentLike.delete({ where: { id: existing.id } });
    await prisma.comment.update({
      where: { id: commentId },
      data: { likeCount: { decrement: 1 } },
    });
    return { liked: false };
  } else {
    await prisma.commentLike.create({ data: { userId, commentId } });
    await prisma.comment.update({
      where: { id: commentId },
      data: { likeCount: { increment: 1 } },
    });
    return { liked: true };
  }
}

export async function isLiked(commentId: bigint, userId: number) {
  const existing = await prisma.commentLike.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });
  return { liked: !!existing };
}

// === 举报 ===

export async function reportComment(commentId: bigint, userId: number, reason: string) {
  const existing = await prisma.commentReport.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });
  if (existing) return { error: '您已举报过此评论' };

  await prisma.commentReport.create({ data: { userId, commentId, reason } });
  await prisma.comment.update({
    where: { id: commentId },
    data: { reportCount: { increment: 1 } },
  });

  // 自动隐藏：举报数 >= 5 时隐藏评论
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (comment && comment.reportCount >= 5) {
    await prisma.comment.update({
      where: { id: commentId },
      data: { status: 'hidden' },
    });
  }

  return { success: true };
}

// === 管理接口 ===

export async function getReports(page: number = 1, pageSize: number = 20) {
  const skip = (page - 1) * pageSize;
  const [reports, total] = await Promise.all([
    prisma.commentReport.findMany({
      where: { status: 'pending' },
      include: {
        user: { select: { id: true, username: true } },
        comment: { include: { user: { select: { id: true, username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.commentReport.count({ where: { status: 'pending' } }),
  ]);
  return { reports, total, page, pageSize };
}

export async function updateCommentStatus(commentId: bigint, status: 'active' | 'hidden') {
  await prisma.comment.update({ where: { id: commentId }, data: { status } });
  return { success: true };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd d:\music_box\server
npx tsc --noEmit src/modules/comments/comments.service.ts
```

Expected: No errors.

---

## Task 4: 后端 Controller 层

**Files:**
- Create: `server/src/modules/comments/comments.controller.ts`

- [ ] **Step 1: 创建 comments.controller.ts**

```typescript
import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import * as commentService from './comments.service';

export class CommentsController {
  async create(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const { songId, commentType, content, timestampSec } = req.body;

      if (!songId || !commentType || !content) {
        return res.status(400).json({ success: false, error: '缺少必填字段' });
      }
      if (!['song', 'lyric'].includes(commentType)) {
        return res.status(400).json({ success: false, error: 'commentType 必须是 song 或 lyric' });
      }

      const result = await commentService.createComment(userId, songId, commentType, content, timestampSec);
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true, data: result.comment });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getSongComments(req: AuthRequest, res: Response) {
    try {
      const { songId } = req.params;
      const sort = (req.query.sort as string) || 'hot';
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);

      const result = await commentService.getSongComments(songId, sort as 'hot' | 'time', page, pageSize);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getLyricComments(req: AuthRequest, res: Response) {
    try {
      const { songId } = req.params;
      const result = await commentService.getLyricComments(songId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteComment(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const isAdmin = ['admin', 'super_admin'].includes(req.user!.role);

      const result = await commentService.deleteComment(commentId, userId, isAdmin);
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async toggleLike(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const result = await commentService.toggleLike(commentId, userId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async isLiked(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const result = await commentService.isLiked(commentId, userId);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async report(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const userId = req.user!.id;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({ success: false, error: '请提供举报原因' });
      }

      const result = await commentService.reportComment(commentId, userId, reason.trim());
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getReports(req: AuthRequest, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);
      const result = await commentService.getReports(page, pageSize);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateStatus(req: AuthRequest, res: Response) {
    try {
      const commentId = BigInt(req.params.id);
      const { status } = req.body;
      if (!['active', 'hidden'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status 必须是 active 或 hidden' });
      }
      const result = await commentService.updateCommentStatus(commentId, status);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd d:\music_box\server
npx tsc --noEmit src/modules/comments/comments.controller.ts
```

Expected: No errors.

---

## Task 5: 后端 Routes 层

**Files:**
- Create: `server/src/modules/comments/comments.routes.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: 创建 comments.routes.ts**

```typescript
import { Router } from 'express';
import { CommentsController } from './comments.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { sanitizeInput } from '../../middleware/sanitize';
import { createRateLimit } from '../../middleware/rateLimit';

const router = Router();
const controller = new CommentsController();

router.use(sanitizeInput);

const createLimiter = createRateLimit(60 * 1000, 10, '评论发布过于频繁，请稍后再试');
const reportLimiter = createRateLimit(60 * 1000, 5, '举报操作过于频繁，请稍后再试');

// 公开接口（不需要登录）
router.get('/song/:songId', controller.getSongComments.bind(controller));
router.get('/lyric/:songId', controller.getLyricComments.bind(controller));

// 需要登录的接口
router.post('/', authenticate, createLimiter, controller.create.bind(controller));
router.delete('/:id', authenticate, controller.deleteComment.bind(controller));
router.post('/:id/like', authenticate, controller.toggleLike.bind(controller));
router.get('/:id/liked', authenticate, controller.isLiked.bind(controller));
router.post('/:id/report', authenticate, reportLimiter, controller.report.bind(controller));

// 管理员接口
router.get('/admin/reports', authenticate, authorize('admin', 'super_admin'), controller.getReports.bind(controller));
router.put('/admin/:id/status', authenticate, authorize('admin', 'super_admin'), controller.updateStatus.bind(controller));

export default router;
```

- [ ] **Step 2: 在 index.ts 注册路由**

在 `server/src/index.ts` 的 import 区域添加：

```typescript
import commentsRoutes from './modules/comments/comments.routes';
```

在路由注册区域（`app.use('/api/time-machine', timeMachineRoutes)` 之后）添加：

```typescript
app.use('/api/comments', commentsRoutes);
```

- [ ] **Step 3: 编译并验证服务器启动**

```bash
cd d:\music_box\server
npx tsc --noEmit
node dist/index.js &
sleep 3
curl http://localhost:49200/api/comments/song/test
```

Expected: `{"success":true,"data":{"comments":[],"total":0,"page":1,"pageSize":20}}`

---

## Task 6: 前端 API 函数

**Files:**
- Modify: `web/src/services/api.ts`

- [ ] **Step 1: 在 api.ts 末尾添加评论 API**

```typescript
// === 评论 API ===

export interface CommentData {
  id: string;
  userId: number;
  songId: string;
  commentType: 'song' | 'lyric';
  timestampSec: number | null;
  content: string;
  likeCount: number;
  reportCount: number;
  status: string;
  createdAt: string;
  user: { id: number; username: string };
}

export interface CommentListResult {
  comments: CommentData[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LyricCommentsResult {
  comments: CommentData[];
  grouped: Record<string, CommentData[]>;
}

export const commentsApi = {
  getSongComments: (songId: string, sort = 'hot', page = 1, pageSize = 20) =>
    request<CommentListResult>(`/comments/song/${songId}?sort=${sort}&page=${page}&pageSize=${pageSize}`),

  getLyricComments: (songId: string) =>
    request<LyricCommentsResult>(`/comments/lyric/${songId}`),

  create: (songId: string, commentType: 'song' | 'lyric', content: string, timestampSec?: number) =>
    request<CommentData>('/comments', {
      method: 'POST',
      body: JSON.stringify({ songId, commentType, content, timestampSec }),
    }),

  delete: (id: string) =>
    request<void>(`/comments/${id}`, { method: 'DELETE' }),

  toggleLike: (id: string) =>
    request<{ liked: boolean }>(`/comments/${id}/like`, { method: 'POST' }),

  isLiked: (id: string) =>
    request<{ liked: boolean }>(`/comments/${id}/liked`),

  report: (id: string, reason: string) =>
    request<void>(`/comments/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
```

- [ ] **Step 2: 验证前端编译**

```bash
cd d:\music_box\web
npx tsc --noEmit
```

Expected: No errors.

---

## Task 7: 前端 CommentInput 组件

**Files:**
- Create: `web/src/components/CommentInput.tsx`

- [ ] **Step 1: 创建 CommentInput.tsx**

```tsx
import React, { useState } from 'react';

interface CommentInputProps {
  onSubmit: (content: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export default function CommentInput({ onSubmit, placeholder = '写下你的评论...', disabled }: CommentInputProps) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(content.trim());
      setContent('');
    } catch (err: any) {
      setError(err.message || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="comment-input">
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setError(null); }}
        placeholder={placeholder}
        maxLength={500}
        rows={3}
        disabled={disabled || submitting}
      />
      <div className="comment-input-footer">
        <span className="char-count">{content.length}/500</span>
        {error && <span className="error">{error}</span>}
        <button onClick={handleSubmit} disabled={!content.trim() || submitting || disabled}>
          {submitting ? '发布中...' : '发布'}
        </button>
      </div>
    </div>
  );
}
```

---

## Task 8: 前端 CommentItem 组件

**Files:**
- Create: `web/src/components/CommentItem.tsx`

- [ ] **Step 1: 创建 CommentItem.tsx**

```tsx
import React, { useState } from 'react';
import type { CommentData } from '../services/api';
import { commentsApi } from '../services/api';

interface CommentItemProps {
  comment: CommentData;
  currentUserId?: number;
  isAdmin?: boolean;
  onDelete?: (id: string) => void;
  showTimestamp?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString();
}

export default function CommentItem({ comment, currentUserId, isAdmin, onDelete, showTimestamp }: CommentItemProps) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const isOwner = currentUserId === comment.userId;
  const canDelete = isOwner || isAdmin;

  const handleLike = async () => {
    try {
      const result = await commentsApi.toggleLike(String(comment.id));
      setLiked(result.liked);
      setLikeCount(prev => result.liked ? prev + 1 : prev - 1);
    } catch {}
  };

  const handleReport = async () => {
    if (!reportReason.trim()) return;
    try {
      await commentsApi.report(String(comment.id), reportReason.trim());
      setShowReport(false);
      setReportReason('');
      alert('举报已提交');
    } catch (err: any) {
      alert(err.message || '举报失败');
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定要删除这条评论吗？')) return;
    try {
      await commentsApi.delete(String(comment.id));
      onDelete?.(String(comment.id));
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="comment-item">
      <div className="comment-header">
        <span className="username">{comment.user.username}</span>
        {showTimestamp && comment.timestampSec != null && (
          <span className="timestamp-badge">{formatTime(comment.timestampSec)}</span>
        )}
        <span className="time">{relativeTime(comment.createdAt)}</span>
      </div>
      <div className="comment-content">{comment.content}</div>
      <div className="comment-actions">
        <button className={`like-btn ${liked ? 'liked' : ''}`} onClick={handleLike}>
          {liked ? '👍' : '👍'} {likeCount > 0 ? likeCount : ''}
        </button>
        <button className="report-btn" onClick={() => setShowReport(!showReport)}>举报</button>
        {canDelete && <button className="delete-btn" onClick={handleDelete}>删除</button>}
      </div>
      {showReport && (
        <div className="report-form">
          <input
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="请输入举报原因"
            maxLength={200}
          />
          <button onClick={handleReport}>提交</button>
          <button onClick={() => setShowReport(false)}>取消</button>
        </div>
      )}
    </div>
  );
}
```

---

## Task 9: 前端 CommentPanel 组件

**Files:**
- Create: `web/src/components/CommentPanel.tsx`
- Create: `web/src/components/CommentPanel.css`

- [ ] **Step 1: 创建 CommentPanel.tsx**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { commentsApi, type CommentData, type CommentListResult, type LyricCommentsResult } from '../services/api';
import CommentItem from './CommentItem';
import CommentInput from './CommentInput';
import './CommentPanel.css';

interface CommentPanelProps {
  songId: string | null;
  show: boolean;
  onClose: () => void;
  currentUserId?: number;
  isAdmin?: boolean;
  currentTimeSec?: number;
}

export default function CommentPanel({ songId, show, onClose, currentUserId, isAdmin, currentTimeSec }: CommentPanelProps) {
  const [tab, setTab] = useState<'song' | 'lyric'>('song');
  const [sort, setSort] = useState<'hot' | 'time'>('hot');
  const [songComments, setSongComments] = useState<CommentListResult | null>(null);
  const [lyricComments, setLyricComments] = useState<LyricCommentsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const fetchComments = useCallback(async () => {
    if (!songId) return;
    setLoading(true);
    try {
      if (tab === 'song') {
        const data = await commentsApi.getSongComments(songId, sort, page);
        setSongComments(data);
      } else {
        const data = await commentsApi.getLyricComments(songId);
        setLyricComments(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [songId, tab, sort, page]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const handleCreate = async (content: string) => {
    if (!songId) return;
    await commentsApi.create(songId, tab, content, tab === 'lyric' ? currentTimeSec : undefined);
    await fetchComments();
  };

  const handleDelete = (id: string) => {
    if (tab === 'song' && songComments) {
      setSongComments({
        ...songComments,
        comments: songComments.comments.filter(c => String(c.id) !== id),
        total: songComments.total - 1,
      });
    }
  };

  if (!show || !songId) return null;

  return (
    <div className="comment-panel-overlay" onClick={onClose}>
      <div className="comment-panel" onClick={(e) => e.stopPropagation()}>
        <div className="comment-panel-header">
          <h3>评论</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="comment-tabs">
          <button className={tab === 'song' ? 'active' : ''} onClick={() => { setTab('song'); setPage(1); }}>
            歌曲评论
          </button>
          <button className={tab === 'lyric' ? 'active' : ''} onClick={() => { setTab('lyric'); setPage(1); }}>
            歌词评论
          </button>
        </div>

        {tab === 'song' && (
          <div className="sort-selector">
            <button className={sort === 'hot' ? 'active' : ''} onClick={() => setSort('hot')}>最热</button>
            <button className={sort === 'time' ? 'active' : ''} onClick={() => setSort('time')}>最新</button>
          </div>
        )}

        {currentUserId && (
          <CommentInput
            onSubmit={handleCreate}
            placeholder={tab === 'lyric' ? `在 ${currentTimeSec != null ? Math.floor(currentTimeSec / 60) + ':' + String(Math.floor(currentTimeSec % 60)).padStart(2, '0') : '当前时间'} 发表评论...` : '写下你的评论...'}
          />
        )}

        <div className="comment-list">
          {loading && <div className="loading">加载中...</div>}

          {tab === 'song' && songComments && (
            <>
              {songComments.comments.length === 0 ? (
                <div className="empty">暂无评论，快来抢沙发吧！</div>
              ) : (
                <>
                  {songComments.comments.map((c) => (
                    <CommentItem
                      key={String(c.id)}
                      comment={c}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      onDelete={handleDelete}
                    />
                  ))}
                  {songComments.total > songComments.pageSize && (
                    <div className="pagination">
                      <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                      <span>{page} / {Math.ceil(songComments.total / songComments.pageSize)}</span>
                      <button disabled={page >= Math.ceil(songComments.total / songComments.pageSize)} onClick={() => setPage(p => p + 1)}>下一页</button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'lyric' && lyricComments && (
            <>
              {lyricComments.comments.length === 0 ? (
                <div className="empty">暂无歌词评论</div>
              ) : (
                lyricComments.comments.map((c) => (
                  <CommentItem
                    key={String(c.id)}
                    comment={c}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    onDelete={handleDelete}
                    showTimestamp
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 CommentPanel.css**

```css
.comment-panel-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.comment-panel {
  width: 400px;
  max-width: 90vw;
  height: 100vh;
  background: #1a1a2e;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
}

.comment-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.comment-panel-header h3 {
  margin: 0;
  font-size: 18px;
  color: #fff;
}

.close-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 24px;
  cursor: pointer;
  padding: 0 4px;
}

.close-btn:hover { color: #fff; }

.comment-tabs {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.comment-tabs button {
  flex: 1;
  padding: 10px;
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
}

.comment-tabs button.active {
  color: #7c4dff;
  border-bottom-color: #7c4dff;
}

.sort-selector {
  display: flex;
  gap: 8px;
  padding: 8px 20px;
}

.sort-selector button {
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #999;
  cursor: pointer;
  font-size: 12px;
}

.sort-selector button.active {
  background: rgba(124, 77, 255, 0.2);
  border-color: #7c4dff;
  color: #7c4dff;
}

.comment-input {
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.comment-input textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e0e0e0;
  padding: 8px 12px;
  font-size: 14px;
  resize: none;
  font-family: inherit;
}

.comment-input textarea:focus {
  outline: none;
  border-color: #7c4dff;
}

.comment-input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.char-count {
  font-size: 12px;
  color: #666;
}

.error {
  font-size: 12px;
  color: #ff5252;
}

.comment-input-footer button {
  padding: 6px 16px;
  background: #7c4dff;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}

.comment-input-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.comment-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.comment-item {
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.username {
  font-size: 13px;
  font-weight: 600;
  color: #b388ff;
}

.timestamp-badge {
  font-size: 11px;
  background: rgba(124, 77, 255, 0.2);
  color: #7c4dff;
  padding: 1px 6px;
  border-radius: 4px;
}

.time {
  font-size: 12px;
  color: #666;
  margin-left: auto;
}

.comment-content {
  font-size: 14px;
  line-height: 1.5;
  color: #d0d0d0;
  word-break: break-word;
}

.comment-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.comment-actions button {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}

.comment-actions button:hover { color: #fff; }
.like-btn.liked { color: #7c4dff; }
.delete-btn:hover { color: #ff5252; }

.report-form {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.report-form input {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #e0e0e0;
  padding: 4px 8px;
  font-size: 12px;
}

.report-form button {
  padding: 4px 10px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 12px;
}

.report-form button:first-of-type {
  background: #ff5252;
  color: #fff;
}

.loading, .empty {
  text-align: center;
  padding: 40px 20px;
  color: #666;
  font-size: 14px;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.pagination button {
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #999;
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pagination span {
  font-size: 13px;
  color: #888;
}
```

---

## Task 10: 集成到 App.tsx

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 添加 CommentPanel import 和状态**

在 App.tsx 的 import 区域添加：

```typescript
import CommentPanel from './components/CommentPanel';
```

在组件内部添加状态：

```typescript
const [showCommentPanel, setShowCommentPanel] = useState(false);
```

- [ ] **Step 2: 在 JSX 中添加 CommentPanel**

在 `</div>` 闭合标签前（`UserLoginModal` 之后）添加：

```tsx
<CommentPanel
  songId={currentTrack?.id ?? null}
  show={showCommentPanel}
  onClose={() => setShowCommentPanel(false)}
  currentUserId={userId}
  isAdmin={userRole === 'admin' || userRole === 'super_admin'}
  currentTimeSec={position != null ? Math.floor(position / 1000) : undefined}
/>
```

- [ ] **Step 3: 添加评论按钮到播放控制栏**

在播放控制栏找到合适位置添加评论按钮：

```tsx
<button
  className="control-btn comment-btn"
  onClick={() => setShowCommentPanel(!showCommentPanel)}
  title="评论"
>
  💬
</button>
```

- [ ] **Step 4: 验证前端编译**

```bash
cd d:\music_box\web
npx tsc --noEmit
npm run build
```

Expected: Build successful.

---

## Task 11: 歌词评论标记集成

**Files:**
- Modify: `web/src/components/NebulaLyrics.tsx`

- [ ] **Step 1: 添加歌词评论数据获取**

在 `NebulaLyricsProps` 接口中添加：

```typescript
lyricCommentCounts?: Record<number, number>;
onLyricCommentClick?: (timestampSec: number) => void;
```

- [ ] **Step 2: 在歌词行渲染中添加评论气泡**

在每行歌词渲染中，当 `lyricCommentCounts` 有该时间点的评论时，显示评论图标：

```tsx
{lyricCommentCounts && lyricCommentCounts[line.time] > 0 && (
  <span
    className="lyric-comment-badge"
    onClick={(e) => { e.stopPropagation(); onLyricCommentClick?.(line.time); }}
    title={`${lyricCommentCounts[line.time]}条评论`}
  >
    💬 {lyricCommentCounts[line.time]}
  </span>
)}
```

- [ ] **Step 3: 添加 CSS 样式**

在 `NebulaLyrics.css` 中添加：

```css
.lyric-comment-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
  padding: 1px 6px;
  background: rgba(124, 77, 255, 0.2);
  border-radius: 10px;
  font-size: 11px;
  color: #b388ff;
  cursor: pointer;
  vertical-align: middle;
}

.lyric-comment-badge:hover {
  background: rgba(124, 77, 255, 0.4);
}
```

---

## Task 12: 构建与验证

- [ ] **Step 1: 编译后端**

```bash
cd d:\music_box\server
npx prisma generate
npx tsc
```

Expected: No errors.

- [ ] **Step 2: 构建前端**

```bash
cd d:\music_box\web
npm run build
```

Expected: Build successful.

- [ ] **Step 3: 启动服务器并测试 API**

```bash
cd d:\music_box\server
node dist/index.js &
sleep 3

# 测试发布评论
curl -X POST http://localhost:49200/api/comments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"songId":"netease:28059417","commentType":"song","content":"这首歌真好听！"}'

# 测试获取评论
curl http://localhost:49200/api/comments/song/netease:28059417

# 测试敏感词过滤
curl -X POST http://localhost:49200/api/comments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"songId":"netease:28059417","commentType":"song","content":"这是傻逼歌"}'
```

Expected:
- 发布评论: `{"success":true,"data":{...}}`
- 获取评论: `{"success":true,"data":{"comments":[...],"total":1,...}}`
- 敏感词: `{"success":false,"error":"评论包含敏感词，请修改后重试"}`

- [ ] **Step 4: 验证前端页面**

打开 http://localhost:49200，播放一首歌曲，点击评论按钮，验证：
- 侧边栏评论面板正常显示
- 可以发布歌曲评论
- 可以切换排序方式
- 可以点赞和举报
- 歌词评论 Tab 正常显示
