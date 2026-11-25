/**
 * 协同过滤器
 * 基于用户行为相似度进行推荐
 */

import { PrismaClient } from '@prisma/client';
import type { UserProfile } from './user-profile-builder';

export interface CollaborativeFilterResult {
  songId: string;
  score: number;
  reason: string;
}

export class CollaborativeFilter {
  constructor(private prisma: PrismaClient) {}

  /**
   * 基于用户行为相似度推荐
   * 找到与当前用户相似的用户，推荐他们喜欢但当前用户未听过的歌曲
   */
  async score(
    candidates: any[],
    userId: number,
    profile: UserProfile
  ): Promise<CollaborativeFilterResult[]> {
    // 获取相似用户
    const similarUsers = await this.findSimilarUsers(userId, profile);
    if (similarUsers.length === 0) {
      return candidates.map(c => ({ songId: c.id, score: 0.3, reason: '' }));
    }

    // 获取相似用户的播放记录
    const similarUserIds = similarUsers.map(u => u.userId);
    const similarUserEvents = await this.prisma.listeningEvent.findMany({
      where: {
        userId: { in: similarUserIds },
        eventType: { in: ['play', 'complete'] },
        songId: { not: null },
      },
      select: { userId: true, songId: true, engagementScore: true },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });

    // 统计相似用户对每首歌的加权评分
    const songScores = new Map<string, { total: number; count: number }>();
    const userWeightMap = new Map(similarUsers.map(u => [u.userId, u.similarity]));

    for (const event of similarUserEvents) {
      if (!event.songId || !event.userId) continue;
      const weight = userWeightMap.get(event.userId) ?? 0;
      const engagement = (event.engagementScore as number | null) ?? 0.3;
      const score = weight * engagement;

      const existing = songScores.get(event.songId);
      if (existing) {
        existing.total += score;
        existing.count++;
      } else {
        songScores.set(event.songId, { total: score, count: 1 });
      }
    }

    // 对候选歌曲评分
    const maxScore = Math.max(...Array.from(songScores.values()).map(s => s.total), 1);
    return candidates.map(song => {
      const data = songScores.get(song.id);
      if (!data) return { songId: song.id, score: 0.2, reason: '' };

      const normalized = data.total / maxScore;
      const reason = data.count >= 3 ? '相似用户都喜欢' : data.count >= 2 ? '相似用户推荐' : '';
      return { songId: song.id, score: normalized, reason };
    });
  }

  /**
   * 找到与当前用户相似的用户
   * 基于共同播放的歌曲和相似的偏好
   */
  private async findSimilarUsers(
    userId: number,
    profile: UserProfile
  ): Promise<{ userId: number; similarity: number }[]> {
    const since = new Date(Date.now() - 30 * 86400 * 1000);

    // 获取当前用户最近播放的歌曲
    const userEvents = await this.prisma.listeningEvent.findMany({
      where: { userId, occurredAt: { gte: since } },
      select: { songId: true },
      take: 100,
    });
    const userSongIds = new Set(userEvents.map(e => e.songId).filter(Boolean) as string[]);

    if (userSongIds.size === 0) return [];

    // 找到也播放过这些歌曲的用户
    const otherEvents = await this.prisma.listeningEvent.findMany({
      where: {
        userId: { not: userId },
        songId: { in: Array.from(userSongIds) as string[] },
        occurredAt: { gte: since },
      },
      select: { userId: true, songId: true },
      take: 1000,
    });

    // 计算每个用户的相似度（Jaccard）
    const otherUserSongs = new Map<number, Set<string>>();
    for (const event of otherEvents) {
      if (!event.songId) continue;
      if (!otherUserSongs.has(event.userId as number)) {
        otherUserSongs.set(event.userId as number, new Set());
      }
      otherUserSongs.get(event.userId as number)!.add(event.songId as string);
    }

    const similarities: { userId: number; similarity: number }[] = [];
    for (const [otherUserId, otherSongs] of otherUserSongs) {
      let inter = 0;
      for (const s of otherSongs) {
        if (userSongIds.has(s)) inter++;
      }
      const union = userSongIds.size + otherSongs.size - inter;
      const jaccard = union > 0 ? inter / union : 0;
      if (jaccard > 0.05) { // 相似度阈值
        similarities.push({ userId: otherUserId, similarity: jaccard });
      }
    }

    // 返回前10个相似用户
    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
  }
}
