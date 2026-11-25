import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { matchPinyin, generatePinyinVariants } from '../../utils/pinyin';
import { normalizeQuery, tokenizeQuery } from './query-utils';
import { BaseSearchService, SearchFilters, SearchResult, CACHE_TTL } from './search.base.service';
import { searchOnline } from './search-online.service';
import { config } from '../../config';

// ==================== 搜索评分器 ====================

class SearchScorer {
  // 拼音缓存，避免重复计算
  private static pinyinCache = new Map<string, string>();
  private static readonly MAX_CACHE_SIZE = 10000;

  /**
   * 单词相关性分数（2026-11-20 搜索升级：拆出单词条目打分，多词查询按词累加）
   */
  private static scoreForToken(song: any, tokenLower: string): number {
    let score = 0;
    const titleLower = song.title?.toLowerCase() || '';
    const artistLower = song.artist?.toLowerCase() || '';
    const albumLower = song.album?.toLowerCase() || '';

    // 标题完全匹配 - 最高分
    if (titleLower === tokenLower) {
      score += 100;
    }
    // 标题包含查询
    else if (titleLower.includes(tokenLower)) {
      score += 80;
      // 查询在标题开头
      if (titleLower.startsWith(tokenLower)) {
        score += 10;
      }
    }

    // 艺术家匹配（2026-11-20：精确命中 60→100，与标题同级——搜歌手名时该歌手的
    // 全部歌曲都应排在最前；补充歌手前缀命中 +10，重名歌手下不同歌手可按热度次序排开）
    if (artistLower === tokenLower) {
      score += 100;
      score += 10; // 歌手精确命中再叠加：保证同分歌手歌曲稳定聚拢
    } else if (artistLower.includes(tokenLower)) {
      score += 40;
      if (artistLower.startsWith(tokenLower)) {
        score += 10;
      }
    }

    // 专辑匹配
    if (albumLower === tokenLower) {
      score += 30;
    } else if (albumLower.includes(tokenLower)) {
      score += 20;
    }

    return score;
  }

  /**
   * 计算搜索结果相关性分数
   * 2026-11-20：多词查询（如"周杰伦 晴天"）按分词逐词累加，命中词越多分越高；
   * 旧实现（保留备查）：只拿整串 queryLower 做单次比对，组合词永远只得拼音/热度分。
   */
  static calculateRelevanceScore(song: any, query: string): number {
    const queryLower = query.toLowerCase();

    // 分词逐词累加（query 本身作为一个"词"参与，保证整串精确命中也拿满分）
    const tokens = Array.from(new Set([...tokenizeQuery(queryLower), queryLower]));
    let score = 0;
    for (const token of tokens) {
      if (token) score += this.scoreForToken(song, token);
    }

    // 可播放加成（2026-11-20 搜索升级）：关键词搜索不再硬过滤 playable=false 的歌曲
    //（部署包合规策略下网易云歌曲 playable=false，播放时经 /api/refresh-track 实时刷新兜底），
    // 但可用歌曲应排在不可播放歌曲之前
    if (song.playable !== false) {
      score += 30;
    }

    // 拼音匹配（使用缓存）
    const titleKey = song.title || '';
    let pinyinTitle = this.pinyinCache.get(titleKey);
    if (pinyinTitle === undefined) {
      pinyinTitle = matchPinyin(song.title || '', query) ? '1' : '';
      if (this.pinyinCache.size >= SearchScorer.MAX_CACHE_SIZE) {
        this.pinyinCache.clear();
      }
      this.pinyinCache.set(titleKey, pinyinTitle);
    }
    if (pinyinTitle === '1') {
      score += 50;
    }

    // 热度加成
    if (song.hotScore) {
      score += Math.min(20, song.hotScore / 1000);
    }

    return score;
  }

  /**
   * 对搜索结果进行排序
   */
  static sortResults(results: any[], query: string, sort?: string): any[] {
    return results.sort((a, b) => {
      // 首先按相关性分数排序
      const scoreA = this.calculateRelevanceScore(a, query);
      const scoreB = this.calculateRelevanceScore(b, query);
      
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      // 如果分数相同，按指定字段排序
      if (sort === 'play_count') {
        return (b.playCount || 0) - (a.playCount || 0);
      }
      if (sort === 'created_at') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      // 默认按热度排序
      return (b.hotScore || 0) - (a.hotScore || 0);
    });
  }
}

// ==================== 播放列表接口 ====================

interface PlaylistAddResult {
  success: boolean;
  message: string;
  playlistId?: number;
  songId?: string;
}

// ==================== 增强搜索服务 ====================

export class EnhancedSearchService extends BaseSearchService {
  /**
   * 增强搜索歌曲（支持拼音匹配和模糊搜索）
   * 2026-11-20 搜索升级：
   *  - 查询先 normalizeQuery 归一（全角/零宽字符/空白），与前端、线上搜索统一；
   *  - 取数窗口修复：一次取回匹配全集（上限 500）内存排序 + 内存分页，修复旧实现
   *    "skip+take(limit*2)+slice" 导致的第 2 页与第 1 页重复、高页码丢歌问题；
   *  - 拼音捞回：SQL contains 只能匹配字段原文，"zhoujielun/zjl" 这类拼音查询在
   *    中文歌手名上必然落空 → 主查询结果不足一页时，取全库（上限 2000）在内存做
   *    matchPinyin 二次过滤合并；
   *  - searchInfo.artists：命中集歌手聚合统计（歌手→歌曲关联 + 重名歌手场景）。
   */
  async searchSongs(filters: SearchFilters): Promise<SearchResult> {
    const startTime = Date.now();
    const {
      q: rawQ,
      page = 1,
      limit = 20,
      sort = 'hot_score',
      order = 'desc',
      fuzzy = true,
    } = filters;

    // 查询归一（2026-11-20）：全角→半角、去零宽字符、压缩空白
    // 旧实现（保留备查）：直接使用 filters.q 原文。
    //   const q = filters.q;
    const q = rawQ ? normalizeQuery(rawQ) : rawQ;

    // 参数验证和限制
    const validPage = Math.max(1, page);
    const validLimit = Math.min(config.search.maxLimit, Math.max(1, limit));

    // 生成缓存键
    const cacheKey = this.generateCacheKey('search_enhanced', filters);

    // 尝试从缓存获取
    const cached = await cache.get<SearchResult>(cacheKey);
    if (cached) {
      console.log(`[SEARCH-ENHANCED] Cache hit for: ${q} (${Date.now() - startTime}ms)`);
      return cached;
    }

    // 线上搜索（scope != local 且有关键词时）：与本地查询并行发起，互不阻塞。
    // searchOnline 内部自带超时闸门与 fail-open，任何故障都降级为空结果 + reason。
    // 2026-11-20：透传 onlineOffset 支持线上"加载更多"分页。
    const onlinePromise =
      q && filters.scope !== 'local' && config.search.online.enabled
        ? searchOnline(q, filters.scope, filters.onlineOffset ?? 0)
        : Promise.resolve(undefined);

    // 构建查询条件
    const where = this.buildCategoryFilter(filters);
    const orderBy = this.buildOrderBy(sort, order);

    // 如果启用模糊搜索，添加拼音变体
    // 2026-11-20：仅在单词查询时保留 —— 旧实现（保留备查）无条件把整串拼音变体并入
    // where.OR，多词时会破坏分词 AND 语义，且 SQL contains 匹配的是字段原文，
    // 中文歌名/歌手的拼音变体在库里不可能出现（拼音命中现由下方"拼音捞回"保证）。
    // if (q && fuzzy) {
    //   const pinyinVariants = generatePinyinVariants(q);
    //   if (pinyinVariants.length > 0) {
    //     const pinyinConditions = pinyinVariants.flatMap(variant => [
    //       { title: { contains: variant } },
    //       { artist: { contains: variant } },
    //     ]);
    //     if (where.OR) {
    //       where.OR = [...where.OR, ...pinyinConditions];
    //     } else {
    //       where.OR = pinyinConditions;
    //     }
    //   }
    // }
    const tokenCount = q ? tokenizeQuery(q).length : 0;
    if (q && fuzzy && tokenCount === 1) {
      const pinyinVariants = generatePinyinVariants(q);
      if (pinyinVariants.length > 0) {
        // 罗马字标题/歌手（如 "qing hua ci"）仍可能字面命中，保留单词场景的 SQL 层拼音扩展
        const pinyinConditions = pinyinVariants.flatMap(variant => [
          { title: { contains: variant, mode: 'insensitive' as const } },
          { artist: { contains: variant, mode: 'insensitive' as const } },
        ]);
        where.OR = [...(where.OR || []), ...pinyinConditions];
      }
    }

    // 按需加载关联 - 仅当存在对应筛选条件时才 include
    const include: Record<string, any> = {};
    if (filters.genres) include.genres = { include: { genre: true } };
    if (filters.languages) include.languages = { include: { language: true } };
    if (filters.scenes) include.scenes = { include: { scene: true } };
    if (filters.moods) include.moods = { include: { mood: true } };
    if (filters.decades) include.decades = { include: { decade: true } };
    if (filters.tags) include.tags = { include: { tag: true } };
    const includeArg: Record<string, any> = Object.keys(include).length > 0 ? { include } : {};

    // 执行查询
    // 旧实现（保留备查）：skip: (page-1)*limit, take: limit*2 + 排序后 slice(0,limit) ——
    // 相关性窗口与分页错位（第 2 页与第 1 页重复、窗口外歌曲永远搜不到）。
    // const [songs, total] = await Promise.all([
    //   prisma.song.findMany({ where, ...includeArg, skip: (validPage-1)*validLimit, take: validLimit*2, orderBy }),
    //   prisma.song.count({ where }),
    // ]);
    const total = await prisma.song.count({ where });
    let songs: any[] = await prisma.song.findMany({
      where,
      ...includeArg,
      skip: 0,
      // 匹配全集窗口：一次取回后内存排序 + 内存分页，保证排序与分页一致
      //（曲库规模 ~700 首，500 上限远大于常规单歌手命中量）
      take: q ? 500 : validLimit,
      orderBy,
    });

    // 拼音捞回（二次查询，2026-11-20）：主查询结果不足一页且开启 fuzzy 时，
    // 取全库（上限 2000）在内存做 matchPinyin 过滤合并 —— 覆盖"拼音/首字母搜中文歌手名"场景
    // 2026-11-20 补充：捞回池不过滤 playable（与关键词搜索一致）；
    // 旧实现（保留备查）：where: { playable: true, archived: false }
    if (q && fuzzy && songs.length < validLimit) {
      try {
        const pool = await prisma.song.findMany({
          where: { archived: false },
          take: 2000,
          orderBy,
        });
        const rescued = pool.filter(
          (s: any) =>
            matchPinyin(s.title || '', q) ||
            matchPinyin(s.artist || '', q) ||
            (s.album ? matchPinyin(s.album, q) : false)
        );
        const seen = new Set(songs.map((s: any) => s.id));
        songs = [...songs, ...rescued.filter((s: any) => !seen.has(s.id))];
        if (rescued.length > 0) {
          console.log(`[SEARCH-ENHANCED] Pinyin rescue for "${q}": +${rescued.length} songs`);
        }
      } catch (e) {
        // 捞回失败不影响主结果
        console.warn('[SEARCH-ENHANCED] pinyin rescue failed:', e instanceof Error ? e.message : e);
      }
    }

    // 对结果进行相关性排序
    let sortedSongs = songs;
    if (q) {
      sortedSongs = SearchScorer.sortResults(songs, q, sort);
    }

    // 分页截取（2026-11-20：窗口内内存分页，页码与排序完全一致）
    const pageStart = q ? (validPage - 1) * validLimit : 0;
    const paginatedSongs = q
      ? sortedSongs.slice(pageStart, pageStart + validLimit)
      : sortedSongs;

    // 歌手聚合（2026-11-20）：命中集中各歌手歌曲数 Top5 —— 支撑"歌手→歌曲"关联入口与
    // 重名歌手场景（同名歌手聚合为一条 count，其全部歌曲仍逐条保留在 results 中）
    const artistCounts = new Map<string, number>();
    for (const s of sortedSongs) {
      const a = (s.artist || '').trim();
      if (a) artistCounts.set(a, (artistCounts.get(a) || 0) + 1);
    }
    const topArtists = Array.from(artistCounts.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([artist, count]) => ({ artist, count }));

    // 不可播放歌曲统计（2026-11-20）：命中集中 playable=false 的数量，
    // 前端可提示"N 首歌曲音频未随库分发，播放时将自动刷新链接"
    const unplayableCount = sortedSongs.filter((s: any) => s.playable === false).length;

    // 线上结果：本地优先原则——线上结果只放附加段，不混入本地分页。
    // 线上条目按标题/歌手匹配度内部排序（mapJamendoTrack 保持 Jamendo 相关性序，
    // 这里对 items 做与本地一致的加分重排，让标题精确命中排前）。
    let online: SearchResult['online'];
    try {
      const onlineSection = await onlinePromise;
      if (onlineSection) {
        if (q && onlineSection.items.length > 1) {
          onlineSection.items.sort(
            (a, b) => SearchScorer.calculateRelevanceScore(b as any, q) - SearchScorer.calculateRelevanceScore(a as any, q)
          );
        }
        online = onlineSection;
      }
    } catch (e) {
      // 理论上 searchOnline 已 fail-open，这里兜底：线上故障绝不影响本地响应
      console.warn('[SEARCH-ENHANCED] online search failed unexpectedly:', e instanceof Error ? e.message : e);
    }

    const result: SearchResult = {
      results: paginatedSongs,
      pagination: {
        page: validPage,
        limit: validLimit,
        total,
        total_pages: Math.ceil(total / validLimit),
      },
      searchInfo: {
        query: q || '',
        fuzzy,
        pinyinMatched: q ? generatePinyinVariants(q).length > 0 : false,
        duration: Date.now() - startTime,
        // 歌手聚合（2026-11-20）：命中集歌手 Top5，前端渲染"歌手→歌曲"关联入口
        artists: topArtists,
        // 不可播放歌曲数量（2026-11-20）：播放时走 URL 实时刷新兜底
        unplayableCount,
        sources: {
          local: paginatedSongs.length,
          online: online?.items.length || 0,
          onlineAvailable: online?.available || false,
        },
      },
      ...(online ? { online } : {}),
    };

    // 缓存结果。线上超时的结果只短缓存 5s：既避免超时期间高频重复打线上 API，
    // 又允许缓存很快过期重试（配合 searchOnline 的后台回填，下次大概率直接命中）
    const timedOut = online && !online.available && (online.reason || '').startsWith('jamendo:timeout');
    await cache.set(cacheKey, result, timedOut ? 5 : CACHE_TTL.SEARCH_RESULTS);
    
    console.log(`[SEARCH-ENHANCED] Query: "${q}" - ${total} results (${Date.now() - startTime}ms)`);
    return result;
  }

  /**
   * 添加歌曲到播放列表
   */
  async addToPlaylist(userId: number, playlistId: number, songId: string): Promise<PlaylistAddResult> {
    try {
      // 验证播放列表存在且属于用户
      const playlist = await prisma.playlist.findFirst({
        where: {
          id: playlistId,
          userId: userId,
        },
      });

      if (!playlist) {
        return { success: false, message: '播放列表不存在' };
      }

      // 验证歌曲存在
      const song = await prisma.song.findUnique({
        where: { id: songId },
      });

      if (!song) {
        return { success: false, message: '歌曲不存在' };
      }

      // 检查歌曲是否已在播放列表中
      const existing = await prisma.playlistSong.findFirst({
        where: {
          playlistId: playlistId,
          songId: songId,
        },
      });

      if (existing) {
        return { success: false, message: '歌曲已在播放列表中' };
      }

      // 添加歌曲到播放列表
      await prisma.playlistSong.create({
        data: {
          playlistId: playlistId,
          songId: songId,
        },
      });

      return {
        success: true,
        message: '添加成功',
        playlistId,
        songId,
      };
    } catch (error) {
      console.error('[PLAYLIST] 添加歌曲失败:', error);
      return { success: false, message: '添加失败，请稍后重试' };
    }
  }

  /**
   * 从播放列表移除歌曲
   */
  async removeFromPlaylist(userId: number, playlistId: number, songId: string): Promise<PlaylistAddResult> {
    try {
      // 验证播放列表存在且属于用户
      const playlist = await prisma.playlist.findFirst({
        where: {
          id: playlistId,
          userId: userId,
        },
      });

      if (!playlist) {
        return { success: false, message: '播放列表不存在' };
      }

      // 删除歌曲
      await prisma.playlistSong.deleteMany({
        where: {
          playlistId: playlistId,
          songId: songId,
        },
      });

      return {
        success: true,
        message: '移除成功',
        playlistId,
        songId,
      };
    } catch (error) {
      console.error('[PLAYLIST] 移除歌曲失败:', error);
      return { success: false, message: '移除失败，请稍后重试' };
    }
  }

  /**
   * 获取播放列表中的歌曲
   */
  async getPlaylistSongs(playlistId: number, userId: number): Promise<any[] | null> {
    try {
      const playlist = await prisma.playlist.findFirst({
        where: {
          id: playlistId,
          userId: userId,
        },
        include: {
          songs: {
            include: {
              song: {
                include: {
                  genres: { include: { genre: true } },
                },
              },
            },
            orderBy: { addedAt: 'desc' },
          },
        },
      });

      if (!playlist) {
        return null;
      }

      return playlist.songs.map(ps => ps.song);
    } catch (error) {
      console.error('[PLAYLIST] 获取播放列表歌曲失败:', error);
      return null;
    }
  }
}

// 导出单例
export const enhancedSearchService = new EnhancedSearchService();

export default enhancedSearchService;
