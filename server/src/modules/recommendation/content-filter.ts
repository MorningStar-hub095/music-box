/**
 * 内容过滤器
 * 基于歌曲特征相似度进行推荐
 */

import { SongFeatureExtractor, type SongFeatureVector } from './song-feature-extractor';
import type { UserProfile } from './user-profile-builder';

export interface ContentFilterResult {
  songId: string;
  score: number;
  reason: string;
}

export class ContentFilter {
  constructor(private featureExtractor: SongFeatureExtractor) {}

  /**
   * 基于用户历史播放歌曲的特征，推荐相似歌曲
   *
   * P1-3 重构（v1.4.7）：新增收藏歌曲「第二质心」——
   * 收藏信号由 fusion 层的 +0.3 硬加分改为「与收藏歌曲的特征相似度」，
   * 使未听过的、声学上接近收藏口味的歌曲获得加权（保留 0-1 分数尺度）。
   */
  async score(
    candidates: any[],
    profile: UserProfile,
    recentSongIds: string[],
    favoriteSongIds?: Set<string>
  ): Promise<ContentFilterResult[]> {
    const favIds = [...(favoriteSongIds || [])];

    if (recentSongIds.length === 0 && favIds.length === 0) {
      return candidates.map(c => ({ songId: c.id, score: 0.3, reason: '' }));
    }

    // 获取用户最近播放歌曲的特征向量
    const recentFeatures = await this.featureExtractor.extractBatch(recentSongIds);

    // P1-3：获取收藏歌曲的特征向量，构建第二质心
    // 旧实现：无收藏质心，收藏歌曲仅在 fusion 层加 FAVORITE_SCORE_BOOST(+0.3)
    const favoriteFeatures = favIds.length > 0
      ? await this.featureExtractor.extractBatch(favIds)
      : new Map<string, SongFeatureVector>();

    if (recentFeatures.size === 0 && favoriteFeatures.size === 0) {
      return candidates.map(c => ({ songId: c.id, score: 0.3, reason: '' }));
    }

    // 计算用户特征质心（播放质心；无播放历史时退化为收藏质心）
    const recentCentroid = recentFeatures.size > 0
      ? this.computeCentroid(Array.from(recentFeatures.values()))
      : null;
    const favoriteCentroid = favoriteFeatures.size > 0
      ? this.computeCentroid(Array.from(favoriteFeatures.values()))
      : null;

    // 批量提取候选歌曲特征（单次 DB 查询），
    // 替代旧版循环内逐首 extract() 的 N+1 问题（1000 首候选 = 1000 次 Redis/DB 往返）
    const candidateFeatures = await this.featureExtractor.extractBatch(
      candidates.map(c => c.id)
    );

    // 对候选歌曲评分：取播放质心与收藏质心相似度的较大者
    const results: ContentFilterResult[] = [];
    for (const song of candidates) {
      const feature = candidateFeatures.get(song.id);
      if (!feature) {
        results.push({ songId: song.id, score: 0, reason: '' });
        continue;
      }

      const recentSim = recentCentroid
        ? SongFeatureExtractor.cosineSimilarity(recentCentroid, feature.combined)
        : -1;
      const favSim = favoriteCentroid
        ? SongFeatureExtractor.cosineSimilarity(favoriteCentroid, feature.combined)
        : -1;

      // 取两个质心中更相似的一个作为内容分
      const similarity = Math.max(recentSim, favSim);
      const reason = favSim > recentSim && favSim > 0.5
        ? '与你的收藏曲风相似'
        : similarity > 0.7 ? '声学风格相似' : similarity > 0.5 ? '曲风相近' : '';
      results.push({ songId: song.id, score: Math.max(0, similarity), reason });
    }

    return results;
  }

  /**
   * 计算特征向量质心
   */
  private computeCentroid(features: SongFeatureVector[]): number[] {
    if (features.length === 0) return [];
    const dim = features[0].combined.length;
    const centroid = new Array(dim).fill(0);

    for (const f of features) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += f.combined[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= features.length;
    }

    return centroid;
  }

  /**
   * 计算两个歌曲之间的相似度
   */
  async similarity(songIdA: string, songIdB: string): Promise<number> {
    const [a, b] = await Promise.all([
      this.featureExtractor.extract(songIdA),
      this.featureExtractor.extract(songIdB),
    ]);
    if (!a || !b) return 0;
    return SongFeatureExtractor.similarity(a, b);
  }
}
