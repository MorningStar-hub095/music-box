import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';

export interface Suggestion {
  type: 'warning' | 'info' | 'success';
  message: string;
  action: string;
}

export interface ContentStats {
  totalSongs: number;
  activeSongs: number;
  archivedSongs: number;
  playableSongs: number;
  recentSongs: number;
  songsByPlatform: Array<{
    platform: string;
    count: number;
  }>;
  songsByDataSource: Array<{
    dataSource: string;
    count: number;
  }>;
  topPlayedSongs: Array<{
    id: string;
    title: string;
    artist: string;
    playCount: number;
  }>;
  recentlyAdded: Array<{
    id: string;
    title: string;
    artist: string;
    createdAt: Date;
  }>;
}

export interface DynamicPlaylistConfig {
  type: 'hot' | 'new' | 'random' | 'similar';
  limit: number;
  excludeArchived?: boolean;
  platform?: string;
  genre?: string;
}

/**
 * 获取内容统计信息
 */
export async function getContentStats(): Promise<ContentStats> {
  const [
    totalSongs,
    activeSongs,
    archivedSongs,
    playableSongs,
    recentSongs,
    songsByPlatform,
    songsByDataSource,
    topPlayedSongs,
    recentlyAdded,
  ] = await Promise.all([
    prisma.song.count(),
    prisma.song.count({ where: { archived: false } }),
    prisma.song.count({ where: { archived: true } }),
    prisma.song.count({ where: { archived: false, playable: true } }),
    prisma.song.count({
      where: {
        archived: false,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.song.groupBy({
      by: ['platform'],
      where: { archived: false },
      _count: true,
    }),
    prisma.song.groupBy({
      by: ['dataSource'],
      where: { archived: false },
      _count: true,
    }),
    prisma.song.findMany({
      where: { archived: false, playable: true },
      orderBy: { playCount: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        artist: true,
        playCount: true,
      },
    }),
    prisma.song.findMany({
      where: { archived: false },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        artist: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    totalSongs,
    activeSongs,
    archivedSongs,
    playableSongs,
    recentSongs,
    songsByPlatform: songsByPlatform.map(p => ({
      platform: p.platform || 'unknown',
      count: p._count,
    })),
    songsByDataSource: songsByDataSource.map(d => ({
      dataSource: d.dataSource,
      count: d._count,
    })),
    topPlayedSongs,
    recentlyAdded,
  };
}

/**
 * 获取动态播放列表
 */
export async function getDynamicPlaylist(config: DynamicPlaylistConfig) {
  const { type, limit, excludeArchived = true, platform, genre } = config;

  const where: Prisma.SongWhereInput = {
    playable: true,
  };

  if (excludeArchived) {
    where.archived = false;
  }

  if (platform) {
    where.platform = platform;
  }

  if (genre) {
    where.genres = {
      some: {
        genre: { name: genre },
      },
    };
  }

  // 各分支 select 的字段集不同，这里用显式 any[] 聚合（noImplicitAny 允许显式注解）
  let songs: any[];

  switch (type) {
    case 'hot':
      songs = await prisma.song.findMany({
        where,
        orderBy: { hotScore: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          albumCover: true,
          audioUrl: true,
          playCount: true,
          hotScore: true,
        },
      });
      break;

    case 'new':
      songs = await prisma.song.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          albumCover: true,
          audioUrl: true,
          createdAt: true,
        },
      });
      break;

    case 'random':
      // 随机获取歌曲
      const total = await prisma.song.count({ where });
      const skip = Math.max(0, Math.floor(Math.random() * Math.max(0, total - limit)));
      songs = await prisma.song.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          albumCover: true,
          audioUrl: true,
        },
      });
      break;

    case 'similar':
      // 获取热门歌曲作为种子，然后找相似的
      const seedSongs = await prisma.song.findMany({
        where: { ...where, hotScore: { gt: 0 } },
        orderBy: { hotScore: 'desc' },
        take: 3,
        select: { id: true, artist: true },
      });

      if (seedSongs.length > 0) {
        const seedArtists = seedSongs.map(s => s.artist);
        songs = await prisma.song.findMany({
          where: {
            ...where,
            artist: { in: seedArtists },
            id: { notIn: seedSongs.map(s => s.id) },
          },
          orderBy: { hotScore: 'desc' },
          take: limit,
          select: {
            id: true,
            title: true,
            artist: true,
            album: true,
            albumCover: true,
            audioUrl: true,
            hotScore: true,
          },
        });
      } else {
        songs = [];
      }
      break;

    default:
      songs = [];
  }

  return {
    type,
    count: songs.length,
    songs,
  };
}

/**
 * 更新歌曲热度分数
 */
export async function updateHotScores() {
  // 获取所有活跃歌曲
  const songs = await prisma.song.findMany({
    where: { archived: false, playable: true },
    select: {
      id: true,
      playCount: true,
      likeCount: true,
      favoriteCount: true,
      commentCount: true,
      createdAt: true,
    },
  });

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // 计算热度分数
  await Promise.all(songs.map(song => {
    const daysSinceCreation = Math.max(1, (now - song.createdAt.getTime()) / DAY);

    // 热度公式：播放权重40% + 点赞权重20% + 收藏权重20% + 评论权重10% + 时间衰减10%
    const playScore = song.playCount * 0.4;
    const likeScore = song.likeCount * 0.2;
    const favoriteScore = song.favoriteCount * 0.2;
    const commentScore = song.commentCount * 0.1;
    const timeDecay = Math.max(0, 1 - daysSinceCreation / 365) * 0.1;

    const hotScore = playScore + likeScore + favoriteScore + commentScore + timeDecay;

    return prisma.song.update({
      where: { id: song.id },
      data: { hotScore },
    });
  }));

  return {
    updatedCount: songs.length,
    message: '热度分数已更新',
  };
}

/**
 * 获取内容更新建议
 */
export async function getContentSuggestions() {
  const stats = await getContentStats();
  
  const suggestions: Suggestion[] = [];

  // 检查歌曲数量
  if (stats.activeSongs < 50) {
    suggestions.push({
      type: 'warning',
      message: '活跃歌曲数量较少，建议执行爬取任务补充内容',
      action: 'crawl',
    });
  }

  // 检查新内容
  if (stats.recentSongs < 5) {
    suggestions.push({
      type: 'info',
      message: '最近7天新增歌曲较少，建议更新爬取策略',
      action: 'update_strategy',
    });
  }

  // 检查可播放率
  const playableRate = stats.activeSongs > 0 
    ? (stats.playableSongs / stats.activeSongs) * 100 
    : 0;
  
  if (playableRate < 80) {
    suggestions.push({
      type: 'warning',
      message: `可播放率(${playableRate.toFixed(1)}%)较低，建议检查并修复不可播放的歌曲`,
      action: 'fix_playable',
    });
  }

  // 检查归档数量
  if (stats.archivedSongs > stats.activeSongs * 0.5) {
    suggestions.push({
      type: 'info',
      message: '归档歌曲数量较多，可以考虑清理或恢复部分归档内容',
      action: 'review_archive',
    });
  }

  return {
    stats,
    suggestions,
  };
}
