/**
 * LangChain Agent Tools - 用户DNA查询
 */

// @ts-ignore - langchain types resolved at runtime
import { DynamicStructuredTool } from '@langchain/core/tools';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

export function createQueryUserDNATool(prisma: PrismaClient, userId: number) {
  return new DynamicStructuredTool({
    name: 'queryUserDNA',
    description: '查询用户的个性化DNA数据，包括情绪DNA（音乐情绪偏好）、社交DNA（社交特征）、每日推荐。用于理解用户的音乐品味和当前状态。',
    schema: z.object({
      type: z.enum(['emotion', 'social', 'daily']).describe('查询类型：emotion=情绪DNA，social=社交DNA，daily=每日推荐'),
    }),
    func: async ({ type }) => {
      try {
        if (type === 'emotion') {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { emotionDna: true },
          });
          return JSON.stringify(user?.emotionDna || { message: '暂无情绪DNA数据' });
        }

        if (type === 'social') {
          const dna = await prisma.socialDna.findFirst({
            where: { userId },
          });
          if (!dna) return JSON.stringify({ message: '暂无社交DNA数据' });
          return JSON.stringify({
            vectorData: dna.vectorJson,
            updatedAt: dna.updatedAt,
          });
        }

        if (type === 'daily') {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const recs = await prisma.dailyRecommendation.findMany({
            where: { userId, generatedAt: { gte: today } },
            orderBy: { rank: 'asc' },
            take: 10,
            include: { song: { select: { title: true, artist: true } } },
          });
          return JSON.stringify(recs.map(r => ({
            rank: r.rank,
            title: r.song.title,
            artist: r.song.artist,
            reason: r.reason,
          })));
        }

        return '{}';
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  });
}
