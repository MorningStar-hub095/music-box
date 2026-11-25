/**
 * 歌曲特征提取器
 * 构建歌曲的综合特征向量，用于相似度计算
 *
 * 语义特征采用 multi-hot 编码：向量维度与全量标签字典一一对应，
 * 歌曲拥有某风格/情绪/场景则在对应维度置 1。
 * 相比旧版「ID 取模填入顺序槽位」的标量编码，本编码保证了
 * 余弦相似度的数学意义：仅当两首歌共享同一标签时对应维度才同时非零。
 */

import { PrismaClient } from '@prisma/client';
import { cache } from '../../lib/redis';

export interface SongFeatureVector {
  songId: string;
  /** 声学特征向量（8维） */
  acoustic: number[];
  /** 语义特征向量（multi-hot：风格字典 + 情绪字典 + 场景字典 + 热度 1 维） */
  semantic: number[];
  /** 综合特征向量 */
  combined: number[];
}

/** 标签字典：全量风格/情绪/场景 ID（升序）及其到向量维度的索引映射 */
export interface SemanticVocab {
  genreIds: number[];
  moodIds: number[];
  sceneIds: number[];
  genreIndex: Map<number, number>;
  moodIndex: Map<number, number>;
  sceneIndex: Map<number, number>;
}

const CACHE_KEY_PREFIX = 'song:feature:v2:'; // v2：multi-hot 编码，与旧标量编码缓存不兼容
const CACHE_TTL = 86400; // 24小时

/** 标签字典内存缓存时长（24h，标签表变更后自动刷新） */
const VOCAB_TTL_MS = 86400_000;

export class SongFeatureExtractor {
  private vocab: SemanticVocab | null = null;
  private vocabLoadedAt = 0;

  constructor(private prisma: PrismaClient) {}

  /**
   * 加载标签字典（全量风格/情绪/场景 ID，按 id 升序），带 24h 内存缓存。
   * 字典决定语义向量的维度与槽位语义，全库共享同一份，保证可比性。
   */
  async loadVocab(): Promise<SemanticVocab> {
    if (this.vocab && Date.now() - this.vocabLoadedAt < VOCAB_TTL_MS) {
      return this.vocab;
    }
    const [genres, moods, scenes] = await Promise.all([
      this.prisma.genre.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      this.prisma.mood.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      this.prisma.scene.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    ]);
    const genreIds = genres.map((g) => g.id);
    const moodIds = moods.map((m) => m.id);
    const sceneIds = scenes.map((s) => s.id);
    this.vocab = {
      genreIds,
      moodIds,
      sceneIds,
      genreIndex: new Map(genreIds.map((id, i) => [id, i])),
      moodIndex: new Map(moodIds.map((id, i) => [id, i])),
      sceneIndex: new Map(sceneIds.map((id, i) => [id, i])),
    };
    this.vocabLoadedAt = Date.now();
    return this.vocab;
  }

  async extract(songId: string): Promise<SongFeatureVector | null> {
    const cacheKey = `${CACHE_KEY_PREFIX}${songId}`;
    const cached = await cache.get<SongFeatureVector>(cacheKey);
    if (cached) return cached;

    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      include: {
        features: true,
        genres: { include: { genre: true } },
        moods: { include: { mood: true } },
        scenes: { include: { scene: true } },
      },
    });

    if (!song || !song.features) return null;

    const acoustic = [
      song.features.subBass, song.features.bass, song.features.lowMid, song.features.mid,
      song.features.highMid, song.features.presence, song.features.brilliance, song.features.air,
    ];

    const vocab = await this.loadVocab();
    const semantic = this.buildSemanticVector(song, vocab);
    const combined = [...acoustic, ...semantic];

    const vector: SongFeatureVector = {
      songId,
      acoustic,
      semantic,
      combined,
    };

    await cache.set(cacheKey, vector, CACHE_TTL);
    return vector;
  }

  async extractBatch(songIds: string[]): Promise<Map<string, SongFeatureVector>> {
    const result = new Map<string, SongFeatureVector>();
    if (songIds.length === 0) return result;

    // 批量获取
    const songs = await this.prisma.song.findMany({
      where: { id: { in: songIds } },
      include: {
        features: true,
        genres: { include: { genre: true } },
        moods: { include: { mood: true } },
        scenes: { include: { scene: true } },
      },
    });

    const vocab = await this.loadVocab();

    for (const song of songs) {
      if (!song.features) continue;

      const acoustic = [
        song.features.subBass, song.features.bass, song.features.lowMid, song.features.mid,
        song.features.highMid, song.features.presence, song.features.brilliance, song.features.air,
      ];
      const semantic = this.buildSemanticVector(song, vocab);
      const combined = [...acoustic, ...semantic];

      result.set(song.id, { songId: song.id, acoustic, semantic, combined });
    }

    return result;
  }

  /** multi-hot：ids 中出现在字典里的每个标签，在对应维度置 1 */
  private static multiHot(
    ids: (number | null | undefined)[],
    indexMap: Map<number, number>,
    dim: number
  ): number[] {
    const vec = new Array(dim).fill(0);
    for (const id of ids || []) {
      if (id == null) continue;
      const idx = indexMap.get(id);
      if (idx !== undefined) vec[idx] = 1;
    }
    return vec;
  }

  /**
   * 构建语义特征向量（multi-hot 编码）
   * 维度 = |风格字典| + |情绪字典| + |场景字典| + 1（热度）
   * 向量槽位与全库标签一一对应，跨歌曲可比
   */
  buildSemanticVector(song: any, vocab: SemanticVocab): number[] {
    const genreVec = SongFeatureExtractor.multiHot(
      (song.genres || []).map((g: any) => g.genreId),
      vocab.genreIndex,
      vocab.genreIds.length
    );
    const moodVec = SongFeatureExtractor.multiHot(
      (song.moods || []).map((m: any) => m.moodId),
      vocab.moodIndex,
      vocab.moodIds.length
    );
    const sceneVec = SongFeatureExtractor.multiHot(
      (song.scenes || []).map((s: any) => s.sceneId),
      vocab.sceneIndex,
      vocab.sceneIds.length
    );

    // 热度特征（归一化）
    const hotFeature = Math.min((song.hotScore || 0) / 100, 1);

    return [...genreVec, ...moodVec, ...sceneVec, hotFeature];
  }

  /**
   * 计算两个歌曲特征向量的相似度
   * 综合声学相似度和语义相似度
   */
  static similarity(a: SongFeatureVector, b: SongFeatureVector): number {
    const acousticSim = this.cosineSimilarity(a.acoustic, b.acoustic);
    const semanticSim = this.cosineSimilarity(a.semantic, b.semantic);
    // 声学权重0.6，语义权重0.4
    return 0.6 * acousticSim + 0.4 * semanticSim;
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async invalidateCache(songId: string): Promise<void> {
    await cache.del(`${CACHE_KEY_PREFIX}${songId}`);
  }
}
