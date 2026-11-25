import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { runPython } from '../../lib/python-runner';
import { MUSIC_CRAWLER_SCRIPT } from '../../config';

// 分类定义
interface CategoryDef {
  id: string;
  name: string;
  description: string;
  // 数据库筛选关键词（匹配 title/artist/album）
  dbKeywords: string[];
  // Python 爬虫搜索关键词（用于补充不足的歌曲）
  crawlKeywords: string[];
}

export const CATEGORY_DEFS: CategoryDef[] = [
  {
    id: 'classic',
    name: '经典曲目',
    description: '岁月沉淀的金曲',
    dbKeywords: ['经典', '岁月', '怀旧', '老歌', '情歌', '回忆'],
    crawlKeywords: ['经典老歌', '怀旧金曲', '90年代经典'],
  },
  {
    id: 'edm',
    name: '电子嘻哈',
    description: 'EDM与Hip-Hop节奏',
    dbKeywords: ['电子', '嘻哈', 'edm', 'hip-hop', 'hiphop', 'rap', 'dj', '电音', 'dance', 'beat'],
    crawlKeywords: ['电子音乐', '嘻哈rap', 'EDM', 'hip hop'],
  },
  {
    id: 'cpop',
    name: '华语流行',
    description: '华语流行歌手精选',
    dbKeywords: ['周杰伦', '林俊杰', '五月天', '王菲', '陈奕迅', '张学友', '张惠妹', '蔡依林', '梁静茹', '孙燕姿', '华晨宇', '毛不易'],
    crawlKeywords: ['华语流行', '中文流行', '华语经典'],
  },
  {
    id: 'western',
    name: '欧美经典',
    description: 'Western Pop Classics',
    dbKeywords: ['backstreet', 'justin', 'adele', 'taylor', 'swift', 'ed sheeran', 'coldplay', 'maroon', 'bruno mars'],
    crawlKeywords: ['english pop', 'classic rock', 'western music'],
  },
  {
    id: 'folk',
    name: '民谣清吧',
    description: '安静民谣精选',
    dbKeywords: ['宋冬野', '陈粒', '赵雷', '陈鸿宇', '花粥', '房东的猫', '民谣', '李志', '郝云', '马頔'],
    crawlKeywords: ['民谣', '独立音乐', 'folk music'],
  },
  {
    id: 'trending',
    name: '抖音热歌',
    description: '播放量最高50首',
    dbKeywords: [],  // 特殊：按 hotScore 排序
    crawlKeywords: ['抖音热歌', '热门歌曲', '网络热门'],
  },
  {
    id: 'night',
    name: '安静夜晚',
    description: '助眠轻音乐',
    dbKeywords: ['晚安', '夜', '钢琴', '轻音乐', '安静', 'sleep', 'moon', 'lullaby'],
    crawlKeywords: ['轻音乐', '钢琴曲', 'sleep music'],
  },
];

const CATEGORY_CACHE_KEY = (categoryId: string) => `category:${categoryId}:songs`;
const CATEGORY_CACHE_TTL = 25 * 60 * 60; // 25小时

// 内存缓存降级
const memoryCache = new Map<string, { songs: any[]; expiry: number }>();

/**
 * 获取分类歌单（100首）
 * 1. 先从数据库筛选
 * 2. 不足100首时，调用 Python 爬虫补充
 */
export async function getCategorySongs(categoryId: string): Promise<{ count: number; songs: any[] }> {
  // 热门推荐特殊处理
  if (categoryId === 'hot') {
    const { getHot100 } = await import('./hot100.service');
    return getHot100();
  }

  const categoryDef = CATEGORY_DEFS.find(c => c.id === categoryId);
  if (!categoryDef) {
    return { count: 0, songs: [] };
  }

  // 先尝试 Redis 缓存
  const cacheKey = CATEGORY_CACHE_KEY(categoryId);
  const cached = await cache.get<any[]>(cacheKey);
  if (cached && cached.length > 0) {
    return { count: cached.length, songs: cached };
  }

  // 内存缓存
  const memCached = memoryCache.get(categoryId);
  if (memCached && Date.now() < memCached.expiry) {
    return { count: memCached.songs.length, songs: memCached.songs };
  }

  // 从数据库筛选
  let songs = await fetchFromDatabase(categoryDef);

  // 不足100首，调用 Python 爬虫补充
  if (songs.length < 100) {
    const needed = 100 - songs.length;
    console.log(`[CATEGORY] ${categoryDef.name} 数据库仅 ${songs.length} 首，爬取补充 ${needed} 首`);
    const crawled = await crawlByKeywords(categoryDef.crawlKeywords, needed);
    // 去重合并（同时过滤无音频 URL 的歌曲，确保分类内歌曲都可播放）
    const existingIds = new Set(songs.map(s => s.id));
    const existingTitles = new Set(songs.map(s => `${s.title}|${s.artist}`.toLowerCase()));
    for (const song of crawled) {
      if (!song.audioUrl || !song.audioUrl.trim()) continue; // 过滤不可播放
      const key = `${song.title}|${song.artist}`.toLowerCase();
      if (!existingTitles.has(key) && !existingIds.has(song.id)) {
        songs.push(song);
        existingIds.add(song.id);
        existingTitles.add(key);
      }
      if (songs.length >= 100) break;
    }
  }

  // 确保最多100首
  songs = songs.slice(0, 100);

  // 缓存
  await cache.set(cacheKey, songs, CATEGORY_CACHE_TTL);
  memoryCache.set(categoryId, { songs, expiry: Date.now() + CATEGORY_CACHE_TTL * 1000 });

  console.log(`[CATEGORY] ${categoryDef.name} 返回 ${songs.length} 首`);
  return { count: songs.length, songs };
}

/**
 * 从数据库筛选分类歌曲
 */
async function fetchFromDatabase(categoryDef: CategoryDef): Promise<any[]> {
  if (categoryDef.dbKeywords.length === 0) {
    // 抖音热歌：按 hotScore 排序
    const songs = await prisma.song.findMany({
      where: { playable: true, archived: false },
      orderBy: { hotScore: 'desc' },
      take: 100,
    });
    return songs.map(mapSong);
  }

  // 按关键词筛选
  const conditions = categoryDef.dbKeywords.map(kw => ({
    OR: [
      { title: { contains: kw } },
      { artist: { contains: kw } },
      { album: { contains: kw } },
    ],
  }));

  const songs = await prisma.song.findMany({
    where: {
      playable: true,
      archived: false,
      OR: conditions.flatMap(c => c.OR),
    },
    orderBy: { hotScore: 'desc' },
    take: 100,
  });

  return songs.map(mapSong);
}

/**
 * 调用 Python 爬虫按关键词搜索歌曲
 */
async function crawlByKeywords(keywords: string[], limit: number): Promise<any[]> {
  const allSongs: any[] = [];
  const perKeywordLimit = Math.ceil(limit / keywords.length) + 10;

  for (const keyword of keywords) {
    if (allSongs.length >= limit) break;
    try {
      const { stdout } = await runPython([
        MUSIC_CRAWLER_SCRIPT,
        'search',
        keyword,
        '--limit', String(perKeywordLimit),
      ], { timeout: 120000 }); // 2分钟超时

      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        allSongs.push(...parsed);
      }
    } catch (error) {
      console.error(`[CATEGORY] 爬取关键词 "${keyword}" 失败:`, error);
    }
  }

  return allSongs;
}

/**
 * 将数据库 Song 映射为前端格式
 */
function mapSong(s: any): any {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album || undefined,
    albumCover: s.albumCover || undefined,
    audioUrl: s.audioUrl,
    lyricContent: s.lyricContent || undefined,
    coverColor: s.coverColor || '#6366F1',
    duration: s.duration ? s.duration * 1000 : undefined, // 数据库存储秒，前端需要毫秒
    platform: s.platform || 'netease',
    playable: s.playable,
  };
}

/**
 * 刷新所有分类歌单（供调度器调用）
 */
export async function refreshAllCategories(): Promise<void> {
  for (const category of CATEGORY_DEFS) {
    try {
      console.log(`[CATEGORY] 刷新 ${category.name}...`);
      const result = await getCategorySongs(category.id);
      console.log(`[CATEGORY] ${category.name}: ${result.count} 首`);
    } catch (error) {
      console.error(`[CATEGORY] 刷新 ${category.name} 失败:`, error);
    }
  }
}
