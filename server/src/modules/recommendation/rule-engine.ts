/**
 * 规则引擎
 * 基于规则的推荐评分，包含权重动态调整和过滤规则
 */

import type { UserProfile } from './user-profile-builder';
import type { BehaviorInsight } from './behavior-analyzer';

export interface RuleScoreResult {
  songId: string;
  score: number;
  reason: string;
}

export class RuleEngine {
  /**
   * 对候选歌曲进行规则评分
   */
  score(
    candidates: any[],
    profile: UserProfile,
    behavior: BehaviorInsight
  ): RuleScoreResult[] {
    return candidates.map(song => {
      let score = 0;
      const reasons: string[] = [];

      // 1. 风格匹配（0-0.3）
      const genreScore = this.scoreGenreMatch(song, profile);
      score += genreScore * 0.3;
      if (genreScore > 0.5) reasons.push(`风格匹配${Math.round(genreScore * 100)}%`);

      // 2. 情绪匹配（0-0.25）
      const moodScore = this.scoreMoodMatch(song, profile);
      score += moodScore * 0.25;
      if (moodScore > 0.5) reasons.push(`情绪匹配${Math.round(moodScore * 100)}%`);

      // 3. 热度分数（0-0.15）
      const hotScore = Math.min((song.hotScore || 0) / 100, 1);
      score += hotScore * 0.15;

      // 4. 时段适配（0-0.15）
      const timeScore = this.scoreTimeFit(song, profile);
      score += timeScore * 0.15;
      if (timeScore > 0.5) reasons.push('适合当前时段');

      // 5. 新鲜度（0-0.1）
      const freshScore = this.scoreFreshness(song, profile);
      score += freshScore * 0.1;
      if (freshScore > 0.7) reasons.push('发现新歌');

      // 6. 行为趋势适配（0-0.1）
      const trendScore = this.scoreTrendFit(song, behavior);
      score += trendScore * 0.1;
      if (trendScore > 0.6) reasons.push('契合当前听歌趋势');

      // 7. 跳过惩罚（-0.15 ~ 0）：与用户跳过的歌曲风格相似则降权
      const skipPenalty = this.scoreSkipPenalty(song, behavior);
      score += skipPenalty;

      return {
        songId: song.id,
        score: Math.max(0, Math.min(score, 1)),
        reason: reasons.length > 0 ? reasons.join('，') : '综合推荐',
      };
    });
  }

  private scoreGenreMatch(song: any, profile: UserProfile): number {
    if (!song.genres || profile.favoriteGenres.length === 0) return 0.3;

    const songGenreIds = new Set(song.genres.map((g: any) => g.genreId));
    const totalWeight = profile.favoriteGenres.reduce((s, g) => s + g.weight, 0);
    let matchWeight = 0;

    for (const fav of profile.favoriteGenres) {
      if (songGenreIds.has(fav.id)) {
        matchWeight += fav.weight;
      }
    }

    return totalWeight > 0 ? matchWeight / totalWeight : 0.3;
  }

  private scoreMoodMatch(song: any, profile: UserProfile): number {
    if (!song.moods || profile.favoriteMoods.length === 0) return 0.3;

    const songMoodIds = new Set(song.moods.map((m: any) => m.moodId));
    const totalWeight = profile.favoriteMoods.reduce((s, m) => s + m.weight, 0);
    let matchWeight = 0;

    for (const fav of profile.favoriteMoods) {
      if (songMoodIds.has(fav.id)) {
        matchWeight += fav.weight;
      }
    }

    return totalWeight > 0 ? matchWeight / totalWeight : 0.3;
  }

  private scoreTimeFit(song: any, profile: UserProfile): number {
    // C3（v1.4.7 注释声明）：此处使用服务器本地时区。桌面单用户部署下
    // 服务器与用户通常同机同时区，假设成立；若未来改为多用户/云端部署，
    // 需改为按用户时区取小时（behavior-analyzer / ai-enhancer / user-profile-builder 同此假设）
    const currentHour = new Date().getHours();
    const hourPref = profile.timePreferences.find(t => t.hour === currentHour);
    if (!hourPref) return 0.5;

    const songGenreIds = new Set((song.genres || []).map((g: any) => g.genreId));
    const songMoodIds = new Set((song.moods || []).map((m: any) => m.moodId));

    let match = 0;
    let total = 0;

    for (const gid of hourPref.genreIds) {
      total++;
      if (songGenreIds.has(gid)) match++;
    }
    for (const mid of hourPref.moodIds) {
      total++;
      if (songMoodIds.has(mid)) match++;
    }

    return total > 0 ? match / total : 0.5;
  }

  private scoreFreshness(song: any, profile: UserProfile): number {
    // 新歌（30天内发布）获得加分
    if (!song.releaseDate) return 0.3;
    const daysSinceRelease = (Date.now() - new Date(song.releaseDate).getTime()) / 86400000;
    if (daysSinceRelease < 30) return 1;
    if (daysSinceRelease < 90) return 0.7;
    if (daysSinceRelease < 365) return 0.4;
    return 0.2;
  }

  private scoreTrendFit(song: any, behavior: BehaviorInsight): number {
    // 根据用户当前行为趋势调整
    if (behavior.recentTrend === 'exploring') {
      // 探索模式下，新歌加分
      return 0.7;
    } else if (behavior.recentTrend === 'repeating') {
      // 重复模式下，熟悉的歌加分
      return 0.3;
    }
    return 0.5;
  }

  /**
   * 跳过惩罚：与用户跳过的歌曲风格/情绪相似则降权
   * 返回 -0.15 ~ 0 的惩罚分数
   */
  private scoreSkipPenalty(song: any, behavior: BehaviorInsight): number {
    const { skippedFeatures } = behavior;
    if (skippedFeatures.genreIds.length === 0 && skippedFeatures.moodIds.length === 0) {
      return 0;
    }

    const songGenreIds = new Set((song.genres || []).map((g: any) => g.genreId));
    const songMoodIds = new Set((song.moods || []).map((m: any) => m.moodId));

    let penalty = 0;

    // 检查风格匹配
    for (const gid of skippedFeatures.genreIds) {
      if (songGenreIds.has(gid)) {
        penalty -= 0.05;
      }
    }

    // 检查情绪匹配
    for (const mid of skippedFeatures.moodIds) {
      if (songMoodIds.has(mid)) {
        penalty -= 0.03;
      }
    }

    return Math.max(penalty, -0.15);
  }
}
