/**
 * 用户画像构建器
 * 从用户行为数据中提取偏好特征，构建用户画像
 */

import { PrismaClient } from '@prisma/client';
import { cache } from '../../lib/redis';
import { getConfig } from './config';

export interface UserProfile {
  userId: number;
  /** 音乐偏好 */
  favoriteGenres: { id: number; name: string; weight: number }[];
  favoriteArtists: { name: string; weight: number }[];
  favoriteMoods: { id: number; name: string; weight: number }[];
  /** 行为特征 */
  avgListenDuration: number;  // 平均听歌时长（秒）
  skipRate: number;           // 跳过率（0-1）
  repeatRate: number;         // 重复播放率（0-1）
  /** 时段偏好 */
  timePreferences: { hour: number; genreIds: number[]; moodIds: number[] }[];
  /** 情绪状态 */
  currentMood: string | null;
  /** 统计信息 */
  totalPlays: number;
  uniqueSongs: number;
  updatedAt: Date;
}

const CACHE_KEY_PREFIX = 'user:profile:';

export class UserProfileBuilder {
  constructor(private prisma: PrismaClient) {}

  async build(userId: number): Promise<UserProfile> {
    const config = getConfig();
    const cacheKey = `${CACHE_KEY_PREFIX}${userId}`;

    // 尝试从缓存获取
    const cached = await cache.get<UserProfile>(cacheKey);
    if (cached) return cached;

    const since = new Date(Date.now() - config.windows.behaviorAnalysis * 86400 * 1000);

    // 并行获取数据
    const [events, feedbacks, user] = await Promise.all([
      this.prisma.listeningEvent.findMany({
        where: { userId, occurredAt: { gte: since } },
        orderBy: { occurredAt: 'desc' },
        take: 500,
      }),
      this.prisma.recommendationFeedback.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { songId: true, feedback: true, weight: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { emotionDna: true },
      }),
    ]);

    // 获取相关歌曲的分类信息
    // P2-2（v1.4.7）：把反馈歌曲也纳入 songMap，使 favorite/like/dislike 信号可叠加到风格/情绪权重
    // （旧实现：feedbacks 查出 weight 字段但从未使用，favorite 3 / like 1 / dislike 2 的强度信息被浪费）
    const feedbackSongIds = feedbacks.map(f => f.songId).filter(Boolean) as string[];
    const songIds = [
      ...new Set([
        ...events.map(e => e.songId).filter(Boolean),
        ...feedbackSongIds,
      ]),
    ] as string[];
    const songs = songIds.length > 0
      ? await this.prisma.song.findMany({
          where: { id: { in: songIds } },
          include: { genres: { include: { genre: true } }, moods: { include: { mood: true } } },
        })
      : [];
    const songMap = new Map(songs.map(s => [s.id, s]));

    // P2-2：构建带符号的反馈权重表（songId → 有符号贡献）
    // feedback.weight 存储的是正强度（favorite=3 / like=1 / dislike=2，见 recommendation.controller.ts），
    // 此处 favorite/like 取正向贡献、dislike 取负向贡献（抑制）
    const feedbackWeights = new Map<string, number>();
    for (const f of feedbacks) {
      if (!f.songId) continue;
      const magnitude = Math.abs(f.weight || 1);
      let signed = 0;
      if (f.feedback === 'favorite' || f.feedback === 'like') signed = magnitude;
      else if (f.feedback === 'dislike') signed = -magnitude;
      if (signed !== 0) {
        feedbackWeights.set(f.songId, (feedbackWeights.get(f.songId) || 0) + signed);
      }
    }

    // 计算偏好
    const favoriteGenres = this.computeFavoriteGenres(events, songMap, feedbackWeights);
    const favoriteArtists = this.computeFavoriteArtists(events);
    const favoriteMoods = this.computeFavoriteMoods(events, songMap, feedbackWeights);

    // 计算行为特征
    const { avgListenDuration, skipRate, repeatRate } = this.computeBehaviorFeatures(events);

    // 计算时段偏好
    const timePreferences = this.computeTimePreferences(events, songMap);

    // 获取当前情绪
    const currentMood = this.extractCurrentMood(user?.emotionDna);

    const profile: UserProfile = {
      userId,
      favoriteGenres,
      favoriteArtists,
      favoriteMoods,
      avgListenDuration,
      skipRate,
      repeatRate,
      timePreferences,
      currentMood,
      totalPlays: events.length,
      uniqueSongs: songIds.length,
      updatedAt: new Date(),
    };

    // 缓存
    await cache.set(cacheKey, profile, config.cache.userProfileTTL);
    return profile;
  }

  private computeFavoriteGenres(
    events: any[],
    songMap: Map<string, any>,
    feedbackWeights?: Map<string, number>
  ) {
    const genreWeight = new Map<number, { name: string; weight: number }>();

    for (const event of events) {
      if (!event.songId) continue;
      const song = songMap.get(event.songId);
      if (!song) continue;

      const weight = event.engagementScore || 0.3;
      for (const g of song.genres) {
        const existing = genreWeight.get(g.genreId);
        if (existing) {
          existing.weight += weight;
        } else {
          genreWeight.set(g.genreId, { name: g.genre.name, weight });
        }
      }
    }

    // P2-2：反馈信号叠加——favorite/like 强化其歌曲的风格权重，dislike 抑制（不低于 0）；
    // 负反馈只调整已有条目，不因 dislike 凭空新建风格偏好
    if (feedbackWeights && feedbackWeights.size > 0) {
      for (const [songId, fw] of feedbackWeights) {
        const song = songMap.get(songId);
        if (!song) continue;
        for (const g of song.genres) {
          const existing = genreWeight.get(g.genreId);
          if (existing) {
            existing.weight = Math.max(0, existing.weight + fw);
          } else if (fw > 0) {
            genreWeight.set(g.genreId, { name: g.genre.name, weight: fw });
          }
        }
      }
    }

    return Array.from(genreWeight.entries())
      .map(([id, { name, weight }]) => ({ id, name, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
  }

  private computeFavoriteArtists(events: any[]) {
    const artistWeight = new Map<string, number>();

    for (const event of events) {
      if (!event.trackArtist) continue;
      const weight = event.engagementScore || 0.3;
      artistWeight.set(event.trackArtist, (artistWeight.get(event.trackArtist) || 0) + weight);
    }

    return Array.from(artistWeight.entries())
      .map(([name, weight]) => ({ name, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15);
  }

  private computeFavoriteMoods(
    events: any[],
    songMap: Map<string, any>,
    feedbackWeights?: Map<string, number>
  ) {
    const moodWeight = new Map<number, { name: string; weight: number }>();

    for (const event of events) {
      if (!event.songId) continue;
      const song = songMap.get(event.songId);
      if (!song) continue;

      const weight = event.engagementScore || 0.3;
      for (const m of song.moods) {
        const existing = moodWeight.get(m.moodId);
        if (existing) {
          existing.weight += weight;
        } else {
          moodWeight.set(m.moodId, { name: m.mood.name, weight });
        }
      }
    }

    // P2-2：反馈信号叠加（逻辑与 computeFavoriteGenres 相同）
    if (feedbackWeights && feedbackWeights.size > 0) {
      for (const [songId, fw] of feedbackWeights) {
        const song = songMap.get(songId);
        if (!song) continue;
        for (const m of song.moods) {
          const existing = moodWeight.get(m.moodId);
          if (existing) {
            existing.weight = Math.max(0, existing.weight + fw);
          } else if (fw > 0) {
            moodWeight.set(m.moodId, { name: m.mood.name, weight: fw });
          }
        }
      }
    }

    return Array.from(moodWeight.entries())
      .map(([id, { name, weight }]) => ({ id, name, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }

  private computeBehaviorFeatures(events: any[]) {
    if (events.length === 0) {
      return { avgListenDuration: 0, skipRate: 0, repeatRate: 0 };
    }

    const plays = events.filter(e => e.eventType === 'play' || e.eventType === 'complete');
    const skips = events.filter(e => e.eventType === 'skip');

    const totalDuration = plays.reduce((sum, e) => sum + (e.durationMs || 0), 0);
    const avgListenDuration = plays.length > 0 ? totalDuration / plays.length / 1000 : 0;
    const skipRate = events.length > 0 ? skips.length / events.length : 0;

    // 计算重复播放率
    const songCounts = new Map<string, number>();
    for (const e of events) {
      if (e.songId) {
        songCounts.set(e.songId, (songCounts.get(e.songId) || 0) + 1);
      }
    }
    const repeatSongs = Array.from(songCounts.values()).filter(c => c > 1).length;
    const repeatRate = songCounts.size > 0 ? repeatSongs / songCounts.size : 0;

    return { avgListenDuration, skipRate, repeatRate };
  }

  private computeTimePreferences(events: any[], songMap: Map<string, any>) {
    const hourData = new Map<number, { genreIds: number[]; moodIds: number[] }>();

    for (const event of events) {
      if (!event.songId || !event.occurredAt) continue;
      const hour = new Date(event.occurredAt).getHours();

      if (!hourData.has(hour)) {
        hourData.set(hour, { genreIds: [], moodIds: [] });
      }
      const data = hourData.get(hour)!;

      const song = songMap.get(event.songId);
      if (song) {
        song.genres.forEach((g: any) => data.genreIds.push(g.genreId));
        song.moods.forEach((m: any) => data.moodIds.push(m.moodId));
      }
    }

    return Array.from(hourData.entries())
      .map(([hour, data]) => ({ hour, ...data }))
      .sort((a, b) => a.hour - b.hour);
  }

  private extractCurrentMood(emotionDna: any): string | null {
    if (!emotionDna || typeof emotionDna !== 'object') return null;
    // emotionDna 格式：{ "欢快": 0.8, "悲伤": 0.2, ... }
    const entries = Object.entries(emotionDna as Record<string, number>);
    if (entries.length === 0) return null;
    entries.sort((a, b) => (b[1] as number) - (a[1] as number));
    return entries[0][0];
  }

  async invalidateCache(userId: number): Promise<void> {
    await cache.del(`${CACHE_KEY_PREFIX}${userId}`);
  }
}
