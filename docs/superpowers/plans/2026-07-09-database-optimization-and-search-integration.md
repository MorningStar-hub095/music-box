# 数据库优化与搜索集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实施数据验证机制、增强管理界面功能、统一数据库与音乐盒子系统的搜索功能

**Architecture:** 前后端双重验证确保数据完整性，统一MySQL数据源实现系统集成，独立详情页面展示完整数据信息

**Tech Stack:** Express + Prisma + MySQL (后端), React + Vite (前端), Zod (数据验证)

---

## 第一部分：数据验证机制

### Task 1: 创建数据验证Schema

**Files:**
- Create: `server/src/validators/song.validator.ts`
- Create: `server/src/validators/common.validator.ts`
- Modify: `server/package.json` (添加zod依赖)

- [ ] **Step 1: 安装zod依赖**

```bash
cd d:\music_box\server
npm install zod
```

- [ ] **Step 2: 创建通用验证器**

```typescript
// server/src/validators/common.validator.ts
import { z } from 'zod';

// 分页参数验证
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// 排序参数验证
export const sortSchema = z.object({
  sort: z.enum(['hot_score', 'created_at', 'title', 'artist']).default('hot_score'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ID参数验证
export const idParamSchema = z.object({
  id: z.string().min(1, 'ID不能为空'),
});

// 批量操作验证
export const batchIdsSchema = z.object({
  songIds: z.array(z.string().min(1)).min(1, '至少选择一个项目'),
});
```

- [ ] **Step 3: 创建歌曲验证器**

```typescript
// server/src/validators/song.validator.ts
import { z } from 'zod';

// 歌曲基础信息验证
export const songBaseSchema = z.object({
  title: z.string()
    .min(1, '歌曲标题不能为空')
    .max(200, '歌曲标题不能超过200个字符')
    .trim(),
  artist: z.string()
    .min(1, '艺术家名称不能为空')
    .max(200, '艺术家名称不能超过200个字符')
    .trim(),
  album: z.string()
    .max(200, '专辑名称不能超过200个字符')
    .trim()
    .optional()
    .nullable(),
  albumCover: z.string()
    .url('专辑封面URL格式无效')
    .max(500, 'URL长度不能超过500个字符')
    .optional()
    .nullable(),
  audioUrl: z.string()
    .url('音频URL格式无效')
    .max(500, 'URL长度不能超过500个字符'),
  audioUrlMp3: z.string()
    .url('MP3音频URL格式无效')
    .max(500, 'URL长度不能超过500个字符')
    .optional()
    .nullable(),
  lyricContent: z.string()
    .max(100000, '歌词内容过长')
    .optional()
    .nullable(),
  coverColor: z.string()
    .regex(/^#[0-9A-Fa-f]{6}$/, '封面颜色格式无效，应为#RRGGBB')
    .optional()
    .nullable(),
  platform: z.enum(['netease', 'qq', 'kugou', 'local', 'other'], {
    errorMap: () => ({ message: '无效的平台类型' })
  }).optional().nullable(),
  playable: z.boolean().default(true),
});

// 创建歌曲验证
export const createSongSchema = songBaseSchema.extend({
  id: z.string()
    .min(1, '歌曲ID不能为空')
    .max(50, '歌曲ID长度不能超过50个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '歌曲ID只能包含字母、数字、下划线和连字符'),
  genres: z.array(z.number().int().positive()).optional(),
  languages: z.array(z.number().int().positive()).optional(),
  scenes: z.array(z.number().int().positive()).optional(),
  moods: z.array(z.number().int().positive()).optional(),
  decades: z.array(z.number().int().positive()).optional(),
  tags: z.array(z.number().int().positive()).optional(),
});

// 更新歌曲验证
export const updateSongSchema = songBaseSchema.partial().extend({
  genres: z.array(z.number().int().positive()).optional(),
  languages: z.array(z.number().int().positive()).optional(),
  scenes: z.array(z.number().int().positive()).optional(),
  moods: z.array(z.number().int().positive()).optional(),
  decades: z.array(z.number().int().positive()).optional(),
  tags: z.array(z.number().int().positive()).optional(),
});

// 歌曲筛选验证
export const songFiltersSchema = z.object({
  genres: z.string().optional(),
  languages: z.string().optional(),
  scenes: z.string().optional(),
  moods: z.string().optional(),
  decades: z.string().optional(),
  tags: z.string().optional(),
  platform: z.string().optional(),
  search: z.string().max(200, '搜索关键词过长').optional(),
  sort: z.enum(['hot_score', 'created_at', 'title', 'artist']).default('hot_score'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

- [ ] **Step 4: 创建验证中间件**

```typescript
// server/src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : 
                   req.params;
      
      const validated = schema.parse(data);
      
      // 将验证后的数据赋值回去
      if (source === 'body') req.body = validated;
      else if (source === 'query') req.query = validated as any;
      else req.params = validated as any;
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          success: false,
          error: '数据验证失败',
          details: errors,
        });
      }
      next(error);
    }
  };
};
```

- [ ] **Step 5: 更新歌曲路由使用验证**

```typescript
// server/src/modules/songs/songs.routes.ts
import { Router } from 'express';
import { SongsController } from './songs.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createSongSchema, updateSongSchema, songFiltersSchema } from '../../validators/song.validator';
import { idParamSchema, batchIdsSchema } from '../../validators/common.validator';

const router = Router();
const songsController = new SongsController();

// 获取歌曲列表（带验证）
router.get('/', validate(songFiltersSchema, 'query'), (req, res) => songsController.getSongs(req, res));

// 创建歌曲（需要认证和验证）
router.post(
  '/',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(createSongSchema),
  (req, res) => songsController.createSong(req, res)
);

// 批量更新
router.post(
  '/batch-update',
  authenticate,
  authorize('super_admin', 'admin', 'editor'),
  validate(batchIdsSchema),
  (req, res) => songsController.batchUpdateSongs(req, res)
);

// 批量删除
router.post(
  '/batch-delete',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(batchIdsSchema),
  (req, res) => songsController.batchDeleteSongs(req, res)
);

// 获取单首歌曲
router.get('/:id', validate(idParamSchema, 'params'), (req, res) => songsController.getSongById(req, res));

// 获取URL状态
router.get('/:id/url-status', validate(idParamSchema, 'params'), (req, res) => songsController.checkUrlStatus(req, res));

// 更新歌曲
router.put(
  '/:id',
  authenticate,
  authorize('super_admin', 'admin', 'editor'),
  validate(idParamSchema, 'params'),
  validate(updateSongSchema),
  (req, res) => songsController.updateSong(req, res)
);

// 删除歌曲
router.delete(
  '/:id',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(idParamSchema, 'params'),
  (req, res) => songsController.deleteSong(req, res)
);

// 刷新URL
router.post(
  '/:id/refresh-url',
  authenticate,
  authorize('super_admin', 'admin'),
  validate(idParamSchema, 'params'),
  (req, res) => songsController.refreshUrl(req, res)
);

export default router;
```

- [ ] **Step 6: 运行测试验证**

```bash
cd d:\music_box\server
npm run dev
```

在另一个终端测试：
```bash
# 测试无效数据
curl -X POST http://localhost:3000/api/songs \
  -H "Content-Type: application/json" \
  -d '{"title": ""}'

# 预期返回400错误，包含验证详情
```

- [ ] **Step 7: 提交代码**

```bash
cd d:\music_box\server
git add .
git commit -m "feat: 添加数据验证机制 - zod schema和验证中间件"
```

---

### Task 2: 实现数据来源追踪系统

**Files:**
- Modify: `server/prisma/schema.prisma` (添加DataSource枚举和字段)
- Create: `server/src/services/audit.service.ts`
- Modify: `server/src/modules/songs/songs.service.ts`

- [ ] **Step 1: 更新Prisma Schema添加数据来源字段**

```prisma
// server/prisma/schema.prisma 中添加

enum DataSource {
  crawler      // 爬虫采集
  manual       // 手动添加
  import       // 批量导入
  api          // API接口
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
  
  // 数据来源追踪字段
  dataSource    DataSource @default(manual) @map("data_source")
  sourceUrl     String?    @db.VarChar(500) @map("source_url")
  importedBy    Int?       @map("imported_by")
  importedAt    DateTime?  @map("imported_at")
  lastEditedBy  Int?       @map("last_edited_by")
  crawlTaskId   BigInt?    @map("crawl_task_id")

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
  @@index([dataSource])
}

// 更新OperationLog模型，添加更详细的变更记录
model OperationLog {
  id           BigInt   @id @default(autoincrement())
  userId       Int?     @map("user_id")
  action       String   @db.VarChar(50)
  targetType   String?  @db.VarChar(50) @map("target_type")
  targetId     String?  @db.VarChar(50) @map("target_id")
  
  // 变更详情
  oldValues    Json?    @map("old_values")
  newValues    Json?    @map("new_values")
  changedFields Json?   @map("changed_fields")
  
  details      Json?
  ipAddress    String?  @db.VarChar(45) @map("ip_address")
  userAgent    String?  @db.Text @map("user_agent")
  createdAt    DateTime @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id])

  @@index([targetType, targetId])
  @@index([userId])
  @@index([createdAt])
  @@map("operation_logs")
}
```

- [ ] **Step 2: 运行数据库迁移**

```bash
cd d:\music_box\server
npx prisma migrate dev --name add-data-source-tracking
```

- [ ] **Step 3: 创建审计服务**

```typescript
// server/src/services/audit.service.ts
import prisma from '../lib/prisma';

interface AuditLogData {
  userId?: number;
  action: string;
  targetType: string;
  targetId: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  changedFields?: string[];
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  // 记录操作日志
  async log(data: AuditLogData) {
    return prisma.operationLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        oldValues: data.oldValues || undefined,
        newValues: data.newValues || undefined,
        changedFields: data.changedFields || undefined,
        details: data.details || undefined,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }

  // 计算变更字段
  calculateChanges(
    oldData: Record<string, any>,
    newData: Record<string, any>
  ): { changedFields: string[]; oldValues: Record<string, any>; newValues: Record<string, any> } {
    const changedFields: string[] = [];
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    for (const key of Object.keys(newData)) {
      if (oldData[key] !== newData[key]) {
        changedFields.push(key);
        oldValues[key] = oldData[key];
        newValues[key] = newData[key];
      }
    }

    return { changedFields, oldValues, newValues };
  }

  // 获取实体的操作历史
  async getHistory(targetType: string, targetId: string, limit = 50) {
    return prisma.operationLog.findMany({
      where: {
        targetType,
        targetId: String(targetId),
      },
      include: {
        user: {
          select: { id: true, username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // 获取用户操作统计
  async getUserStats(userId: number, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return prisma.operationLog.groupBy({
      by: ['action'],
      where: {
        userId,
        createdAt: { gte: startDate },
      },
      _count: true,
    });
  }
}

export const auditService = new AuditService();
```

- [ ] **Step 4: 更新歌曲服务集成审计**

```typescript
// server/src/modules/songs/songs.service.ts 中更新createSong方法

async createSong(data: SongData, userId?: number, ipAddress?: string) {
  const { genres, languages, scenes, moods, decades, tags, ...songData } = data;

  const existingSong = await prisma.song.findUnique({ where: { id: data.id } });
  if (existingSong) {
    throw new Error('歌曲ID已存在');
  }

  const song = await prisma.song.create({
    data: {
      ...songData,
      dataSource: songData.dataSource || 'manual',
      importedBy: userId,
      importedAt: new Date(),
      genres: genres?.length
        ? { create: genres.map((genreId) => ({ genreId })) }
        : undefined,
      languages: languages?.length
        ? { create: languages.map((languageId) => ({ languageId })) }
        : undefined,
      scenes: scenes?.length
        ? { create: scenes.map((sceneId) => ({ sceneId })) }
        : undefined,
      moods: moods?.length
        ? { create: moods.map((moodId) => ({ moodId })) }
        : undefined,
      decades: decades?.length
        ? { create: decades.map((decadeId) => ({ decadeId })) }
        : undefined,
      tags: tags?.length
        ? { create: tags.map((tagId) => ({ tagId })) }
        : undefined,
    },
    include: songInclude,
  });

  // 记录审计日志
  await auditService.log({
    userId,
    action: 'create',
    targetType: 'song',
    targetId: song.id,
    newValues: songData,
    ipAddress,
  });

  return song;
}

// 更新updateSong方法
async updateSong(id: string, data: Partial<SongData>, userId?: number, ipAddress?: string) {
  const existingSong = await prisma.song.findUnique({ where: { id } });
  if (!existingSong) {
    throw new Error('歌曲不存在');
  }

  const { genres, languages, scenes, moods, decades, tags, ...songData } = data;

  // 计算变更
  const changes = auditService.calculateChanges(existingSong, songData);

  const song = await prisma.song.update({
    where: { id },
    data: {
      ...songData,
      lastEditedBy: userId,
      genres: genres !== undefined
        ? { deleteMany: {}, create: genres.map((genreId) => ({ genreId })) }
        : undefined,
      languages: languages !== undefined
        ? { deleteMany: {}, create: languages.map((languageId) => ({ languageId })) }
        : undefined,
      scenes: scenes !== undefined
        ? { deleteMany: {}, create: scenes.map((sceneId) => ({ sceneId })) }
        : undefined,
      moods: moods !== undefined
        ? { deleteMany: {}, create: moods.map((moodId) => ({ moodId })) }
        : undefined,
      decades: decades !== undefined
        ? { deleteMany: {}, create: decades.map((decadeId) => ({ decadeId })) }
        : undefined,
      tags: tags !== undefined
        ? { deleteMany: {}, create: tags.map((tagId) => ({ tagId })) }
        : undefined,
    },
    include: songInclude,
  });

  // 记录审计日志
  if (changes.changedFields.length > 0) {
    await auditService.log({
      userId,
      action: 'update',
      targetType: 'song',
      targetId: id,
      oldValues: changes.oldValues,
      newValues: changes.newValues,
      changedFields: changes.changedFields,
      ipAddress,
    });
  }

  return song;
}
```

- [ ] **Step 5: 提交代码**

```bash
cd d:\music_box\server
git add .
git commit -m "feat: 实现数据来源追踪系统 - 审计日志和变更记录"
```

---

## 第二部分：管理界面增强

### Task 3: 创建歌曲详情页面

**Files:**
- Create: `web/admin/src/pages/SongDetailPage.tsx`
- Modify: `web/admin/src/App.tsx`
- Modify: `web/admin/src/services/api.ts`

- [ ] **Step 1: 更新API服务添加详情接口**

```typescript
// web/admin/src/services/api.ts 中添加

// ============ Audit API ============
export const auditApi = {
  getHistory: (targetType: string, targetId: string) =>
    api.get(`/audit/history/${targetType}/${targetId}`),
};

// 更新songsApi添加获取详情方法
export const songsApi = {
  // ... 现有方法 ...
  getSongDetail: (id: string) => api.get(`/songs/${id}`),
  getUrlStatus: (id: string) => api.get(`/songs/${id}/url-status`),
  refreshUrl: (id: string) => api.post(`/songs/${id}/refresh-url`),
};
```

- [ ] **Step 2: 创建歌曲详情页面**

```tsx
// web/admin/src/pages/SongDetailPage.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { songsApi, auditApi } from '../services/api';

interface SongDetail {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl: string;
  audioUrlMp3?: string;
  lyricContent?: string;
  coverColor?: string;
  platform?: string;
  playable: boolean;
  playCount: number;
  commentCount: number;
  likeCount: number;
  favoriteCount: number;
  hotScore: number;
  createdAt: string;
  updatedAt: string;
  urlCheckedAt?: string;
  dataSource?: string;
  sourceUrl?: string;
  importedBy?: number;
  importedAt?: string;
  lastEditedBy?: number;
  genres: { genre: { id: number; name: string } }[];
  languages: { language: { id: number; name: string; code: string } }[];
  scenes: { scene: { id: number; name: string; icon?: string } }[];
  moods: { mood: { id: number; name: string; icon?: string } }[];
  decades: { decade: { id: number; name: string; startYear?: number; endYear?: number } }[];
  tags: { tag: { id: number; name: string } }[];
}

interface AuditLog {
  id: number;
  action: string;
  userId?: number;
  user?: { id: number; username: string };
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  changedFields?: string[];
  ipAddress?: string;
  createdAt: string;
}

interface UrlStatus {
  playable: boolean;
  audioUrl: string;
  audioUrlMp3?: string;
  urlCheckedAt: string;
}

const SongDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [song, setSong] = useState<SongDetail | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditLog[]>([]);
  const [urlStatus, setUrlStatus] = useState<UrlStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'audio' | 'history'>('info');

  useEffect(() => {
    if (!id) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        const [songRes, historyRes] = await Promise.all([
          songsApi.getSongDetail(id),
          auditApi.getHistory('song', id),
        ]);
        
        setSong(songRes.data.data);
        setAuditHistory(historyRes.data.data || []);
      } catch (error) {
        console.error('获取歌曲详情失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleCheckUrl = async () => {
    if (!id) return;
    try {
      const res = await songsApi.getUrlStatus(id);
      setUrlStatus(res.data.data);
    } catch (error) {
      console.error('检查URL状态失败:', error);
    }
  };

  const handleRefreshUrl = async () => {
    if (!id) return;
    try {
      const res = await songsApi.refreshUrl(id);
      setUrlStatus(res.data.data);
      // 刷新歌曲数据
      const songRes = await songsApi.getSongDetail(id);
      setSong(songRes.data.data);
    } catch (error) {
      console.error('刷新URL失败:', error);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getDataSourceLabel = (source?: string) => {
    const labels: Record<string, string> = {
      crawler: '爬虫采集',
      manual: '手动添加',
      import: '批量导入',
      api: 'API接口',
    };
    return labels[source || ''] || source || '--';
  };

  if (loading) {
    return <div className="page-loading">加载中...</div>;
  }

  if (!song) {
    return <div className="empty-state">歌曲不存在</div>;
  }

  return (
    <div className="song-detail-page">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/songs')}>
          ← 返回列表
        </button>
        <h2 className="page-title">歌曲详情</h2>
      </div>

      {/* 基本信息卡片 */}
      <div className="detail-card">
        <div className="detail-cover-section">
          {song.albumCover ? (
            <img src={song.albumCover} alt={song.title} className="detail-cover" />
          ) : (
            <div className="detail-cover-placeholder" style={{ backgroundColor: song.coverColor || '#6366f1' }}>
              <span>♪</span>
            </div>
          )}
          <div className="detail-basic-info">
            <h3 className="detail-title">{song.title}</h3>
            <p className="detail-artist">{song.artist}</p>
            {song.album && <p className="detail-album">专辑: {song.album}</p>}
            <div className="detail-tags">
              {song.genres.map(({ genre }) => (
                <span key={genre.id} className="tag genre-tag">{genre.name}</span>
              ))}
              {song.languages.map(({ language }) => (
                <span key={language.id} className="tag language-tag">{language.name}</span>
              ))}
              {song.scenes.map(({ scene }) => (
                <span key={scene.id} className="tag scene-tag">
                  {scene.icon && <span className="tag-icon">{scene.icon}</span>}
                  {scene.name}
                </span>
              ))}
              {song.moods.map(({ mood }) => (
                <span key={mood.id} className="tag mood-tag">
                  {mood.icon && <span className="tag-icon">{mood.icon}</span>}
                  {mood.name}
                </span>
              ))}
              {song.decades.map(({ decade }) => (
                <span key={decade.id} className="tag decade-tag">{decade.name}</span>
              ))}
              {song.tags.map(({ tag }) => (
                <span key={tag.id} className="tag custom-tag">{tag.name}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="detail-stats">
          <div className="stat-item">
            <span className="stat-label">播放次数</span>
            <span className="stat-value">{song.playCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">评论数</span>
            <span className="stat-value">{song.commentCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">点赞数</span>
            <span className="stat-value">{song.likeCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">收藏数</span>
            <span className="stat-value">{song.favoriteCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">热度分数</span>
            <span className="stat-value">{song.hotScore.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">播放状态</span>
            <span className={`stat-value status ${song.playable ? 'playable' : 'unplayable'}`}>
              {song.playable ? '可播放' : '不可用'}
            </span>
          </div>
        </div>
      </div>

      {/* 标签页切换 */}
      <div className="detail-tabs">
        <button
          className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          详细信息
        </button>
        <button
          className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => setActiveTab('audio')}
        >
          音频信息
        </button>
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          操作历史
        </button>
      </div>

      {/* 详细信息标签页 */}
      {activeTab === 'info' && (
        <div className="detail-card">
          <h4 className="card-title">数据来源</h4>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">数据来源</span>
              <span className="info-value">{getDataSourceLabel(song.dataSource)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">来源URL</span>
              <span className="info-value">
                {song.sourceUrl ? (
                  <a href={song.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {song.sourceUrl.length > 50 ? song.sourceUrl.substring(0, 50) + '...' : song.sourceUrl}
                  </a>
                ) : '--'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">平台</span>
              <span className="info-value">{song.platform || '--'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">歌曲ID</span>
              <span className="info-value">{song.id}</span>
            </div>
          </div>

          <h4 className="card-title">时间信息</h4>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">创建时间</span>
              <span className="info-value">{formatDate(song.createdAt)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">最后更新</span>
              <span className="info-value">{formatDate(song.updatedAt)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">导入时间</span>
              <span className="info-value">{formatDate(song.importedAt)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">URL检查时间</span>
              <span className="info-value">{formatDate(song.urlCheckedAt)}</span>
            </div>
          </div>

          {song.lyricContent && (
            <>
              <h4 className="card-title">歌词内容</h4>
              <div className="lyrics-preview">
                <pre>{song.lyricContent.substring(0, 500)}{song.lyricContent.length > 500 ? '...' : ''}</pre>
              </div>
            </>
          )}
        </div>
      )}

      {/* 音频信息标签页 */}
      {activeTab === 'audio' && (
        <div className="detail-card">
          <h4 className="card-title">音频URL</h4>
          <div className="url-info">
            <div className="url-item">
              <span className="url-label">主音频URL:</span>
              <code className="url-value">{song.audioUrl}</code>
            </div>
            {song.audioUrlMp3 && (
              <div className="url-item">
                <span className="url-label">MP3音频URL:</span>
                <code className="url-value">{song.audioUrlMp3}</code>
              </div>
            )}
          </div>

          <div className="url-actions">
            <button className="action-btn" onClick={handleCheckUrl}>
              检查URL状态
            </button>
            <button className="action-btn primary" onClick={handleRefreshUrl}>
              刷新URL
            </button>
          </div>

          {urlStatus && (
            <div className="url-status-result">
              <h4>URL状态检查结果</h4>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">可播放</span>
                  <span className={`info-value status ${urlStatus.playable ? 'playable' : 'unplayable'}`}>
                    {urlStatus.playable ? '是' : '否'}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">检查时间</span>
                  <span className="info-value">{formatDate(urlStatus.urlCheckedAt)}</span>
                </div>
              </div>
            </div>
          )}

          {song.coverColor && (
            <>
              <h4 className="card-title">封面颜色</h4>
              <div className="color-preview">
                <div className="color-swatch" style={{ backgroundColor: song.coverColor }} />
                <span className="color-value">{song.coverColor}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 操作历史标签页 */}
      {activeTab === 'history' && (
        <div className="detail-card">
          <h4 className="card-title">操作历史记录</h4>
          {auditHistory.length === 0 ? (
            <div className="empty-history">暂无操作记录</div>
          ) : (
            <div className="history-list">
              {auditHistory.map((log) => (
                <div key={log.id} className="history-item">
                  <div className="history-header">
                    <span className="history-action">
                      {log.action === 'create' ? '创建' : 
                       log.action === 'update' ? '更新' : 
                       log.action === 'delete' ? '删除' : log.action}
                    </span>
                    <span className="history-user">
                      {log.user?.username || '系统'}
                    </span>
                    <span className="history-time">
                      {formatDate(log.createdAt)}
                    </span>
                    {log.ipAddress && (
                      <span className="history-ip">IP: {log.ipAddress}</span>
                    )}
                  </div>
                  {log.changedFields && log.changedFields.length > 0 && (
                    <div className="history-changes">
                      <span className="changes-label">变更字段:</span>
                      <span className="changes-fields">
                        {log.changedFields.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SongDetailPage;
```

- [ ] **Step 3: 更新路由配置**

```tsx
// web/admin/src/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import StatsPage from './pages/StatsPage';
import SongsPage from './pages/SongsPage';
import SongDetailPage from './pages/SongDetailPage'; // 新增
import GenresPage from './pages/GenresPage';
import UsersPage from './pages/UsersPage';
import PlaylistsPage from './pages/PlaylistsPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<StatsPage />} />
        <Route path="songs" element={<SongsPage />} />
        <Route path="songs/:id" element={<SongDetailPage />} /> {/* 新增 */}
        <Route path="genres" element={<GenresPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="playlists" element={<PlaylistsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
```

- [ ] **Step 4: 更新歌曲列表页添加查看详情按钮**

```tsx
// web/admin/src/pages/SongsPage.tsx 中更新歌曲卡片

<div className="song-actions">
  <span className={`status ${song.playable ? 'playable' : 'unplayable'}`}>
    {song.playable ? '可播放' : '不可用'}
  </span>
  <button 
    className="view-btn" 
    onClick={() => navigate(`/songs/${song.id}`)}
  >
    查看详情
  </button>
  <button className="delete-btn" onClick={() => handleDelete(song.id)}>
    删除
  </button>
</div>
```

- [ ] **Step 5: 提交代码**

```bash
cd d:\music_box\web\admin
git add .
git commit -m "feat: 添加歌曲详情页面 - 完整数据展示和操作历史"
```

---

### Task 4: 增强歌曲列表页筛选和排序功能

**Files:**
- Modify: `web/admin/src/pages/SongsPage.tsx`
- Modify: `web/admin/src/services/api.ts`

- [ ] **Step 1: 更新API支持更多筛选参数**

```typescript
// web/admin/src/services/api.ts 中更新songsApi

export const songsApi = {
  getSongs: (params?: Record<string, string | number>) =>
    api.get('/songs', { params }),
  // ... 其他方法
};

// 添加更多分类API
export const scenesApi = {
  getScenes: () => api.get('/scenes'),
};

export const moodsApi = {
  getMoods: () => api.get('/moods'),
};

export const decadesApi = {
  getDecades: () => api.get('/decades'),
};

export const tagsApi = {
  getTags: () => api.get('/tags'),
};
```

- [ ] **Step 2: 增强歌曲列表页筛选功能**

```tsx
// web/admin/src/pages/SongsPage.tsx 完整更新

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { songsApi, genresApi, languagesApi, scenesApi, moodsApi, decadesApi, tagsApi } from '../services/api';

interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  coverColor?: string;
  platform?: string;
  playable: boolean;
  playCount: number;
  hotScore: number;
  createdAt: string;
  dataSource?: string;
  genres: { genre: { id: number; name: string } }[];
  languages: { language: { id: number; name: string } }[];
  scenes: { scene: { id: number; name: string } }[];
  moods: { mood: { id: number; name: string } }[];
  decades: { decade: { id: number; name: string } }[];
  tags: { tag: { id: number; name: string } }[];
}

interface Category {
  id: number;
  name: string;
}

const SongsPage: React.FC = () => {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 分类数据
  const [genres, setGenres] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Category[]>([]);
  const [scenes, setScenes] = useState<Category[]>([]);
  const [moods, setMoods] = useState<Category[]>([]);
  const [decades, setDecades] = useState<Category[]>([]);
  const [tags, setTags] = useState<Category[]>([]);

  // 筛选状态
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [sceneFilter, setSceneFilter] = useState('');
  const [moodFilter, setMoodFilter] = useState('');
  const [decadeFilter, setDecadeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [playableFilter, setPlayableFilter] = useState('');
  const [dataSourceFilter, setDataSourceFilter] = useState('');
  
  // 排序状态
  const [sortBy, setSortBy] = useState('hot_score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page,
        limit: 20,
        sort: sortBy,
        order: sortOrder,
      };
      if (search) params.search = search;
      if (genreFilter) params.genres = genreFilter;
      if (languageFilter) params.languages = languageFilter;
      if (sceneFilter) params.scenes = sceneFilter;
      if (moodFilter) params.moods = moodFilter;
      if (decadeFilter) params.decades = decadeFilter;
      if (tagFilter) params.tags = tagFilter;
      if (platformFilter) params.platform = platformFilter;
      if (playableFilter) params.playable = playableFilter;
      if (dataSourceFilter) params.dataSource = dataSourceFilter;

      const res = await songsApi.getSongs(params);
      const data = res.data.data;
      setSongs(data.songs || []);
      setTotalPages(data.pagination?.total_pages || 1);
      setTotalItems(data.pagination?.total || 0);
    } catch {
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, genreFilter, languageFilter, sceneFilter, moodFilter, decadeFilter, tagFilter, platformFilter, playableFilter, dataSourceFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [genresRes, langsRes, scenesRes, moodsRes, decadesRes, tagsRes] = await Promise.all([
          genresApi.getGenres(),
          languagesApi.getLanguages(),
          scenesApi.getScenes(),
          moodsApi.getMoods(),
          decadesApi.getDecades(),
          tagsApi.getTags(),
        ]);
        setGenres(genresRes.data.data || []);
        setLanguages(langsRes.data.data || []);
        setScenes(scenesRes.data.data || []);
        setMoods(moodsRes.data.data || []);
        setDecades(decadesRes.data.data || []);
        setTags(tagsRes.data.data || []);
      } catch {
        // ignore
      }
    };
    fetchFilters();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这首歌曲吗？')) return;
    try {
      await songsApi.deleteSong(id);
      fetchSongs();
    } catch {
      alert('删除失败');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchSongs();
  };

  const clearAllFilters = () => {
    setSearch('');
    setGenreFilter('');
    setLanguageFilter('');
    setSceneFilter('');
    setMoodFilter('');
    setDecadeFilter('');
    setTagFilter('');
    setPlatformFilter('');
    setPlayableFilter('');
    setDataSourceFilter('');
    setPage(1);
  };

  const hasActiveFilters = search || genreFilter || languageFilter || sceneFilter || 
    moodFilter || decadeFilter || tagFilter || platformFilter || playableFilter || dataSourceFilter;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const getDataSourceLabel = (source?: string) => {
    const labels: Record<string, string> = {
      crawler: '爬虫',
      manual: '手动',
      import: '导入',
      api: 'API',
    };
    return labels[source || ''] || source || '--';
  };

  return (
    <div className="songs-page">
      <div className="page-header">
        <h2 className="page-title">歌曲管理</h2>
        <span className="total-count">共 {totalItems} 首歌曲</span>
      </div>

      {/* 搜索和筛选区域 */}
      <div className="songs-toolbar">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="搜索歌曲名称、歌手、专辑..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn">搜索</button>
        </form>
        
        <div className="filter-group">
          <select value={genreFilter} onChange={(e) => { setGenreFilter(e.target.value); setPage(1); }}>
            <option value="">全部流派</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          
          <select value={languageFilter} onChange={(e) => { setLanguageFilter(e.target.value); setPage(1); }}>
            <option value="">全部语言</option>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          
          <select value={sceneFilter} onChange={(e) => { setSceneFilter(e.target.value); setPage(1); }}>
            <option value="">全部场景</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          
          <select value={moodFilter} onChange={(e) => { setMoodFilter(e.target.value); setPage(1); }}>
            <option value="">全部情绪</option>
            {moods.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          
          <select value={decadeFilter} onChange={(e) => { setDecadeFilter(e.target.value); setPage(1); }}>
            <option value="">全部年代</option>
            {decades.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          
          <select value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}>
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <select value={platformFilter} onChange={(e) => { setPlatformFilter(e.target.value); setPage(1); }}>
            <option value="">全部平台</option>
            <option value="netease">网易云</option>
            <option value="qq">QQ音乐</option>
            <option value="kugou">酷狗</option>
            <option value="local">本地</option>
            <option value="other">其他</option>
          </select>
          
          <select value={playableFilter} onChange={(e) => { setPlayableFilter(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option value="true">可播放</option>
            <option value="false">不可用</option>
          </select>
          
          <select value={dataSourceFilter} onChange={(e) => { setDataSourceFilter(e.target.value); setPage(1); }}>
            <option value="">全部来源</option>
            <option value="crawler">爬虫采集</option>
            <option value="manual">手动添加</option>
            <option value="import">批量导入</option>
            <option value="api">API接口</option>
          </select>
        </div>
        
        <div className="filter-group">
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }}>
            <option value="hot_score">按热度</option>
            <option value="created_at">按时间</option>
            <option value="title">按名称</option>
            <option value="artist">按歌手</option>
            <option value="play_count">按播放量</option>
          </select>
          
          <button 
            className="sort-order-btn"
            onClick={() => { setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); setPage(1); }}
          >
            {sortOrder === 'asc' ? '↑ 升序' : '↓ 降序'}
          </button>
        </div>
        
        {hasActiveFilters && (
          <button className="clear-filters-btn" onClick={clearAllFilters}>
            清除筛选
          </button>
        )}
      </div>

      {/* 歌曲列表 */}
      {loading ? (
        <div className="page-loading">加载中...</div>
      ) : songs.length === 0 ? (
        <div className="empty-state">暂无歌曲数据</div>
      ) : (
        <>
          <div className="songs-table">
            <table>
              <thead>
                <tr>
                  <th>歌曲</th>
                  <th>流派</th>
                  <th>语言</th>
                  <th>平台</th>
                  <th>来源</th>
                  <th>播放量</th>
                  <th>热度</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((song) => (
                  <tr key={song.id}>
                    <td className="song-cell">
                      <div className="song-info">
                        {song.albumCover ? (
                          <img src={song.albumCover} alt="" className="song-thumb" />
                        ) : (
                          <div className="song-thumb-placeholder" style={{ backgroundColor: song.coverColor || '#6366f1' }}>
                            ♪
                          </div>
                        )}
                        <div>
                          <div className="song-title">{song.title}</div>
                          <div className="song-artist">{song.artist}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {song.genres.map(({ genre }) => (
                        <span key={genre.id} className="mini-tag">{genre.name}</span>
                      ))}
                    </td>
                    <td>
                      {song.languages.map(({ language }) => (
                        <span key={language.id} className="mini-tag">{language.name}</span>
                      ))}
                    </td>
                    <td>{song.platform || '--'}</td>
                    <td>
                      <span className="source-badge">{getDataSourceLabel(song.dataSource)}</span>
                    </td>
                    <td>{song.playCount.toLocaleString()}</td>
                    <td>{song.hotScore.toFixed(1)}</td>
                    <td>
                      <span className={`status ${song.playable ? 'playable' : 'unplayable'}`}>
                        {song.playable ? '可播放' : '不可用'}
                      </span>
                    </td>
                    <td>{formatDate(song.createdAt)}</td>
                    <td>
                      <div className="action-buttons">
                        <button 
                          className="view-btn" 
                          onClick={() => navigate(`/songs/${song.id}`)}
                        >
                          详情
                        </button>
                        <button className="delete-btn" onClick={() => handleDelete(song.id)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span className="page-info">第 {page} / {totalPages} 页</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        </>
      )}
    </div>
  );
};

export default SongsPage;
```

- [ ] **Step 3: 提交代码**

```bash
cd d:\music_box\web\admin
git add .
git commit -m "feat: 增强歌曲列表页 - 多维度筛选和排序功能"
```

---

## 第三部分：数据库与音乐盒子系统集成

### Task 5: 创建统一搜索API

**Files:**
- Create: `server/src/modules/search/search.controller.ts`
- Create: `server/src/modules/search/search.routes.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: 创建搜索控制器**

```typescript
// server/src/modules/search/search.controller.ts
import prisma from '../../lib/prisma';

interface SearchFilters {
  q?: string;
  genres?: string;
  languages?: string;
  scenes?: string;
  moods?: string;
  decades?: string;
  tags?: string;
  platform?: string;
  sort?: string;
  order?: string;
  page?: number;
  limit?: number;
}

export class SearchController {
  // 搜索歌曲
  async searchSongs(filters: SearchFilters) {
    const {
      q,
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
      limit = 20,
    } = filters;

    const where: any = {
      playable: true, // 只搜索可播放的歌曲
    };

    // 关键词搜索
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { artist: { contains: q } },
        { album: { contains: q } },
      ];
    }

    // 分类筛选
    if (genres) {
      const genreIds = genres.split(',').map(Number);
      where.genres = { some: { genreId: { in: genreIds } } };
    }

    if (languages) {
      const languageIds = languages.split(',').map(Number);
      where.languages = { some: { languageId: { in: languageIds } } };
    }

    if (scenes) {
      const sceneIds = scenes.split(',').map(Number);
      where.scenes = { some: { sceneId: { in: sceneIds } } };
    }

    if (moods) {
      const moodIds = moods.split(',').map(Number);
      where.moods = { some: { moodId: { in: moodIds } } };
    }

    if (decades) {
      const decadeIds = decades.split(',').map(Number);
      where.decades = { some: { decadeId: { in: decadeIds } } };
    }

    if (tags) {
      const tagIds = tags.split(',').map(Number);
      where.tags = { some: { tagId: { in: tagIds } } };
    }

    if (platform) {
      where.platform = platform;
    }

    // 排序
    const sortFieldMap: Record<string, string> = {
      hot_score: 'hotScore',
      created_at: 'createdAt',
      title: 'title',
      artist: 'artist',
      play_count: 'playCount',
    };

    const orderBy = {
      [sortFieldMap[sort] || 'hotScore']: order === 'asc' ? 'asc' : 'desc',
    };

    const skip = (page - 1) * limit;

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          albumCover: true,
          audioUrl: true,
          audioUrlMp3: true,
          coverColor: true,
          platform: true,
          playCount: true,
          hotScore: true,
          genres: {
            select: {
              genre: {
                select: { id: true, name: true },
              },
            },
          },
          languages: {
            select: {
              language: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.song.count({ where }),
    ]);

    return {
      results: songs,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  // 获取搜索建议
  async getSuggestions(q: string) {
    if (!q || q.length < 2) {
      return { suggestions: [] };
    }

    const songs = await prisma.song.findMany({
      where: {
        playable: true,
        OR: [
          { title: { contains: q } },
          { artist: { contains: q } },
        ],
      },
      select: {
        id: true,
        title: true,
        artist: true,
      },
      take: 10,
      orderBy: { hotScore: 'desc' },
    });

    const suggestions = songs.map(song => ({
      id: song.id,
      text: `${song.title} - ${song.artist}`,
      title: song.title,
      artist: song.artist,
    }));

    return { suggestions };
  }

  // 获取热门搜索
  async getHotSearches(limit = 10) {
    const songs = await prisma.song.findMany({
      where: { playable: true },
      select: {
        id: true,
        title: true,
        artist: true,
        playCount: true,
      },
      orderBy: { hotScore: 'desc' },
      take: limit,
    });

    return {
      hotSearches: songs.map(song => ({
        id: song.id,
        keyword: song.title,
        count: song.playCount,
      })),
    };
  }

  // 获取分类统计
  async getCategoryStats() {
    const [genres, languages, scenes, moods, decades] = await Promise.all([
      prisma.genre.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { songs: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.language.findMany({
        select: {
          id: true,
          name: true,
          code: true,
          _count: { select: { songs: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.scene.findMany({
        select: {
          id: true,
          name: true,
          icon: true,
          _count: { select: { songs: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.mood.findMany({
        select: {
          id: true,
          name: true,
          icon: true,
          _count: { select: { songs: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.decade.findMany({
        select: {
          id: true,
          name: true,
          startYear: true,
          endYear: true,
          _count: { select: { songs: true } },
        },
        orderBy: { startYear: 'asc' },
      }),
    ]);

    return {
      genres: genres.map(g => ({ ...g, count: g._count.songs })),
      languages: languages.map(l => ({ ...l, count: l._count.songs })),
      scenes: scenes.map(s => ({ ...s, count: s._count.songs })),
      moods: moods.map(m => ({ ...m, count: m._count.songs })),
      decades: decades.map(d => ({ ...d, count: d._count.songs })),
    };
  }
}

export const searchController = new SearchController();
```

- [ ] **Step 2: 创建搜索路由**

```typescript
// server/src/modules/search/search.routes.ts
import { Router, Request, Response } from 'express';
import { searchController } from './search.controller';

const router = Router();

// 搜索歌曲
router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = {
      q: req.query.q as string,
      genres: req.query.genres as string,
      languages: req.query.languages as string,
      scenes: req.query.scenes as string,
      moods: req.query.moods as string,
      decades: req.query.decades as string,
      tags: req.query.tags as string,
      platform: req.query.platform as string,
      sort: req.query.sort as string,
      order: req.query.order as string,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };

    const result = await searchController.searchSongs(filters);
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '搜索失败',
    });
  }
});

// 获取搜索建议
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const result = await searchController.getSuggestions(q);
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取建议失败',
    });
  }
});

// 获取热门搜索
router.get('/hot', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const result = await searchController.getHotSearches(limit);
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取热门搜索失败',
    });
  }
});

// 获取分类统计
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const result = await searchController.getCategoryStats();
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取分类统计失败',
    });
  }
});

export default router;
```

- [ ] **Step 3: 更新服务器主文件添加搜索路由**

```typescript
// server/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import authRoutes from './modules/auth/auth.routes';
import songsRoutes from './modules/songs/songs.routes';
import searchRoutes from './modules/search/search.routes'; // 新增
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

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 认证路由
app.use('/api/auth', authRoutes);

// 歌曲路由
app.use('/api/songs', songsRoutes);

// 搜索路由（新增）
app.use('/api/search', searchRoutes);

// 分类路由
app.use('/api/genres', genresRoutes);
app.use('/api/languages', languagesRoutes);
app.use('/api/scenes', scenesRoutes);
app.use('/api/moods', moodsRoutes);
app.use('/api/decades', decadesRoutes);
app.use('/api/tags', tagsRoutes);

// 启动服务
app.listen(config.port, () => {
  console.log(`API服务运行在 http://localhost:${config.port}`);
});
```

- [ ] **Step 4: 测试搜索API**

```bash
cd d:\music_box\server
npm run dev
```

在另一个终端测试：
```bash
# 测试搜索
curl "http://localhost:3000/api/search?q=test"

# 测试搜索建议
curl "http://localhost:3000/api/search/suggestions?q=test"

# 测试热门搜索
curl "http://localhost:3000/api/search/hot"

# 测试分类统计
curl "http://localhost:3000/api/search/categories"
```

- [ ] **Step 5: 提交代码**

```bash
cd d:\music_box\server
git add .
git commit -m "feat: 创建统一搜索API - 支持多维度搜索和分类统计"
```

---

### Task 6: 更新音乐盒子使用统一搜索API

**Files:**
- Modify: `shared/useSearch.ts`
- Modify: `web/src/App.tsx`
- Modify: `mini-app/src/app.tsx`

- [ ] **Step 1: 更新共享搜索Hook**

```typescript
// shared/useSearch.ts - 搜索与曲库管理 Hook（Web + 小程序共享）
import { useState, useCallback, useMemo } from 'react';
import { Track } from './types';

// 统一搜索API地址
const SEARCH_API = 'http://localhost:3000/api';

export function useSearch(playlist: Track[], onAddTrack: (track: Track) => void) {
  const [query, setQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  // 本地筛选：输入即过滤
  const filtered = useMemo(() => {
    if (!query.trim()) return playlist;
    const q = query.toLowerCase();
    return playlist.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q)
    );
  }, [playlist, query]);

  // 获取搜索建议
  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const resp = await fetch(`${SEARCH_API}/search/suggestions?q=${encodeURIComponent(q)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setSuggestions(data.data?.suggestions || []);
    } catch {
      // 静默失败
    }
  }, []);

  // 在线搜索
  const searchOnline = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const resp = await fetch(`${SEARCH_API}/search?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error('搜索服务响应异常');
      const data = await resp.json();
      const results = data.data?.results || [];
      // 转换为Track格式
      const tracks: Track[] = results.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        albumCover: song.albumCover,
        audioUrl: song.audioUrl,
        audioUrlMp3: song.audioUrlMp3,
        coverColor: song.coverColor,
        platform: song.platform,
        genres: song.genres?.map((g: any) => g.genre.name) || [],
        languages: song.languages?.map((l: any) => l.language.name) || [],
      }));
      setOnlineResults(tracks);
      setShowOnline(true);
    } catch (err) {
      setError('搜索服务未运行，请检查API服务');
      setShowOnline(false);
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  // 加入曲库
  const addTrack = useCallback(async (track: Track) => {
    try {
      // 检查是否已存在
      const exists = playlist.some(t => t.id === track.id);
      if (exists) {
        setError('该歌曲已在曲库中');
        return;
      }
      onAddTrack(track);
      setError(null);
    } catch (err) {
      setError('加入失败');
    }
  }, [onAddTrack, playlist]);

  const closeOnline = useCallback(() => setShowOnline(false), []);

  return {
    query,
    setQuery,
    filtered,
    onlineResults,
    isSearching,
    searchOnline,
    addTrack,
    error,
    showOnline,
    closeOnline,
    suggestions,
    fetchSuggestions,
  };
}
```

- [ ] **Step 2: 更新Web播放器集成新搜索**

```tsx
// web/src/App.tsx 中更新搜索相关代码

// 在搜索栏部分更新
<div className="search-bar">
  <div className="search-input-wrap">
    <SearchIcon size={14} className="search-input-icon" />
    <input 
      type="text" 
      className="search-input" 
      placeholder="搜索歌名/歌手..."
      value={search.query} 
      onChange={(e) => {
        search.setQuery(e.target.value);
        search.fetchSuggestions(e.target.value);
      }} 
    />
    {/* 搜索建议下拉框 */}
    {search.suggestions.length > 0 && (
      <div className="search-suggestions">
        {search.suggestions.map((s: any) => (
          <div 
            key={s.id} 
            className="suggestion-item"
            onClick={() => {
              search.setQuery(s.title);
              search.searchOnline();
            }}
          >
            <span className="suggestion-title">{s.title}</span>
            <span className="suggestion-artist">{s.artist}</span>
          </div>
        ))}
      </div>
    )}
  </div>
  <button className="search-btn" onClick={search.searchOnline} disabled={search.isSearching} title="在线搜索">
    {search.isSearching ? <span className="searching-spinner" /> : <SearchIcon size={14} />}
  </button>
</div>
```

- [ ] **Step 3: 更新小程序集成新搜索**

```tsx
// mini-app/src/app.tsx 中更新搜索相关代码
// 与Web播放器类似，更新搜索API地址
```

- [ ] **Step 4: 测试集成效果**

```bash
# 启动后端服务
cd d:\music_box\server
npm run dev

# 启动Web播放器
cd d:\music_box\web
npm run dev

# 测试搜索功能
# 1. 在搜索框输入关键词
# 2. 验证搜索建议是否正常显示
# 3. 验证搜索结果是否来自数据库
# 4. 验证添加到曲库功能是否正常
```

- [ ] **Step 5: 提交代码**

```bash
cd d:\music_box
git add shared/useSearch.ts web/src/App.tsx mini-app/src/app.tsx
git commit -m "feat: 更新音乐盒子使用统一搜索API - 集成数据库搜索"
```

---

## 第四部分：测试策略

### Task 7: 编写测试用例

**Files:**
- Create: `server/tests/validators.test.ts`
- Create: `server/tests/search.test.ts`
- Create: `server/tests/audit.test.ts`

- [ ] **Step 1: 安装测试依赖**

```bash
cd d:\music_box\server
npm install -D jest @types/jest ts-jest supertest @types/supertest
```

- [ ] **Step 2: 创建测试配置**

```typescript
// server/jest.config.ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

- [ ] **Step 3: 编写验证器测试**

```typescript
// server/tests/validators.test.ts
import { createSongSchema, updateSongSchema } from '../src/validators/song.validator';

describe('Song Validator', () => {
  describe('createSongSchema', () => {
    it('should validate valid song data', () => {
      const validData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
      };

      const result = createSongSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject empty title', () => {
      const invalidData = {
        id: 'test-123',
        title: '',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('歌曲标题不能为空');
      }
    });

    it('should reject invalid URL', () => {
      const invalidData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'not-a-url',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('音频URL格式无效');
      }
    });

    it('should reject invalid cover color format', () => {
      const invalidData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
        coverColor: 'invalid-color',
      };

      const result = createSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('封面颜色格式无效');
      }
    });

    it('should accept valid cover color', () => {
      const validData = {
        id: 'test-123',
        title: 'Test Song',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/audio.mp3',
        coverColor: '#FF5733',
      };

      const result = createSongSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });
  });

  describe('updateSongSchema', () => {
    it('should allow partial updates', () => {
      const partialData = {
        title: 'Updated Title',
      };

      const result = updateSongSchema.safeParse(partialData);
      expect(result.success).toBe(true);
    });

    it('should validate fields when provided', () => {
      const invalidData = {
        title: '',
      };

      const result = updateSongSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
cd d:\music_box\server
npm test
```

- [ ] **Step 5: 提交测试代码**

```bash
cd d:\music_box\server
git add .
git commit -m "test: 添加数据验证测试用例"
```

---

## 总结

本实现计划包含以下核心功能：

1. **数据验证机制**
   - 使用Zod实现前后端双重验证
   - 字段格式验证（URL、颜色代码、字符串长度等）
   - 业务规则校验（必填字段、枚举值等）

2. **数据来源追踪系统**
   - 记录数据来源（crawler/manual/import/api）
   - 记录操作人、操作时间、IP地址
   - 记录变更前后值和变更字段

3. **管理界面增强**
   - 独立详情页面展示完整数据
   - 多维度筛选（流派、语言、场景、情绪、年代、标签、平台、来源）
   - 多字段排序（热度、时间、名称、歌手、播放量）

4. **系统集成与搜索功能**
   - 统一使用MySQL数据库作为数据源
   - 创建专用搜索API支持多维度搜索
   - 支持搜索建议和热门搜索

**执行方式选择：**

1. **Subagent-Driven（推荐）** - 使用subagent-driven-development逐任务执行，每个任务完成后进行review

2. **Inline Execution** - 使用executing-plans在当前会话中批量执行，设置检查点

请确认您希望采用哪种执行方式，或者是否需要对计划进行任何调整。
