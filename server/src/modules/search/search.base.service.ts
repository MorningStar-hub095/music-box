import crypto from 'crypto';
import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { config } from '../../config';
import type { OnlineSection } from './search-online.service';
import { buildKeywordConditions } from './query-utils';

// ==================== 共享类型定义 ====================

export interface SearchFilters {
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
  fuzzy?: boolean;
  /** 搜索范围：local=仅本地库（默认行为不变），all=本地+线上（Jamendo CC 增量） */
  scope?: string;
  /** 线上搜索分页偏移（2026-11-20 新增：加载更多场景，客户端累计已加载线上条数） */
  onlineOffset?: number;
}

export interface SearchResult {
  results: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  searchInfo?: {
    query: string;
    fuzzy: boolean;
    pinyinMatched: boolean;
    duration: number;
    /** 线上搜索附加段（scope=all 时存在；本地优先，线上结果不混入 results 分页） */
    /** 歌手聚合 Top5（2026-11-20 新增：歌手→歌曲关联 + 重名歌手场景） */
    artists?: { artist: string; count: number }[];
    /** 命中集中不可播放（playable=false）歌曲数量（2026-11-20 新增，播放走 URL 刷新兜底） */
    unplayableCount?: number;
    sources?: {
      local: number;
      online: number;
      onlineAvailable: boolean;
    };
  };
  /** 线上搜索增量结果（Jamendo CC 授权，platform=jamendo） */
  online?: OnlineSection;
}

export interface Suggestion {
  id: string;
  /** 建议类型：song=歌曲，artist=歌手聚合入口（2026-11-20 新增，缺省视为 song） */
  type?: 'song' | 'artist';
  title: string;
  artist: string;
  album?: string;
  /** type='artist' 时为该歌手命中歌曲数 */
  count?: number;
  /** 是否可直接播放（2026-11-20：false 表示音频未随库分发，播放时走 URL 实时刷新兜底） */
  playable?: boolean;
}

export interface CategoryStats {
  genres: { id: number; name: string; count: number }[];
  languages: { id: number; name: string; count: number }[];
  scenes: { id: number; name: string; count: number }[];
  moods: { id: number; name: string; count: number }[];
  decades: { id: number; name: string; count: number }[];
  tags: { id: number; name: string; count: number }[];
  platforms: { platform: string; count: number }[];
}

// ==================== 缓存配置 ====================

export const CACHE_TTL = {
  HOT_SEARCHES: config.cache.hotSearchTtl,
  CATEGORY_STATS: config.cache.defaultTtl,
  SUGGESTIONS: 120,
  SEARCH_RESULTS: config.cache.searchTtl,
};

// ==================== 基础搜索服务 ====================

export abstract class BaseSearchService {
  /**
   * 生成缓存键（使用MD5哈希避免注入和过长）
   */
  protected generateCacheKey(prefix: string, filters: Record<string, any>): string {
    const filtersStr = JSON.stringify(filters);
    return `${prefix}:${crypto.createHash('md5').update(filtersStr).digest('hex')}`;
  }

  /**
   * 构建分类筛选条件
   * 2026-11-20 搜索升级（不可播放歌曲可见化）：
   *  - 旧实现（保留备查）：恒定 playable: true + archived: false —— 部署包合规策略下
   *    网易云歌曲全部 playable=false（音频不随包分发，播放时经 /api/refresh-track
   *    实时刷新兜底），导致关键词搜索永远搜不到任何中文/网易云歌曲（如"华晨宇"0 结果）。
   *  - 新策略：有关键词时不再硬过滤 playable（搜得到、可见、排序靠后，播放走既有
   *    URL 刷新链路）；无关键词的浏览场景维持只看可播放歌曲（playable: true）。
   */
  protected buildCategoryFilter(filters: SearchFilters): any {
    // 旧实现（保留备查）：const where: any = { playable: true, archived: false };
    const where: any = { archived: false };
    if (!filters.q) {
      where.playable = true; // 浏览场景（无关键词）：维持只看可播放
    }

    // 关键词搜索（2026-11-20 搜索升级）
    // 旧实现（保留备查）：整串 contains、区分大小写、不分词 —— 英文歌手名大小写不一致即搜不到，
    // "歌手 歌名"组合词永不命中，全角/零宽字符不归一。
    // if (filters.q) {
    //   where.OR = [
    //     { title: { contains: filters.q } },
    //     { artist: { contains: filters.q } },
    //     { album: { contains: filters.q } },
    //   ];
    // }
    if (filters.q) {
      const kw = buildKeywordConditions(filters.q);
      if (kw.or) where.OR = kw.or;
      if (kw.and) where.AND = kw.and;
    }

    // 音乐类型筛选
    if (filters.genres) {
      const genreIds = filters.genres.split(',').map(Number).filter(n => !isNaN(n));
      if (genreIds.length > 0) {
        where.genres = { some: { genreId: { in: genreIds } } };
      }
    }

    // 语言筛选
    if (filters.languages) {
      const languageIds = filters.languages.split(',').map(Number).filter(n => !isNaN(n));
      if (languageIds.length > 0) {
        where.languages = { some: { languageId: { in: languageIds } } };
      }
    }

    // 场景筛选
    if (filters.scenes) {
      const sceneIds = filters.scenes.split(',').map(Number).filter(n => !isNaN(n));
      if (sceneIds.length > 0) {
        where.scenes = { some: { sceneId: { in: sceneIds } } };
      }
    }

    // 心情筛选
    if (filters.moods) {
      const moodIds = filters.moods.split(',').map(Number).filter(n => !isNaN(n));
      if (moodIds.length > 0) {
        where.moods = { some: { moodId: { in: moodIds } } };
      }
    }

    // 年代筛选
    if (filters.decades) {
      const decadeIds = filters.decades.split(',').map(Number).filter(n => !isNaN(n));
      if (decadeIds.length > 0) {
        where.decades = { some: { decadeId: { in: decadeIds } } };
      }
    }

    // 标签筛选
    if (filters.tags) {
      const tagIds = filters.tags.split(',').map(Number).filter(n => !isNaN(n));
      if (tagIds.length > 0) {
        where.tags = { some: { tagId: { in: tagIds } } };
      }
    }

    // 平台筛选
    if (filters.platform) {
      where.platform = filters.platform;
    }

    return where;
  }

  /**
   * 构建排序条件
   * API 使用 snake_case（如 hot_score），Prisma 需要 camelCase（如 hotScore）
   */
  private static readonly sortFieldMap: Record<string, string> = {
    'hot_score': 'hotScore',
    'play_count': 'playCount',
    'created_at': 'createdAt',
    'title': 'title',
    'artist': 'artist',
  };

  protected buildOrderBy(sort?: string, order?: string): any {
    const validSortFields = Object.keys(BaseSearchService.sortFieldMap);
    const requestedField = validSortFields.includes(sort || '') ? sort! : 'hot_score';
    const prismaField = BaseSearchService.sortFieldMap[requestedField];
    const sortOrder = order === 'asc' ? 'asc' : 'desc';

    return { [prismaField]: sortOrder };
  }

  /**
   * 获取搜索建议（共享实现）
   */
  async getSuggestions(q: string): Promise<Suggestion[]> {
    // 空串与纯空白查询直接返回，避免无效查库与缓存污染
    if (!q || q.trim().length < 1) {
      return [];
    }
    const query = q.trim();

    const cacheKey = this.generateCacheKey('suggestions', { q });
    const cached = await cache.get<Suggestion[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2026-11-20 搜索升级：歌手聚合建议 + 大小写不敏感
    // 旧实现（保留备查）：仅歌曲建议、contains 区分大小写 —— 搜歌手名时看不到"歌手"入口，
    // 英文名大小写不一致时建议为空。
    // const songs = await prisma.song.findMany({
    //   where: {
    //     playable: true,
    //     archived: false,
    //     OR: [
    //       { title: { contains: query } },
    //       { artist: { contains: query } },
    //     ],
    //   },
    //   select: { id: true, title: true, artist: true, album: true },
    //   take: 10,
    //   orderBy: { hotScore: 'desc' },
    // });
    const [songs, artistGroups] = await Promise.all([
      prisma.song.findMany({
        where: {
          // 2026-11-20：不再过滤 playable（与关键词搜索一致——不可播放歌曲也可见，
          // playable 字段随条目返回供前端标注）；旧实现（保留备查）含 playable: true。
          archived: false,
          OR: [
            { title: { contains: query, mode: 'insensitive' as const } },
            { artist: { contains: query, mode: 'insensitive' as const } },
          ],
        },
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          playable: true,
        },
        take: 10,
        orderBy: { hotScore: 'desc' },
      }),
      // 歌手聚合：命中歌手名的歌手分组计数（重名歌手自然聚合为一条，count 为其歌曲总数）
      prisma.song.groupBy({
        by: ['artist'],
        where: {
          // 2026-11-20：与歌曲建议一致，不过滤 playable；旧实现（保留备查）含 playable: true。
          archived: false,
          artist: { contains: query, mode: 'insensitive' as const },
        },
        _count: true,
        orderBy: { artist: 'asc' },
        take: 5,
      }) as any,
    ]);

    // 歌手条目在前（type='artist'，title 复用歌手名以兼容旧 UI 的 title 渲染），
    // 歌曲条目在后（type='song'）。前端按 data.data?.suggestions 读取，结构只增不改。
    const artistSuggestions: Suggestion[] = (artistGroups as any[]).map(g => ({
      id: `artist:${g.artist}`,
      type: 'artist' as const,
      title: g.artist,
      artist: g.artist,
      count: g._count,
    }));
    const songSuggestions: Suggestion[] = songs.map(song => ({
      id: song.id.toString(),
      type: 'song' as const,
      title: song.title,
      artist: song.artist,
      album: song.album || undefined,
      playable: song.playable !== false,
    }));

    const suggestions: Suggestion[] = [...artistSuggestions, ...songSuggestions];

    await cache.set(cacheKey, suggestions, CACHE_TTL.SUGGESTIONS);
    return suggestions;
  }

  /**
   * 获取热门搜索（共享实现）
   */
  async getHotSearches(limit: number = 10): Promise<any[]> {
    const cacheKey = this.generateCacheKey('hot_searches', { limit });
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const songs = await prisma.song.findMany({
      where: {
        playable: true,
        archived: false,
      },
      select: {
        id: true,
        title: true,
        artist: true,
        playCount: true,
        hotScore: true,
      },
      take: limit,
      orderBy: { hotScore: 'desc' },
    });

    await cache.set(cacheKey, songs, CACHE_TTL.HOT_SEARCHES);
    return songs;
  }

  /**
   * 获取分类统计（共享实现）
   */
  async getCategoryStats(): Promise<CategoryStats> {
    const cacheKey = 'category_stats';
    const cached = await cache.get<CategoryStats>(cacheKey);
    if (cached) {
      return cached;
    }

    const [
      genres,
      languages,
      scenes,
      moods,
      decades,
      tags,
      platforms,
    ] = await Promise.all([
      prisma.genre.findMany({
        include: { _count: { select: { songs: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.language.findMany({
        include: { _count: { select: { songs: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.scene.findMany({
        include: { _count: { select: { songs: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.mood.findMany({
        include: { _count: { select: { songs: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.decade.findMany({
        include: { _count: { select: { songs: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.tag.findMany({
        include: { _count: { select: { songs: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.song.groupBy({
        by: ['platform'],
        where: { playable: true, archived: false },
        _count: true,
      }),
    ]);

    const stats: CategoryStats = {
      genres: genres.map(g => ({ id: g.id, name: g.name, count: g._count.songs })),
      languages: languages.map(l => ({ id: l.id, name: l.name, count: l._count.songs })),
      scenes: scenes.map(s => ({ id: s.id, name: s.name, count: s._count.songs })),
      moods: moods.map(m => ({ id: m.id, name: m.name, count: m._count.songs })),
      decades: decades.map(d => ({ id: d.id, name: d.name, count: d._count.songs })),
      tags: tags.map(t => ({ id: t.id, name: t.name, count: t._count.songs })),
      platforms: platforms.map(p => ({ platform: p.platform || 'unknown', count: p._count })),
    };

    await cache.set(cacheKey, stats, CACHE_TTL.CATEGORY_STATS);
    return stats;
  }

  /**
   * 清除搜索缓存
   */
  async clearSearchCache(): Promise<void> {
    await cache.clearPattern('search:*');
    await cache.clearPattern('suggestions:*');
    await cache.clearPattern('hot_searches:*');
    await cache.del('category_stats');
    const { clearOnlineSearchCache } = await import('./search-online.service');
    clearOnlineSearchCache();
  }
}

export default BaseSearchService;
