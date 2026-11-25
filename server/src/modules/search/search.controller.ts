import { Request, Response } from 'express';
import { searchService } from './search.service';
import { enhancedSearchService } from './search-enhanced.service';
import { isRedisAvailable } from '../../lib/redis';
import { config } from '../../config';
import { isJamendoConfigured } from '../library/jamendo.service';
import { searchOnline } from './search-online.service';

// 结构化日志工具
const logger = {
  info: (message: string, data?: Record<string, any>) => {
    const logEntry = {
      level: 'info',
      timestamp: new Date().toISOString(),
      module: 'search',
      message,
      ...data,
    };
    console.log(JSON.stringify(logEntry));
  },
  error: (message: string, error?: any, context?: Record<string, any>) => {
    const logEntry: Record<string, any> = {
      level: 'error',
      timestamp: new Date().toISOString(),
      module: 'search',
      message,
      error: error?.message || error,
      ...context,
    };
    // 生产环境不打印完整堆栈
    if (process.env.NODE_ENV !== 'production' && error?.stack) {
      logEntry.stack = error.stack;
    }
    console.error(JSON.stringify(logEntry));
  },
  warn: (message: string, data?: Record<string, any>) => {
    const logEntry = {
      level: 'warn',
      timestamp: new Date().toISOString(),
      module: 'search',
      message,
      ...data,
    };
    console.warn(JSON.stringify(logEntry));
  },
};

// 输入验证和清理工具
const sanitize = {
  // 清理字符串输入，限制长度
  string: (value: any, maxLength: number = 100): string | undefined => {
    if (!value || typeof value !== 'string') return undefined;
    // 移除潜在的危险字符
    return value.trim().slice(0, maxLength);
  },
  
  // 验证并限制数字范围
  number: (value: any, min: number, max: number, defaultValue: number): number => {
    const num = parseInt(value);
    if (isNaN(num)) return defaultValue;
    return Math.min(max, Math.max(min, num));
  },
  
  // 验证排序字段
  sortField: (value: any): string => {
    const allowed = ['hot_score', 'play_count', 'created_at', 'title', 'artist'];
    return allowed.includes(value) ? value : 'hot_score';
  },
  
  // 验证排序方向
  sortOrder: (value: any): string => {
    return value === 'asc' ? 'asc' : 'desc';
  },

  // 验证搜索范围：local=仅本地库，all=本地+线上（默认 all，保持线上增量开启）
  scope: (value: any): string => {
    return value === 'local' ? 'local' : 'all';
  },
};

export class SearchController {
  // 搜索歌曲
  async searchSongs(req: Request, res: Response) {
    try {
      const filters = {
        q: sanitize.string(req.query.q, 100),
        genres: sanitize.string(req.query.genres, 200),
        languages: sanitize.string(req.query.languages, 200),
        scenes: sanitize.string(req.query.scenes, 200),
        moods: sanitize.string(req.query.moods, 200),
        decades: sanitize.string(req.query.decades, 100),
        tags: sanitize.string(req.query.tags, 200),
        platform: sanitize.string(req.query.platform, 50),
        sort: sanitize.sortField(req.query.sort),
        order: sanitize.sortOrder(req.query.order),
        scope: sanitize.scope(req.query.scope),
        // 线上搜索分页偏移（2026-11-20：加载更多场景，客户端累计已加载线上条数）
        onlineOffset: sanitize.number(req.query.onlineOffset, 0, 990, 0),
        page: sanitize.number(req.query.page, 1, 1000, 1),
        limit: sanitize.number(req.query.limit, 1, 100, 20),
      };

      const result = await enhancedSearchService.searchSongs(filters);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('搜索请求失败', error);
      return res.status(500).json({
        success: false,
        error: '搜索服务暂时不可用，请稍后再试',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 获取搜索建议
  async getSuggestions(req: Request, res: Response) {
    try {
      const q = sanitize.string(req.query.q, 50);
      if (!q || q.length < 1) {
        return res.json({ success: true, data: { suggestions: [] } });
      }
      const result = await searchService.getSuggestions(q);
      // 修复（2026-11-18）：前端 shared/useSearch.ts 读取 data.data?.suggestions，
      // 历史上后端返回裸数组导致搜索建议永远为空；现包一层 suggestions 键对齐前端。
      return res.json({
        success: true,
        data: { suggestions: result },
      });
    } catch (error) {
      logger.error('获取搜索建议失败', error);
      return res.status(500).json({
        success: false,
        error: '获取建议失败，请稍后再试',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 获取热门搜索
  async getHotSearches(req: Request, res: Response) {
    try {
      const limit = sanitize.number(req.query.limit, 1, 50, 10);
      const result = await searchService.getHotSearches(limit);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('获取热门搜索失败', error);
      return res.status(500).json({
        success: false,
        error: '获取热门搜索失败，请稍后再试',
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
        error: '获取分类统计失败，请稍后再试',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 线上专属搜索（强制只搜 Jamendo 线上源，不查本地库；用于探索新歌/本地无结果时兜底）
  async searchOnlineOnly(req: Request, res: Response) {
    try {
      const q = sanitize.string(req.query.q, 100);
      if (!q) {
        return res.json({
          success: true,
          data: { available: false, source: 'jamendo', items: [], reason: 'empty_query', duration: 0 },
        });
      }
      const result = await searchOnline(q);
      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error('线上搜索失败', error);
      return res.status(500).json({
        success: false,
        error: '线上搜索服务暂时不可用，请稍后再试',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 清除搜索缓存
  async clearCache(req: Request, res: Response) {
    try {
      await searchService.clearSearchCache();
      logger.info('缓存已清除', { userId: (req as any).user?.id });
      return res.json({
        success: true,
        message: '缓存已清除',
      });
    } catch (error) {
      logger.error('清除缓存失败', error);
      return res.status(500).json({
        success: false,
        error: '清除缓存失败，请稍后再试',
        timestamp: new Date().toISOString(),
      });
    }
  }

  // 搜索服务健康检查
  async healthCheck(req: Request, res: Response) {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'ok' as string,
        redis: isRedisAvailable() ? 'ok' : 'degraded',
        onlineSearch: config.search.online.enabled
          ? (isJamendoConfigured() ? 'ok' : 'stub')
          : 'disabled',
      },
    };
    try {
      // 简单数据库连通性检查
      await searchService.getHotSearches(1);
    } catch {
      health.status = 'degraded';
      health.services.database = 'error';
    }
    const statusCode = health.status === 'ok' ? 200 : 503;
    return res.status(statusCode).json(health);
  }
}

export const searchController = new SearchController();
