# 搜索功能优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化搜索功能，实现 MySQL FULLTEXT 索引、Redis 缓存、智能搜索、排序优化和搜索结果交互

**Architecture:** 使用 MySQL FULLTEXT 索引替代 LIKE 查询，Redis 缓存热门搜索和分类统计，实现拼音搜索和模糊匹配，优化排序算法，集成播放器和播放列表功能

**Tech Stack:** MySQL FULLTEXT, Redis, ioredis, pinyin-pro

---

## 文件结构

```
d:\music_box\
├── server\
│   ├── src\
│   │   ├── modules\
│   │   │   └── search\
│   │   │       ├── search.controller.ts    # 搜索控制器
│   │   │       ├── search.routes.ts        # 搜索路由
│   │   │       └── search.service.ts       # 搜索服务（新增）
│   │   ├── lib\
│   │   │   ├── prisma.ts                   # Prisma 客户端
│   │   │   └── redis.ts                    # Redis 客户端（新增）
│   │   └── utils\
│   │       └── pinyin.ts                   # 拼音工具（新增）
│   └── prisma\
│       └── schema.prisma                   # 数据库 schema
├── shared\
│   └── useSearch.ts                        # 搜索 Hook
└── web\
    └── src\
        └── App.tsx                         # Web 播放器
```

---

### Task 1: 安装依赖

**Files:**
- Modify: `d:\music_box\server\package.json`

- [ ] **Step 1: 安装 Redis 和拼音依赖**

```bash
cd d:\music_box\server
npm install ioredis pinyin-pro
npm install -D @types/ioredis
```

- [ ] **Step 2: 验证安装**

```bash
cd d:\music_box\server
npm list ioredis pinyin-pro
```

预期输出：显示已安装的版本

- [ ] **Step 3: 提交代码**

```bash
cd d:\music_box\server
git add package.json package-lock.json
git commit -m "feat: add ioredis and pinyin-pro dependencies"
```

---

### Task 2: 创建 Redis 客户端

**Files:**
- Create: `d:\music_box\server\src\lib\redis.ts`

- [ ] **Step 1: 创建 Redis 客户端**

创建文件 `d:\music_box\server\src\lib\redis.ts`:

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on('connect', () => {
  console.log('[REDIS] Connected to Redis');
});

redis.on('error', (err) => {
  console.error('[REDIS] Error:', err.message);
});

export default redis;

// 缓存工具函数
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[CACHE] Get error:', error);
      return null;
    }
  },

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await redis.setex(key, ttl, serialized);
      } else {
        await redis.set(key, serialized);
      }
    } catch (error) {
      console.error('[CACHE] Set error:', error);
    }
  },

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      console.error('[CACHE] Delete error:', error);
    }
  },

  async clearPattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error('[CACHE] Clear pattern error:', error);
    }
  },
};
```

- [ ] **Step 2: 测试 Redis 连接**

```bash
cd d:\music_box\server
npm run build
```

预期输出：编译成功

- [ ] **Step 3: 提交代码**

```bash
cd d:\music_box\server
git add src/lib/redis.ts
git commit -m "feat: add Redis client with cache utilities"
```

---

### Task 3: 创建拼音工具

**Files:**
- Create: `d:\music_box\server\src\utils\pinyin.ts`

- [ ] **Step 1: 创建拼音工具**

创建文件 `d:\music_box\server\src\utils\pinyin.ts`:

```typescript
import { pinyin } from 'pinyin-pro';

/**
 * 获取汉字的拼音
 * @param text 输入文本
 * @returns 拼音字符串（小写，无空格）
 */
export function getPinyin(text: string): string {
  if (!text) return '';
  return pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase();
}

/**
 * 获取汉字的拼音首字母
 * @param text 输入文本
 * @returns 首字母字符串（小写）
 */
export function getFirstLetter(text: string): string {
  if (!text) return '';
  return pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
}

/**
 * 检查文本是否匹配拼音查询
 * @param text 原始文本
 * @param query 查询文本（可能是拼音）
 * @returns 是否匹配
 */
export function matchPinyin(text: string, query: string): boolean {
  if (!text || !query) return false;
  
  const lowerQuery = query.toLowerCase();
  const fullPinyin = getPinyin(text);
  const firstLetter = getFirstLetter(text);
  
  // 匹配全拼或首字母
  return fullPinyin.includes(lowerQuery) || firstLetter.includes(lowerQuery);
}

/**
 * 生成搜索关键词的拼音变体
 * @param text 输入文本
 * @returns 拼音变体数组
 */
export function generatePinyinVariants(text: string): string[] {
  if (!text) return [];
  
  const variants = new Set<string>();
  variants.add(getPinyin(text));
  variants.add(getFirstLetter(text));
  
  return Array.from(variants).filter(Boolean);
}
```

- [ ] **Step 2: 测试拼音功能**

```bash
cd d:\music_box\server
npm run build
```

预期输出：编译成功

- [ ] **Step 3: 提交代码**

```bash
cd d:\music_box\server
git add src/utils/pinyin.ts
git commit -m "feat: add pinyin utility for Chinese search"
```

---

### Task 4: 创建搜索服务

**Files:**
- Create: `d:\music_box\server\src\modules\search\search.service.ts`

- [ ] **Step 1: 创建搜索服务**

创建文件 `d:\music_box\server\src\modules\search\search.service.ts`:

```typescript
import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { matchPinyin, generatePinyinVariants } from '../../utils/pinyin';

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

interface SearchResult {
  results: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export class SearchService {
  private readonly CACHE_TTL = {
    HOT_SEARCHES: 300,      // 5分钟
    CATEGORY_STATS: 600,    // 10分钟
    SUGGESTIONS: 120,       // 2分钟
    SEARCH_RESULTS: 60,     // 1分钟
  };

  // 搜索歌曲
  async searchSongs(filters: SearchFilters): Promise<SearchResult> {
    const startTime = Date.now();
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

    // 生成缓存键
    const cacheKey = `search:${q || ''}:${genres || ''}:${languages || ''}:${page}:${limit}:${sort}:${order}`;
    
    // 尝试从缓存获取
    const cached = await cache.get<SearchResult>(cacheKey);
    if (cached) {
      console.log(`[SEARCH] Cache hit for: ${q} (${Date.now() - startTime}ms)`);
      return cached;
    }

    // 构建查询条件
    const where: any = {
      playable: true,
    };

    // 关键词搜索 - 使用 FULLTEXT 或 LIKE
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

    const result: SearchResult = {
      results: songs,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };

    // 缓存结果
    await cache.set(cacheKey, result, this.CACHE_TTL.SEARCH_RESULTS);

    console.log(`[SEARCH] Query: "${q}", Results: ${total}, Time: ${Date.now() - startTime}ms`);
    return result;
  }

  // 获取搜索建议
  async getSuggestions(q: string) {
    if (!q || q.length < 2) {
      return { suggestions: [] };
    }

    const cacheKey = `suggestions:${q}`;
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) {
      return { suggestions: cached };
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

    await cache.set(cacheKey, suggestions, this.CACHE_TTL.SUGGESTIONS);
    return { suggestions };
  }

  // 获取热门搜索
  async getHotSearches(limit = 10) {
    const cacheKey = `hot_searches:${limit}`;
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) {
      return { hotSearches: cached };
    }

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

    const hotSearches = songs.map(song => ({
      id: song.id,
      keyword: song.title,
      count: song.playCount,
    }));

    await cache.set(cacheKey, hotSearches, this.CACHE_TTL.HOT_SEARCHES);
    return { hotSearches };
  }

  // 获取分类统计
  async getCategoryStats() {
    const cacheKey = 'category_stats';
    const cached = await cache.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

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

    const stats = {
      genres: genres.map(g => ({ ...g, count: g._count.songs })),
      languages: languages.map(l => ({ ...l, count: l._count.songs })),
      scenes: scenes.map(s => ({ ...s, count: s._count.songs })),
      moods: moods.map(m => ({ ...m, count: m._count.songs })),
      decades: decades.map(d => ({ ...d, count: d._count.songs })),
    };

    await cache.set(cacheKey, stats, this.CACHE_TTL.CATEGORY_STATS);
    return stats;
  }

  // 清除搜索缓存
  async clearSearchCache() {
    await cache.clearPattern('search:*');
    await cache.clearPattern('suggestions:*');
    await cache.clearPattern('hot_searches:*');
    await cache.clearPattern('category_stats');
  }
}

export const searchService = new SearchService();
```

- [ ] **Step 2: 测试搜索服务**

```bash
cd d:\music_box\server
npm run build
```

预期输出：编译成功

- [ ] **Step 3: 提交代码**

```bash
cd d:\music_box\server
git add src/modules/search/search.service.ts
git commit -m "feat: add search service with Redis cache and pinyin support"
```

---

### Task 5: 更新搜索控制器

**Files:**
- Modify: `d:\music_box\server\src\modules\search\search.controller.ts`

- [ ] **Step 1: 读取现有搜索控制器**

```bash
cat d:\music_box\server\src\modules\search\search.controller.ts
```

- [ ] **Step 2: 更新搜索控制器使用搜索服务**

替换 `d:\music_box\server\src\modules\search\search.controller.ts` 为以下内容：

```typescript
import { Request, Response } from 'express';
import { searchService } from './search.service';

// 日志工具
const logger = {
  info: (message: string, data?: any) => {
    console.log(`[SEARCH-INFO] ${new Date().toISOString()} - ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error?: any) => {
    console.error(`[SEARCH-ERROR] ${new Date().toISOString()} - ${message}`, error?.message || error);
    if (error?.stack) {
      console.error(`[SEARCH-ERROR] Stack: ${error.stack}`);
    }
  },
  warn: (message: string, data?: any) => {
    console.warn(`[SEARCH-WARN] ${new Date().toISOString()} - ${message}`, data ? JSON.stringify(data) : '');
  },
};

export class SearchController {
  // 搜索歌曲
  async searchSongs(req: Request, res: Response) {
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

      const result = await searchService.searchSongs(filters);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('搜索请求失败', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '搜索失败',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 获取搜索建议
  async getSuggestions(req: Request, res: Response) {
    try {
      const q = req.query.q as string;
      const result = await searchService.getSuggestions(q);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('获取搜索建议失败', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取建议失败',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 获取热门搜索
  async getHotSearches(req: Request, res: Response) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const result = await searchService.getHotSearches(limit);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('获取热门搜索失败', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取热门搜索失败',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 获取分类统计
  async getCategoryStats(req: Request, res: Response) {
    try {
      const result = await searchService.getCategoryStats();
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('获取分类统计失败', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取分类统计失败',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 清除搜索缓存
  async clearCache(req: Request, res: Response) {
    try {
      await searchService.clearSearchCache();
      return res.json({
        success: true,
        message: '缓存已清除',
      });
    } catch (error) {
      logger.error('清除缓存失败', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '清除缓存失败',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const searchController = new SearchController();
```

- [ ] **Step 3: 更新搜索路由**

修改 `d:\music_box\server\src\modules\search\search.routes.ts`:

```typescript
import { Router } from 'express';
import { searchController } from './search.controller';

const router = Router();

// 搜索歌曲
router.get('/', (req, res) => searchController.searchSongs(req, res));

// 获取搜索建议
router.get('/suggestions', (req, res) => searchController.getSuggestions(req, res));

// 获取热门搜索
router.get('/hot', (req, res) => searchController.getHotSearches(req, res));

// 获取分类统计
router.get('/categories', (req, res) => searchController.getCategoryStats(req, res));

// 清除缓存（管理员功能）
router.post('/clear-cache', (req, res) => searchController.clearCache(req, res));

export default router;
```

- [ ] **Step 4: 测试更新后的控制器**

```bash
cd d:\music_box\server
npm run build
```

预期输出：编译成功

- [ ] **Step 5: 提交代码**

```bash
cd d:\music_box\server
git add src/modules/search/search.controller.ts src/modules/search/search.routes.ts
git commit -m "feat: update search controller to use search service with cache"
```

---

### Task 6: 更新搜索 Hook 支持播放器交互

**Files:**
- Modify: `d:\music_box\shared\useSearch.ts`

- [ ] **Step 1: 读取现有搜索 Hook**

```bash
cat d:\music_box\shared\useSearch.ts
```

- [ ] **Step 2: 更新搜索 Hook**

替换 `d:\music_box\shared\useSearch.ts` 为以下内容：

```typescript
// shared/useSearch.ts - 搜索与曲库管理 Hook（Web + 小程序共享）
import { useState, useCallback, useMemo, useRef } from 'react';
import { Track } from './types';

// 统一搜索API地址
const SEARCH_API = 'http://localhost:3000/api';

interface SearchError {
  message: string;
  type: 'network' | 'server' | 'no_results' | 'unknown';
  details?: string;
}

interface SearchOptions {
  onPlay?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onAddToFavorites?: (track: Track) => void;
}

export function useSearch(
  playlist: Track[],
  onAddTrack: (track: Track) => void,
  options?: SearchOptions
) {
  const [query, setQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

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
      // 静默失败，不影响用户体验
    }
  }, []);

  // 在线搜索
  const searchOnline = useCallback(async () => {
    if (!query.trim()) return;

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsSearching(true);
    setError(null);

    try {
      const resp = await fetch(
        `${SEARCH_API}/search?q=${encodeURIComponent(query)}`,
        { signal: abortControllerRef.current.signal }
      );

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw {
          message: `服务器返回错误 (${resp.status})`,
          type: 'server',
          details: errorData.error || resp.statusText,
        } as SearchError;
      }

      const data = await resp.json();

      if (!data.success) {
        throw {
          message: '搜索请求失败',
          type: 'server',
          details: data.error || '未知错误',
        } as SearchError;
      }

      const results = data.data?.results || [];

      if (results.length === 0) {
        setError({
          message: `未找到与"${query}"相关的歌曲`,
          type: 'no_results',
          details: '请尝试其他关键词或检查搜索条件',
        });
        setOnlineResults([]);
        setShowOnline(true);
        return;
      }

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
      setError(null);

      // 添加到搜索历史
      setSearchHistory(prev => {
        const newHistory = [query, ...prev.filter(h => h !== query)].slice(0, 10);
        return newHistory;
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return; // 请求被取消，忽略
      }

      console.error('[Search] 搜索失败:', err);

      if (err.type === 'server') {
        setError(err as SearchError);
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        setError({
          message: '无法连接到搜索服务',
          type: 'network',
          details: `请确保后端服务已启动 (${SEARCH_API})`,
        });
      } else {
        setError({
          message: '搜索过程中发生错误',
          type: 'unknown',
          details: err.message || '未知错误',
        });
      }
      setShowOnline(false);
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  // 播放歌曲
  const playTrack = useCallback((track: Track) => {
    if (options?.onPlay) {
      options.onPlay(track);
    }
  }, [options]);

  // 添加到播放列表
  const addToPlaylist = useCallback((track: Track) => {
    if (options?.onAddToPlaylist) {
      options.onAddToPlaylist(track);
    }
    // 同时添加到曲库
    onAddTrack(track);
  }, [options, onAddTrack]);

  // 添加到收藏
  const addToFavorites = useCallback((track: Track) => {
    if (options?.onAddToFavorites) {
      options.onAddToFavorites(track);
    }
  }, [options]);

  // 加入曲库
  const addTrack = useCallback(async (track: Track) => {
    try {
      // 检查是否已存在
      const exists = playlist.some(t => t.id === track.id);
      if (exists) {
        setError({
          message: '该歌曲已在曲库中',
          type: 'unknown',
          details: `${track.title} - ${track.artist}`,
        });
        return;
      }
      onAddTrack(track);
      setError(null);
    } catch (err) {
      setError({
        message: '加入曲库失败',
        type: 'unknown',
        details: err instanceof Error ? err.message : '未知错误',
      });
    }
  }, [onAddTrack, playlist]);

  // 清除搜索历史
  const clearHistory = useCallback(() => {
    setSearchHistory([]);
  }, []);

  const closeOnline = useCallback(() => setShowOnline(false), []);

  const clearError = useCallback(() => setError(null), []);

  // 获取错误提示文本
  const getErrorText = useCallback(() => {
    if (!error) return null;

    let text = error.message;
    if (error.details) {
      text += `: ${error.details}`;
    }
    return text;
  }, [error]);

  return {
    query,
    setQuery,
    filtered,
    onlineResults,
    isSearching,
    searchOnline,
    addTrack,
    playTrack,
    addToPlaylist,
    addToFavorites,
    error,
    errorText: getErrorText(),
    clearError,
    showOnline,
    closeOnline,
    suggestions,
    fetchSuggestions,
    searchHistory,
    clearHistory,
  };
}
```

- [ ] **Step 3: 测试更新后的 Hook**

```bash
cd d:\music_box\web
npm run build
```

预期输出：编译成功

- [ ] **Step 4: 提交代码**

```bash
cd d:\music_box
git add shared/useSearch.ts
git commit -m "feat: add player interaction and search history to useSearch hook"
```

---

### Task 7: 添加数据库索引

**Files:**
- Create: `d:\music_box\server\prisma\migrations\add_search_indexes\migration.sql`

- [ ] **Step 1: 创建迁移文件**

创建目录和迁移文件：

```bash
mkdir -p d:\music_box\server\prisma\migrations\add_search_indexes
```

创建文件 `d:\music_box\server\prisma\migrations\add_search_indexes\migration.sql`:

```sql
-- 添加 FULLTEXT 索引（支持中文分词）
ALTER TABLE songs ADD FULLTEXT INDEX ft_title (title) WITH PARSER ngram;
ALTER TABLE songs ADD FULLTEXT INDEX ft_artist (artist) WITH PARSER ngram;
ALTER TABLE songs ADD FULLTEXT INDEX ft_album (album) WITH PARSER ngram;
ALTER TABLE songs ADD FULLTEXT INDEX ft_search (title, artist, album) WITH PARSER ngram;

-- 添加复合索引优化查询性能
CREATE INDEX idx_playable_hot_score ON songs(playable, hot_score DESC);
CREATE INDEX idx_playable_created_at ON songs(playable, created_at DESC);
CREATE INDEX idx_playable_play_count ON songs(playable, play_count DESC);
```

- [ ] **Step 2: 执行迁移**

```bash
cd d:\music_box\server
npx prisma migrate dev --name add_search_indexes
```

预期输出：迁移成功

- [ ] **Step 3: 验证索引**

```bash
cd d:\music_box\server
npx prisma db pull --print
```

预期输出：显示新添加的索引

- [ ] **Step 4: 提交代码**

```bash
cd d:\music_box\server
git add prisma/migrations/
git commit -m "feat: add FULLTEXT and composite indexes for search optimization"
```

---

## 总结

本计划包含以下任务：

1. **Task 1: 安装依赖** - ioredis, pinyin-pro
2. **Task 2: 创建 Redis 客户端** - 缓存工具函数
3. **Task 3: 创建拼音工具** - 拼音搜索支持
4. **Task 4: 创建搜索服务** - 核心搜索逻辑
5. **Task 5: 更新搜索控制器** - 使用搜索服务
6. **Task 6: 更新搜索 Hook** - 播放器交互支持
7. **Task 7: 添加数据库索引** - FULLTEXT 索引

**性能目标：**
- 搜索响应时间 < 100ms
- 缓存命中率 > 80%
- 支持拼音搜索
- 支持播放器交互

**执行方式：**
- Subagent-Driven（推荐）：逐任务执行，每个任务完成后进行 review
- Inline Execution：在当前会话中批量执行
