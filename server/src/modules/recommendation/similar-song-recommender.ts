/**
 * 相似歌曲推荐器
 * 基于歌曲特征向量推荐相似歌曲
 */

import { PrismaClient } from '@prisma/client';
import { SongFeatureExtractor, type SongFeatureVector } from './song-feature-extractor';
import { getConfig } from './config';
import { cache } from '../../lib/redis';

export interface SimilarSongResult {
  songId: string;
  song: any;
  similarity: number;
  reason: string;
}

const CACHE_KEY_PREFIX = 'rec:similar:';

export class SimilarSongRecommender {
  constructor(
    private prisma: PrismaClient,
    private featureExtractor: SongFeatureExtractor
  ) {}

  /**
   * 推荐与指定歌曲相似的歌曲
   */
  async recommend(songId: string, limit?: number): Promise<SimilarSongResult[]> {
    const config = getConfig();
    const k = limit || config.limits.similarSong;
    const cacheKey = `${CACHE_KEY_PREFIX}${songId}:${k}`;

    // 尝试从缓存获取
    const cached = await cache.get<SimilarSongResult[]>(cacheKey);
    if (cached) return cached;

    // 获取目标歌曲特征
    const targetFeature = await this.featureExtractor.extract(songId);
    if (!targetFeature) return [];

    // 获取目标歌曲信息
    const targetSong = await this.prisma.song.findUnique({
      where: { id: songId },
      include: {
        genres: { include: { genre: true } },
        moods: { include: { mood: true } },
      },
    });
    if (!targetSong) return [];

    // 获取候选歌曲池
    const pool = await this.getCandidatePool(songId);

    // 计算相似度
    // P1-1 性能修复（v1.4.7）：改用 extractBatch 一次查询替代逐首 extract 的 N+1
    // （旧实现循环内逐首 await extract()，500 首候选 = 500 次 Redis/DB 往返）：
    // const scored: SimilarSongResult[] = [];
    // for (const song of pool) {
    //   const feature = await this.featureExtractor.extract(song.id);
    //   if (!feature) continue;
    //
    //   const similarity = SongFeatureExtractor.similarity(targetFeature, feature);
    //   const reason = this.generateReason(targetSong, song, similarity);
    //
    //   scored.push({
    //     songId: song.id,
    //     song,
    //     similarity,
    //     reason,
    //   });
    // }
    const featureMap = await this.featureExtractor.extractBatch(pool.map(s => s.id));

    const scored: SimilarSongResult[] = [];
    for (const song of pool) {
      const feature = featureMap.get(song.id);
      if (!feature) continue;

      const similarity = SongFeatureExtractor.similarity(targetFeature, feature);
      const reason = this.generateReason(targetSong, song, similarity);

      scored.push({
        songId: song.id,
        song,
        similarity,
        reason,
      });
    }

    // 排序取 Top-K
    const result = scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);

    // 缓存
    await cache.set(cacheKey, result, 1800); // 30分钟
    return result;
  }

  /**
   * 获取候选歌曲池（排除目标歌曲）
   */
  private async getCandidatePool(excludeId: string) {
    return this.prisma.song.findMany({
      where: {
        playable: true,
        archived: false,
        id: { not: excludeId },
      },
      include: {
        features: true,
        genres: { include: { genre: true } },
        moods: { include: { mood: true } },
      },
      take: 500,
    });
  }

  /**
   * 生成推荐理由
   */
  private generateReason(target: any, candidate: any, similarity: number): string {
    const targetGenres = new Set<string>((target.genres || []).map((g: any) => (g.genre?.name as string)).filter(Boolean));
    const candGenres = new Set<string>((candidate.genres || []).map((g: any) => (g.genre?.name as string)).filter(Boolean));

    // 找共同风格
    const commonGenres: string[] = [];
    for (const g of targetGenres) {
      if (candGenres.has(g as string)) commonGenres.push(g as string);
    }

    if (similarity > 0.8) {
      return commonGenres.length > 0
        ? `与${target.title}风格高度相似（${commonGenres[0]}）`
        : `与${target.title}声学特征高度相似`;
    } else if (similarity > 0.6) {
      return commonGenres.length > 0
        ? `曲风相近（${commonGenres[0]}）`
        : '声学风格相似';
    } else {
      return '相似歌曲推荐';
    }
  }

  async invalidateCache(songId: string): Promise<void> {
    // 简单实现：删除相关缓存键
    const config = getConfig();
    await cache.del(`${CACHE_KEY_PREFIX}${songId}:${config.limits.similarSong}`);
  }
}
