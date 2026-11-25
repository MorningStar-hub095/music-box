/**
 * LangChain Agent Tools - 用户历史查询
 */

// @ts-ignore - langchain types resolved at runtime
import { DynamicStructuredTool } from '@langchain/core/tools';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

export function createQueryUserHistoryTool(prisma: PrismaClient, userId: number) {
  return new DynamicStructuredTool({
    name: 'queryUserHistory',
    description: '查询用户的听歌历史，包括最近播放、播放次数最多的歌曲。返回用户的音乐偏好数据。',
    schema: z.object({
      type: z.enum(['recent', 'top']).describe('查询类型：recent=最近播放，top=播放最多'),
      limit: z.number().optional().default(10).describe('返回数量，默认10'),
    }),
    func: async ({ type, limit }) => {
      try {
        if (type === 'recent') {
          const events = await prisma.listeningEvent.findMany({
            where: { userId, eventType: 'play' },
            orderBy: { occurredAt: 'desc' },
            take: limit,
            select: { trackTitle: true, trackArtist: true, songId: true, occurredAt: true },
          });
          return JSON.stringify(events.map(e => ({
            title: e.trackTitle,
            artist: e.trackArtist,
            songId: e.songId,
            playedAt: e.occurredAt,
          })));
        }

        if (type === 'top') {
          const events = await prisma.listeningEvent.groupBy({
            by: ['songId'],
            where: { userId, eventType: 'play', songId: { not: null } },
            _count: { songId: true },
            orderBy: { _count: { songId: 'desc' } },
            take: limit,
          });
          const songIds = events.map(e => e.songId).filter((id): id is string => id !== null);
          const songs = await prisma.song.findMany({
            where: { id: { in: songIds } },
            select: { id: true, title: true, artist: true },
          });
          return JSON.stringify(events.map(e => {
            const song = songs.find(s => s.id === e.songId);
            return { ...song, playCount: e._count.songId };
          }));
        }

        return '[]';
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  });
}
