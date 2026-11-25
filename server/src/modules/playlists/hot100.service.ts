import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { runPython } from '../../lib/python-runner';
import { MUSIC_CRAWLER_SCRIPT } from '../../config';

const HOT100_CACHE_KEY = 'hot100:songs';
const HOT100_CACHE_TTL = 25 * 60 * 60; // 25小时

// 内存缓存降级方案（Redis不可用时使用）
let memoryCache: Hot100Song[] | null = null;
let memoryCacheExpiry: number = 0;
let isRefreshing = false;

interface Hot100Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl: string;
  lyricContent?: string;
  coverColor: string;
  duration?: number;
  platform: string;
  playable: boolean;
}

export async function refreshHot100(): Promise<{ count: number; addedCount: number; songs: Hot100Song[] }> {
  // 防止并发刷新
  if (isRefreshing) {
    console.log('[HOT100] 刷新正在进行中，返回缓存数据');
    if (memoryCache && Date.now() < memoryCacheExpiry) {
      return { count: memoryCache.length, addedCount: 0, songs: memoryCache };
    }
    return { count: 0, addedCount: 0, songs: [] };
  }
  isRefreshing = true;
  console.log('[HOT100] 开始刷新热门100首...');

  try {
    // 调用 Python 爬虫
    let songs: Hot100Song[] = [];
    try {
      const { stdout } = await runPython([
        MUSIC_CRAWLER_SCRIPT,
        'hot100',
        '--limit', '100',
      ], { timeout: 300000 }); // 5分钟超时
      const parsed = JSON.parse(stdout);
      songs = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('[HOT100] Python爬虫调用失败:', error);
      // 降级：从数据库取热度最高的100首
      songs = await getTop100FromDB();
    }

    if (songs.length === 0) {
      songs = await getTop100FromDB();
    }

    // 过滤掉无有效音频 URL 的歌曲，确保所有新增歌曲都包含可播放音频 URL
    songs = songs.filter(s => s.audioUrl && s.audioUrl.trim());

    // 新增歌曲计数（create 而非 update）
    let addedCount = 0;

    // 批量写入数据库（使用事务提升性能）
    if (songs.length > 0) {
      // 先用一次查询查出所有已存在的歌曲（基于 ID 或 title+artist）
      const existingSongs = await prisma.song.findMany({
        where: {
          OR: [
            { id: { in: songs.map(s => s.id) } },
            ...songs.map(s => ({ title: s.title, artist: s.artist })),
          ],
        },
        select: { id: true, title: true, artist: true },
      });

      // 建立 ID 集合与 title|artist -> id 映射（避免重复 ID 导致唯一约束冲突）
      const existingIds = new Set(existingSongs.map(s => s.id));
      const existingMap = new Map(existingSongs.map(s => [`${s.title}|${s.artist}`, s.id]));

      // 收集所有需要执行的数据库操作（update 或 create）
      const operations = songs.map((song, i) => {
        // 优先按 ID（主键）判断，其次按 title|artist 去重
        const existingId = existingIds.has(song.id) ? song.id : existingMap.get(`${song.title}|${song.artist}`);
        if (existingId) {
          return prisma.song.update({
            where: { id: existingId },
            data: {
              audioUrl: song.audioUrl,
              lyricContent: song.lyricContent,
              albumCover: song.albumCover,
              coverColor: song.coverColor,
              duration: song.duration || null,
              playable: true,
              hotScore: 100 - i,
              urlCheckedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
        addedCount++; // 记录新增歌曲数量
        return prisma.song.create({
          data: {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album || null,
            albumCover: song.albumCover || null,
            audioUrl: song.audioUrl,
            lyricContent: song.lyricContent || null,
            coverColor: song.coverColor || '#6366F1',
            duration: song.duration || null,
            platform: song.platform || 'netease',
            playable: true,
            archived: false,
            dataSource: 'crawler',
            hotScore: 100 - i,
            playCount: 0,
            importedAt: new Date(),
            urlCheckedAt: new Date(),
          },
        });
      });

      // 在一个事务中批量执行所有写入
      await prisma.$transaction(operations);
    }

    // 缓存到Redis
    await cache.set(HOT100_CACHE_KEY, songs, HOT100_CACHE_TTL);
    // 同时写入内存缓存（Redis不可用时的降级方案）
    memoryCache = songs;
    memoryCacheExpiry = Date.now() + HOT100_CACHE_TTL * 1000;
    console.log(`[HOT100] 刷新完成: ${songs.length} 首`);

    return { count: songs.length, addedCount, songs };
  } finally {
    // 无论成功或失败，都重置刷新标志，防止后续请求被永久阻塞
    isRefreshing = false;
  }
}

export async function getHot100(): Promise<{ count: number; songs: Hot100Song[] }> {
  // 先尝试Redis缓存
  const cached = await cache.get<Hot100Song[]>(HOT100_CACHE_KEY);
  if (cached && cached.length > 0) {
    return { count: cached.length, songs: cached };
  }

  // Redis未命中，尝试内存缓存
  if (memoryCache && Date.now() < memoryCacheExpiry) {
    return { count: memoryCache.length, songs: memoryCache };
  }

  // 都未命中，刷新
  return refreshHot100();
}

async function getTop100FromDB(): Promise<Hot100Song[]> {
  const dbSongs = await prisma.song.findMany({
    where: { playable: true, archived: false },
    orderBy: { hotScore: 'desc' },
    take: 100,
  });

  return dbSongs.map(s => ({
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
  }));
}
