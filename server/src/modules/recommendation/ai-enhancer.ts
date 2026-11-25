/**
 * AI 增强推荐器
 * 确定性启发式增强信号（新颖度/探索度评分 + 推荐理由生成）。
 * 注：本模块不调用 LLM（无 LangChain 实际调用），类名沿用历史命名（C5 更名待定）。
 */

import type { UserProfile } from './user-profile-builder';
import type { BehaviorInsight } from './behavior-analyzer';

export interface AIEnhancedResult {
  songId: string;
  score: number;
  reason: string;
}

export class AIEnhancer {
  /**
   * 生成 AI 推荐理由
   * 基于用户画像和歌曲特征，生成个性化的推荐理由
   */
  generateReason(
    song: any,
    profile: UserProfile,
    behavior: BehaviorInsight
  ): string {
    const reasons: string[] = [];

    // 风格匹配理由
    const songGenres = (song.genres || []).map((g: any) => g.genre?.name).filter(Boolean);
    if (songGenres.length > 0 && profile.favoriteGenres.length > 0) {
      const matchGenres = profile.favoriteGenres
        .filter(fg => songGenres.includes(fg.name))
        .slice(0, 2);
      if (matchGenres.length > 0) {
        reasons.push(`你喜欢${matchGenres.map(g => g.name).join('和')}风格`);
      }
    }

    // 情绪匹配理由
    const songMoods = (song.moods || []).map((m: any) => m.mood?.name).filter(Boolean);
    if (songMoods.length > 0 && profile.favoriteMoods.length > 0) {
      const matchMoods = profile.favoriteMoods
        .filter(fm => songMoods.includes(fm.name))
        .slice(0, 1);
      if (matchMoods.length > 0) {
        reasons.push(`适合${matchMoods[0].name}的心情`);
      }
    }

    // 时段理由
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) {
      reasons.push('适合早晨聆听');
    } else if (hour >= 12 && hour < 18) {
      reasons.push('适合午后放松');
    } else if (hour >= 18 && hour < 22) {
      reasons.push('适合傍晚享受');
    } else {
      reasons.push('适合深夜独处');
    }

    // 行为趋势理由
    if (behavior.recentTrend === 'exploring') {
      reasons.push('为你发现新歌');
    } else if (behavior.recentTrend === 'repeating') {
      reasons.push('延续你的听歌风格');
    }

    return reasons.length > 0 ? reasons[0] : '为你推荐';
  }

  /**
   * 批量生成推荐理由
   */
  generateReasons(
    songs: any[],
    profile: UserProfile,
    behavior: BehaviorInsight
  ): Map<string, string> {
    const reasons = new Map<string, string>();
    for (const song of songs) {
      reasons.set(song.id, this.generateReason(song, profile, behavior));
    }
    return reasons;
  }

  /**
   * 计算 AI 增强分数（0-1）
   *
   * P1-2 重构（v1.4.7）：改为「新颖度/探索度」独立信号，消除与规则引擎的双重计算。
   * 旧实现（0.5×风格匹配率 + 0.3×情绪匹配率 + 趋势 0.05/0.1）与 rule-engine 的
   * 风格 0.3 + 情绪 0.25 信号源完全相同（同一份 favoriteGenres/favoriteMoods），
   * 导致风格/情绪有效权重膨胀至约 0.375，挤占协同/热度多样性。
   *
   * 新信号构成（确定性启发式，无 LLM 调用）：
   * ① 风格新颖度 = 1 − 候选风格命中 favoriteGenres 的占比（与 rule 引擎反向，天然制衡）
   * ② 艺术家新颖度 = 候选艺术家不在 favoriteArtists 中 → 1，否则 0
   * ③ 负向调节：候选风格出现在 behavior.skippedFeatures（近期高频跳过）→ 打 7 折
   * ④ 趋势调节：exploring 放大新颖度；repeating 压低（用户偏好熟悉内容）
   *
   * 注：阈值为经验启发式（无调参依据，与动态权重阈值同等性质），0-1 内clamp。
   */
  score(song: any, profile: UserProfile, behavior: BehaviorInsight): number {
    const genreIds = (song.genres || []).map((g: any) => g.genreId).filter((id: any) => id != null) as number[];
    const favGenreIds = new Set(profile.favoriteGenres.map(fg => fg.id));
    const favArtistNames = new Set(profile.favoriteArtists.map(fa => fa.name));

    // ① 风格新颖度：候选风格命中率取反；无标签或无画像时中性 0.5
    const genreNovelty = genreIds.length > 0 && favGenreIds.size > 0
      ? 1 - genreIds.filter(id => favGenreIds.has(id)).length / genreIds.length
      : 0.5;

    // ② 艺术家新颖度：无画像时中性 0.5
    const artist = song.artist || song.trackArtist || '';
    const artistNovelty = favArtistNames.size > 0
      ? (artist && !favArtistNames.has(artist) ? 1 : 0)
      : 0.5;

    let novelty = (genreNovelty + artistNovelty) / 2;

    // ③ 近期高频跳过的风格 → 新颖度打折（即使"新"也是用户不想听的方向）
    const skippedGenreIds = new Set(behavior.skippedFeatures?.genreIds || []);
    if (skippedGenreIds.size > 0 && genreIds.some(id => skippedGenreIds.has(id))) {
      novelty *= 0.7;
    }

    // ④ 行为趋势调节
    if (behavior.recentTrend === 'exploring') {
      novelty = Math.min(1, novelty * 1.2);
    } else if (behavior.recentTrend === 'repeating') {
      novelty *= 0.6;
    }

    return Math.min(1, Math.max(0, novelty));

    // [v1.4.6 旧实现，与 rule-engine 信号重复（A2），保留用于回滚比对]
    // score(song: any, profile: UserProfile, behavior: BehaviorInsight): number {
    //   const genreIds = (song.genres || []).map((g: any) => g.genreId).filter((id: any) => id != null) as number[];
    //   const moodIds = (song.moods || []).map((m: any) => m.moodId).filter((id: any) => id != null) as number[];
    //   const favGenreIds = new Set(profile.favoriteGenres.map(fg => fg.id));
    //   const favMoodIds = new Set(profile.favoriteMoods.map(fm => fm.id));
    //
    //   // 风格匹配占比
    //   const genreMatch = genreIds.length > 0
    //     ? genreIds.filter(id => favGenreIds.has(id)).length / genreIds.length
    //     : 0;
    //   // 情绪匹配占比
    //   const moodMatch = moodIds.length > 0
    //     ? moodIds.filter(id => favMoodIds.has(id)).length / moodIds.length
    //     : 0;
    //
    //   // 0.5 风格 + 0.3 情绪，再叠加行为趋势
    //   let score = 0.5 * genreMatch + 0.3 * moodMatch;
    //   if (behavior.recentTrend === 'exploring') {
    //     score += 0.1;
    //   } else if (behavior.recentTrend === 'repeating') {
    //     score += 0.05;
    //   }
    //
    //   return Math.min(1, score);
    // }
  }
}
