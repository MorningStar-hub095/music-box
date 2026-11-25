/**
 * 推荐融合器
 * 将多种推荐算法的结果融合，输出最终推荐列表
 */

import { RuleEngine, type RuleScoreResult } from './rule-engine';
import { ContentFilter, type ContentFilterResult } from './content-filter';
import { CollaborativeFilter, type CollaborativeFilterResult } from './collaborative-filter';
import { SongFeatureExtractor, type SongFeatureVector } from './song-feature-extractor';
import type { UserProfile } from './user-profile-builder';
import type { BehaviorInsight } from './behavior-analyzer';
import { getConfig } from './config';
import { mmrSelectBySimilarity } from './preference.engine';

// [P1-3 v1.4.7 移除] 收藏歌曲加权分值（旧实现：叠加到融合分数上，破坏 0-1 分数尺度，
// 且把用户已收藏的已知歌曲推进每日推荐 Top 榜；收藏信号已改为 content-filter 收藏质心）
// const FAVORITE_SCORE_BOOST = 0.3;

export interface FusedRecommendation {
  songId: string;
  song: any;
  score: number;
  reason: string;
  sources: {
    rule: number;
    content: number;
    collaborative: number;
    ai: number;
  };
}

export class RecommendationFusion {
  constructor(
    private ruleEngine: RuleEngine,
    private contentFilter: ContentFilter,
    private collaborativeFilter: CollaborativeFilter,
    private featureExtractor: SongFeatureExtractor
  ) {}

  /**
   * 融合多种推荐算法的结果
   */
  async fuse(
    candidates: any[],
    profile: UserProfile,
    behavior: BehaviorInsight,
    recentSongIds: string[],
    userId: number,
    aiScores?: Map<string, { score: number; reason: string }>,
    favoriteSongIds?: Set<string>,
    weights?: { rule: number; content: number; collaborative: number; ai: number }
  ): Promise<FusedRecommendation[]> {
    const config = getConfig();
    // P2-1 注意：必须克隆权重对象——w 可能直接引用 config.weights 单例，
    // 原地修改会污染全局默认配置（旧实现 const w = weights ?? config.weights 未克隆）
    const w = { ...(weights ?? config.weights) };

    // 并行计算各算法分数
    // P1-3：收藏歌曲 ID 传入内容过滤，构建「收藏质心」参与相似度评分
    // （旧实现：contentFilter.score 不接收收藏 ID，收藏仅在下方 +0.3 硬加分）
    const [ruleScores, contentScores, collabScores] = await Promise.all([
      Promise.resolve(this.ruleEngine.score(candidates, profile, behavior)),
      this.contentFilter.score(candidates, profile, recentSongIds, favoriteSongIds),
      this.collaborativeFilter.score(candidates, userId, profile),
    ]);

    // 构建分数索引
    const ruleMap = new Map(ruleScores.map(r => [r.songId, r]));
    const contentMap = new Map(contentScores.map(c => [c.songId, c]));
    const collabMap = new Map(collabScores.map(c => [c.songId, c]));

    // P2-1（v1.4.7）：协同分数无信息量时自适应重分配权重。
    // 桌面单用户场景下相似用户几乎恒为空，协同过滤恒返默认分 0.3
    // （collaborative-filter.ts 无相似用户分支），0.25 权重实际是给全部候选
    // 统一加 0.075 的常量项——不影响排序、只抬高分数均值。
    // 检测方式：协同分数全部相同（方差为 0）→ 判定为无信息量，
    // 将其权重就地重分配（60% 给 content、40% 给 rule）并保持总和不变。
    const collabIsConstant = collabScores.length > 0
      && new Set(collabScores.map(c => c.score)).size === 1;
    if (collabIsConstant) {
      const redistribute = w.collaborative;
      w.collaborative = 0;
      w.content += redistribute * 0.6;
      w.rule += redistribute * 0.4;
    }

    // 融合评分
    const fused: FusedRecommendation[] = candidates.map(song => {
      const rule = ruleMap.get(song.id);
      const content = contentMap.get(song.id);
      const collab = collabMap.get(song.id);
      const ai = aiScores?.get(song.id);

      const ruleScore = rule?.score || 0;
      const contentScore = content?.score || 0;
      const collabScore = collab?.score || 0;
      const aiScore = ai?.score || 0;

      // 加权融合（使用传入的权重，未传则用默认配置）
      // （原 let 声明：收藏加分数值移除后 finalScore 不再被重新赋值，改 const）
      const finalScore =
        w.rule * ruleScore +
        w.content * contentScore +
        w.collaborative * collabScore +
        w.ai * aiScore;

      // [P1-3 v1.4.7 移除] 收藏歌曲 +0.3 硬加分（FAVORITE_SCORE_BOOST）：
      // 旧实现把已收藏歌曲硬推进 Top 榜且破坏 0-1 分数尺度，收藏信号已由
      // content-filter 的收藏质心承载（相似于收藏的未听歌曲获得加权）
      // if (favoriteSongIds?.has(song.id)) {
      //   finalScore += FAVORITE_SCORE_BOOST;
      // }

      // 合并推荐理由
      const reasons = [
        rule?.reason,
        content?.reason,
        collab?.reason,
        ai?.reason,
        favoriteSongIds?.has(song.id) ? '你收藏过的歌曲' : undefined,
      ].filter(Boolean);

      return {
        songId: song.id,
        song,
        score: finalScore,
        reason: reasons.length > 0 ? reasons[0]! : '综合推荐',
        sources: {
          rule: ruleScore,
          content: contentScore,
          collaborative: collabScore,
          ai: aiScore,
        },
      };
    });

    // MMR 多样性选择
    return this.mmrSelect(fused, config.mmr.lambda);
  }

  /**
   * MMR 多样性选择：委托 preference.engine 的统一实现
   * （mmrSelectBySimilarity：MMR(d) = λ·score − (1−λ)·maxSim，λ 越大越强调准确性）
   *
   * P0-2 性能修复（v1.4.7）：
   * ① 只对融合分 Top-N（config.mmr.topN，默认 50）做 MMR 重排——下游仅消费 Top-10，
   *    全量 1000 首的全序重排（约 O(n³/6) 次相似度计算）是纯浪费，且击穿电台 3s 竞速；
   * ② 一次性物化 Top-N 候选的 genre/mood Set，替代旧实现中每次两两比较重建 4 个 Set。
   */
  private mmrSelect(recommendations: FusedRecommendation[], lambda: number): FusedRecommendation[] {
    const config = getConfig();
    const topN = Math.min(config.mmr.topN || 50, recommendations.length);

    // 旧实现（全量 MMR，n=1000 时估算秒级~分钟级，radio-stream 3s 竞速恒超时）：
    // return mmrSelectBySimilarity(
    //   recommendations,
    //   recommendations.length,
    //   lambda,
    //   (a, b) => this.songSimilarity(a.song, b.song)
    // );

    // ① 按融合分降序截取 Top-N，MMR 在该子集内做多样性重排
    const top = [...recommendations].sort((a, b) => b.score - a.score).slice(0, topN);

    // ② 预构建类别集合（每首歌只建一次，替代逐比较重建）
    const setCache = new Map<string, { genres: Set<string>; moods: Set<string> }>();
    for (const r of top) {
      setCache.set(r.songId, {
        genres: new Set((r.song.genres || []).map((g: any) => g.genreId)),
        moods: new Set((r.song.moods || []).map((m: any) => m.moodId)),
      });
    }

    return mmrSelectBySimilarity(
      top,
      top.length,
      lambda,
      (a, b) => this.categoryJaccard(setCache.get(a.songId)!, setCache.get(b.songId)!)
    );
  }

  /**
   * 基于预构建集合的类别 Jaccard 相似度（风格 + 情绪各半），
   * 语义与旧版 songSimilarity 完全一致，仅消除 Set 重建开销。
   */
  private categoryJaccard(
    a: { genres: Set<string>; moods: Set<string> },
    b: { genres: Set<string>; moods: Set<string> }
  ): number {
    let genreInter = 0;
    for (const g of a.genres) if (b.genres.has(g)) genreInter++;
    const genreUnion = a.genres.size + b.genres.size - genreInter;
    const genreSim = genreUnion > 0 ? genreInter / genreUnion : 0;

    let moodInter = 0;
    for (const m of a.moods) if (b.moods.has(m)) moodInter++;
    const moodUnion = a.moods.size + b.moods.size - moodInter;
    const moodSim = moodUnion > 0 ? moodInter / moodUnion : 0;

    return (genreSim + moodSim) / 2;
  }

  /**
   * 计算两首歌的相似度（简化版，基于分类）
   * [v1.4.6 旧实现，已被预构建集合版替代（见 categoryJaccard），保留用于回滚比对]
   * private songSimilarity(a: any, b: any): number {
   *   const aGenres = new Set((a.genres || []).map((g: any) => g.genreId));
   *   const bGenres = new Set((b.genres || []).map((g: any) => g.genreId));
   *   const aMoods = new Set((a.moods || []).map((m: any) => m.moodId));
   *   const bMoods = new Set((b.moods || []).map((m: any) => m.moodId));
   *
   *   // Jaccard 相似度
   *   let genreInter = 0;
   *   for (const g of aGenres) if (bGenres.has(g)) genreInter++;
   *   const genreUnion = aGenres.size + bGenres.size - genreInter;
   *   const genreSim = genreUnion > 0 ? genreInter / genreUnion : 0;
   *
   *   let moodInter = 0;
   *   for (const m of aMoods) if (bMoods.has(m)) moodInter++;
   *   const moodUnion = aMoods.size + bMoods.size - moodInter;
   *   const moodSim = moodUnion > 0 ? moodInter / moodUnion : 0;
   *
   *   return (genreSim + moodSim) / 2;
   * }
   */
}
