import prisma from '../../lib/prisma';

export class StatsController {
  async getOverview() {
    try {
      // 并行查询各项统计数据
      const [
        totalSongs,
        playableSongs,
        totalUsers,
        totalGenres,
        totalPlaylists,
        totalLanguages,
        totalScenes,
        totalMoods,
        totalDecades,
        totalTags,
        recentSongs,
        topPlatform,
      ] = await Promise.all([
        // 歌曲总数
        prisma.song.count(),

        // 可播放歌曲数
        prisma.song.count({ where: { playable: true } }),

        // 用户总数
        prisma.user.count(),

        // 流派数量
        prisma.genre.count(),

        // 播放列表数量（如果有的话，否则返回0）
        prisma.playlist.count().catch(() => 0),

        // 语言数量
        prisma.language.count(),

        // 场景数量
        prisma.scene.count(),

        // 情绪数量
        prisma.mood.count(),

        // 年代数量
        prisma.decade.count(),

        // 标签数量
        prisma.tag.count(),

        // 最近7天新增歌曲
        prisma.song.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),

        // 最热门的平台
        prisma.song.groupBy({
          by: ['platform'],
          _count: true,
          orderBy: { _count: { platform: 'desc' } },
          take: 1,
        }),
      ]);

      // 获取各平台歌曲分布
      const platformStats = await prisma.song.groupBy({
        by: ['platform'],
        _count: true,
        where: {
          platform: { not: null },
        },
      });

      // 获取数据来源分布
      const dataSourceStats = await prisma.song.groupBy({
        by: ['dataSource'],
        _count: true,
      });

      return {
        totalSongs,
        playableSongs,
        unplayableSongs: totalSongs - playableSongs,
        totalUsers,
        totalGenres,
        totalPlaylists,
        totalLanguages,
        totalScenes,
        totalMoods,
        totalDecades,
        totalTags,
        recentSongs,
        topPlatform: topPlatform[0]?.platform || '未知',
        platformDistribution: platformStats.map(p => ({
          platform: p.platform || '未知',
          count: p._count,
        })),
        dataSourceDistribution: dataSourceStats.map(d => ({
          source: d.dataSource,
          count: d._count,
        })),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[STATS-ERROR] 获取统计数据失败:', error);
      throw error;
    }
  }

  async getSongStats() {
    try {
      // 获取歌曲播放量统计
      const playStats = await prisma.song.aggregate({
        _sum: { playCount: true },
        _avg: { playCount: true, hotScore: true },
        _max: { playCount: true },
      });

      // 获取最热门的10首歌曲
      const topSongs = await prisma.song.findMany({
        select: {
          id: true,
          title: true,
          artist: true,
          playCount: true,
          hotScore: true,
        },
        orderBy: { hotScore: 'desc' },
        take: 10,
      });

      // 获取各流派歌曲数量
      const genreStats = await prisma.genre.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { songs: true } },
        },
        orderBy: { songs: { _count: 'desc' } },
        take: 10,
      });

      return {
        playStats: {
          totalPlays: playStats._sum.playCount || 0,
          averagePlays: Math.round(playStats._avg.playCount || 0),
          maxPlays: playStats._max.playCount || 0,
          averageHotScore: Number((playStats._avg.hotScore || 0).toFixed(2)),
        },
        topSongs,
        topGenres: genreStats.map(g => ({
          id: g.id,
          name: g.name,
          songCount: g._count.songs,
        })),
      };
    } catch (error) {
      console.error('[STATS-ERROR] 获取歌曲统计失败:', error);
      throw error;
    }
  }
}

export const statsController = new StatsController();
