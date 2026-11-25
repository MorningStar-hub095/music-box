import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';

export interface ArchiveOptions {
  reason?: string;
  archivedBy?: number;
  criteria?: {
    olderThanDays?: number;
    playCountLessThan?: number;
    notPlayable?: boolean;
    lowHotScore?: number;
  };
}

export interface ArchiveResult {
  archivedCount: number;
  archivedSongs: Array<{
    id: string;
    title: string;
    artist: string;
  }>;
}

/**
 * 归档单首歌曲
 */
export async function archiveSong(
  songId: string,
  reason?: string,
  archivedBy?: number
) {
  const song = await prisma.song.findUnique({ where: { id: songId } });
  
  if (!song) {
    throw new Error('歌曲不存在');
  }
  
  if (song.archived) {
    throw new Error('歌曲已经归档');
  }
  
  return prisma.song.update({
    where: { id: songId },
    data: {
      archived: true,
      archivedAt: new Date(),
      archiveReason: reason || '手动归档',
    },
  });
}

/**
 * 批量归档歌曲
 */
export async function batchArchiveSongs(
  songIds: string[],
  reason?: string
): Promise<ArchiveResult> {
  const result = await prisma.song.updateMany({
    where: { id: { in: songIds }, archived: false },
    data: {
      archived: true,
      archivedAt: new Date(),
      archiveReason: reason || '手动归档',
    },
  });

  return {
    archivedCount: result.count,
    archivedSongs: [],
  };
}

/**
 * 自动归档符合条件的歌曲
 */
export async function autoArchive(options: ArchiveOptions): Promise<ArchiveResult> {
  const { criteria, reason, archivedBy } = options;
  
  if (!criteria) {
    throw new Error('请提供归档条件');
  }
  
  const where: Prisma.SongWhereInput = {
    archived: false,
  };
  
  // 根据时间条件
  if (criteria.olderThanDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - criteria.olderThanDays);
    where.createdAt = { lt: cutoffDate };
  }
  
  // 根据播放次数条件
  if (criteria.playCountLessThan !== undefined) {
    where.playCount = { lt: criteria.playCountLessThan };
  }
  
  // 根据可播放状态
  if (criteria.notPlayable) {
    where.playable = false;
  }
  
  // 根据热度分数
  if (criteria.lowHotScore !== undefined) {
    where.hotScore = { lt: criteria.lowHotScore };
  }
  
  const songsToArchive = await prisma.song.findMany({
    where,
    select: { id: true, title: true, artist: true },
  });
  
  if (songsToArchive.length === 0) {
    return { archivedCount: 0, archivedSongs: [] };
  }
  
  // 批量更新
  await prisma.song.updateMany({
    where: { id: { in: songsToArchive.map(s => s.id) } },
    data: {
      archived: true,
      archivedAt: new Date(),
      archiveReason: reason || '自动归档',
    },
  });
  
  return {
    archivedCount: songsToArchive.length,
    archivedSongs: songsToArchive.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
    })),
  };
}

/**
 * 恢复已归档的歌曲
 */
export async function restoreSong(songId: string) {
  const song = await prisma.song.findUnique({ where: { id: songId } });
  
  if (!song) {
    throw new Error('歌曲不存在');
  }
  
  if (!song.archived) {
    throw new Error('歌曲未归档');
  }
  
  return prisma.song.update({
    where: { id: songId },
    data: {
      archived: false,
      archivedAt: null,
      archiveReason: null,
    },
  });
}

/**
 * 获取归档歌曲列表
 */
export async function getArchivedSongs(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  reason?: string;
}) {
  const { page = 1, pageSize = 20, keyword, reason } = params;
  
  const where: Prisma.SongWhereInput = {
    archived: true,
  };
  
  if (keyword) {
    where.OR = [
      { title: { contains: keyword } },
      { artist: { contains: keyword } },
    ];
  }
  
  if (reason) {
    where.archiveReason = { contains: reason };
  }
  
  const [total, songs] = await Promise.all([
    prisma.song.count({ where }),
    prisma.song.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { archivedAt: 'desc' },
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        playCount: true,
        hotScore: true,
        archivedAt: true,
        archiveReason: true,
        createdAt: true,
      },
    }),
  ]);
  
  return {
    total,
    page,
    pageSize,
    songs,
  };
}

/**
 * 获取归档统计信息
 */
export async function getArchiveStats() {
  const [totalArchived, byReason, recentArchived] = await Promise.all([
    prisma.song.count({ where: { archived: true } }),
    prisma.song.groupBy({
      by: ['archiveReason'],
      where: { archived: true },
      _count: true,
    }),
    prisma.song.count({
      where: {
        archived: true,
        archivedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);
  
  return {
    totalArchived,
    byReason: byReason.map(r => ({
      reason: r.archiveReason || '未指定',
      count: r._count,
    })),
    recentArchived,
  };
}
