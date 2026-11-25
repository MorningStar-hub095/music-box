import { SearchService } from '../src/modules/search/search.service';
import { buildOrderByHarness } from './helpers/search-orderby';

// mock prisma 与缓存，隔离数据库
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      // 2026-11-20 搜索升级：getSuggestions 新增歌手聚合查询（song.groupBy）
      groupBy: jest.fn().mockResolvedValue([]),
    },
  },
}));
jest.mock('../src/lib/redis', () => ({
  cache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    clearPattern: jest.fn().mockResolvedValue(true),
  },
  withRedis: jest.fn(async (fn: any, fb: any) => fb),
}));

const prisma = require('../src/lib/prisma').default;
const { cache } = require('../src/lib/redis');

describe('SearchService（基础搜索）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('getSuggestions', () => {
    it('空查询直接返回空数组，不查库', async () => {
      expect(await new SearchService().getSuggestions('')).toEqual([]);
      expect(await new SearchService().getSuggestions('   ')).toEqual([]);
      expect(prisma.song.findMany).not.toHaveBeenCalled();
    });

    it('正常查询走库并写缓存，DB 层限制 take 10', async () => {
      prisma.song.findMany.mockResolvedValueOnce(
        Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `t${i}`, artist: 'a', album: null }))
      );
      const r = await new SearchService().getSuggestions('周杰伦');
      // 结果为 mock 数据的映射（截断由 DB 层 take:10 保证，这里校验参数）
      expect(r).toHaveLength(12);
      expect(r[0].id).toBe('0');
      expect(r[0].album).toBeUndefined(); // null album 映射为 undefined
      expect(prisma.song.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
      expect(cache.set).toHaveBeenCalled();
    });

    it('缓存命中不查库', async () => {
      cache.get.mockResolvedValueOnce([{ id: '1', title: 'x', artist: 'y' }]);
      const r = await new SearchService().getSuggestions('x');
      expect(r[0].id).toBe('1');
      expect(prisma.song.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getHotSearches', () => {
    it('limit 透传给查询', async () => {
      await new SearchService().getHotSearches(5);
      expect(prisma.song.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    });

    it('缓存命中不查库', async () => {
      cache.get.mockResolvedValueOnce([{ id: '9' }]);
      const r = await new SearchService().getHotSearches();
      expect(r[0].id).toBe('9');
      expect(prisma.song.findMany).not.toHaveBeenCalled();
    });
  });

  describe('clearSearchCache', () => {
    it('清除全部搜索相关缓存键', async () => {
      await new SearchService().clearSearchCache();
      expect(cache.clearPattern).toHaveBeenCalledWith('search:*');
      expect(cache.clearPattern).toHaveBeenCalledWith('suggestions:*');
      expect(cache.clearPattern).toHaveBeenCalledWith('hot_searches:*');
      expect(cache.del).toHaveBeenCalledWith('category_stats');
    });
  });

  describe('排序字段映射（snake_case → Prisma camelCase）', () => {
    const harness = buildOrderByHarness(SearchService);

    it('hot_score → hotScore，默认 desc', () => {
      expect(harness('hot_score', 'desc')).toEqual({ hotScore: 'desc' });
    });

    it('play_count → playCount', () => {
      expect(harness('play_count', 'asc')).toEqual({ playCount: 'asc' });
    });

    it('非法字段回退 hot_score，非法 order 回退 desc', () => {
      expect(harness('evil;--', 'weird')).toEqual({ hotScore: 'desc' });
    });
  });
});
