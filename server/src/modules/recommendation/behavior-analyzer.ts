/**
 * 行为序列分析器
 * 分析用户的听歌行为模式，为推荐提供上下文
 */

import { PrismaClient } from '@prisma/client';

export interface BehaviorInsight {
  /** 最近播放趋势 */
  recentTrend: 'exploring' | 'repeating' | 'balanced';
  /** 当前时段偏好 */
  currentHourPreference: { genreIds: number[]; moodIds: number[] } | null;
  /** 连续播放模式 */
  continuousPlayStreak: number;
  /** 最近跳过的歌曲特征 */
  skippedFeatures: { genreIds: number[]; moodIds: number[] };
  /** 活跃度评分（0-1） */
  activityScore: number;
}

export class BehaviorAnalyzer {
  constructor(private prisma: PrismaClient) {}

  async analyze(userId: number): Promise<BehaviorInsight> {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [recentEvents, weekEvents] = await Promise.all([
      this.prisma.listeningEvent.findMany({
        where: { userId, occurredAt: { gte: since24h } },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
      this.prisma.listeningEvent.findMany({
        where: { userId, occurredAt: { gte: since7d } },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      }),
    ]);

    // 获取最近播放歌曲的风格和情绪信息
    const recentSongIds = [...new Set(recentEvents.map(e => e.songId).filter(Boolean))] as string[];
    const songsWithFeatures = recentSongIds.length > 0
      ? await this.prisma.song.findMany({
          where: { id: { in: recentSongIds } },
          include: {
            genres: { select: { genreId: true } },
            moods: { select: { moodId: true } },
          },
        })
      : [];
    const songMap = new Map(songsWithFeatures.map(s => [s.id, s]));

    // 将歌曲信息附加到事件中
    const enrichedEvents = recentEvents.map(e => ({
      ...e,
      song: e.songId ? songMap.get(e.songId) : null,
    }));

    const recentTrend = this.analyzeTrend(recentEvents);
    const currentHourPreference = this.analyzeCurrentHourPreference(enrichedEvents);
    const continuousPlayStreak = this.analyzeContinuousPlay(recentEvents);
    const skippedFeatures = this.analyzeSkippedFeatures(enrichedEvents);
    const activityScore = this.computeActivityScore(weekEvents);

    return {
      recentTrend,
      currentHourPreference,
      continuousPlayStreak,
      skippedFeatures,
      activityScore,
    };
  }

  private analyzeTrend(events: any[]): 'exploring' | 'repeating' | 'balanced' {
    if (events.length < 5) return 'balanced';

    const songIds = events.map(e => e.songId).filter(Boolean);
    const uniqueSongs = new Set(songIds).size;
    const repeatRate = 1 - uniqueSongs / songIds.length;

    if (repeatRate > 0.6) return 'repeating';
    if (repeatRate < 0.2) return 'exploring';
    return 'balanced';
  }

  private analyzeCurrentHourPreference(events: any[]) {
    const currentHour = new Date().getHours();
    const hourEvents = events.filter(e => {
      if (!e.occurredAt) return false;
      return new Date(e.occurredAt).getHours() === currentHour;
    });

    if (hourEvents.length === 0) return null;

    // 从播放事件中提取歌曲的风格和情绪偏好
    const genreIds: number[] = [];
    const moodIds: number[] = [];

    for (const event of hourEvents) {
      if (event.song?.genres) {
        genreIds.push(...event.song.genres.map((g: any) => g.genreId));
      }
      if (event.song?.moods) {
        moodIds.push(...event.song.moods.map((m: any) => m.moodId));
      }
    }

    // 去重并返回
    return {
      genreIds: [...new Set(genreIds)].slice(0, 5),
      moodIds: [...new Set(moodIds)].slice(0, 3),
    };
  }

  private analyzeContinuousPlay(events: any[]): number {
    if (events.length === 0) return 0;

    let streak = 0;
    for (const event of events) {
      if (event.eventType === 'play' || event.eventType === 'complete') {
        streak++;
      } else if (event.eventType === 'skip') {
        break;
      }
    }
    return streak;
  }

  private analyzeSkippedFeatures(events: any[]) {
    const skipped = events.filter(e => e.eventType === 'skip');

    if (skipped.length === 0) {
      return { genreIds: [] as number[], moodIds: [] as number[] };
    }

    // 从跳过的歌曲中提取风格和情绪，用于后续推荐时降权
    const genreIds: number[] = [];
    const moodIds: number[] = [];

    for (const event of skipped) {
      if (event.song?.genres) {
        genreIds.push(...event.song.genres.map((g: any) => g.genreId));
      }
      if (event.song?.moods) {
        moodIds.push(...event.song.moods.map((m: any) => m.moodId));
      }
    }

    // 统计出现频率最高的风格和情绪
    const genreFreq = new Map<number, number>();
    const moodFreq = new Map<number, number>();

    for (const id of genreIds) {
      genreFreq.set(id, (genreFreq.get(id) || 0) + 1);
    }
    for (const id of moodIds) {
      moodFreq.set(id, (moodFreq.get(id) || 0) + 1);
    }

    // 返回出现2次以上的风格和情绪
    const frequentGenres = Array.from(genreFreq.entries())
      .filter(([_, count]) => count >= 2)
      .map(([id]) => id);
    const frequentMoods = Array.from(moodFreq.entries())
      .filter(([_, count]) => count >= 2)
      .map(([id]) => id);

    return {
      genreIds: frequentGenres.slice(0, 5),
      moodIds: frequentMoods.slice(0, 3),
    };
  }

  private computeActivityScore(events: any[]): number {
    if (events.length === 0) return 0;
    // 基于7天内的事件数量计算活跃度
    const maxDailyEvents = 50;
    const dailyAvg = events.length / 7;
    return Math.min(dailyAvg / maxDailyEvents, 1);
  }
}
