import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { UserProfileBuilder } from './user-profile-builder';
import { BehaviorAnalyzer } from './behavior-analyzer';
import { RuleEngine } from './rule-engine';
import { ContentFilter } from './content-filter';
import { CollaborativeFilter } from './collaborative-filter';
import { AIEnhancer } from './ai-enhancer';
import { RecommendationFusion } from './recommendation-fusion';
import { SongFeatureExtractor } from './song-feature-extractor';
import { getConfig, computeDynamicWeights } from './config';

const POOL_CACHE_TTL = 300;
const POOL_CACHE_KEY = 'rec:pool:v1';

type PickedSong = { id: string; song: any; reason?: string };

export class RecommendationService {
  private profileBuilder: UserProfileBuilder;
  private behaviorAnalyzer: BehaviorAnalyzer;
  private ruleEngine: RuleEngine;
  private contentFilter: ContentFilter;
  private collaborativeFilter: CollaborativeFilter;
  private aiEnhancer: AIEnhancer;
  private fusion: RecommendationFusion;
  private featureExtractor: SongFeatureExtractor;

  constructor() {
    this.profileBuilder = new UserProfileBuilder(prisma);
    this.behaviorAnalyzer = new BehaviorAnalyzer(prisma);
    this.ruleEngine = new RuleEngine();
    this.featureExtractor = new SongFeatureExtractor(prisma);
    this.contentFilter = new ContentFilter(this.featureExtractor);
    this.collaborativeFilter = new CollaborativeFilter(prisma);
    this.aiEnhancer = new AIEnhancer();
    this.fusion = new RecommendationFusion(
      this.ruleEngine,
      this.contentFilter,
      this.collaborativeFilter,
      this.featureExtractor
    );
  }

  async generateForUser(userId: number) {
    const config = getConfig();
    const since30 = new Date(Date.now() - 30 * 86400 * 1000);

    // 1. 并行获取数据
    const [events, feedbacks, recentPlays, alreadyRec, favoriteEvents] = await Promise.all([
      prisma.listeningEvent.findMany({
        where: { userId, eventType: { in: ['complete', 'play'] } },
        orderBy: { occurredAt: 'desc' },
        take: config.windows.recentPlays,
      }),
      prisma.recommendationFeedback.findMany({
        where: { userId, createdAt: { gt: since30 } },
        select: { songId: true, feedback: true, weight: true },
      }),
      prisma.listeningEvent.findMany({
        where: { userId, occurredAt: { gt: since30 }, songId: { not: null } },
        select: { songId: true },
      }),
      prisma.dailyRecommendation.findMany({
        where: { userId, generatedAt: { gt: since30 } },
        select: { songId: true },
      }),
      // 收藏歌曲（用于加权推荐）
      prisma.listeningEvent.findMany({
        where: { userId, eventType: 'favorite', songId: { not: null } },
        select: { songId: true },
      }),
    ]);

    // 构建排除集
    const dislikedIds = feedbacks.filter(f => f.feedback === 'dislike').map(f => f.songId);
    const excluded = new Set<string>();
    recentPlays.forEach(r => { if (r.songId) excluded.add(r.songId); });
    dislikedIds.forEach(id => excluded.add(id));
    alreadyRec.forEach(r => excluded.add(r.songId));

    // 收藏歌曲集合（用于加权，提升收藏歌曲优先级）
    const favoriteIds = new Set(favoriteEvents.map(e => e.songId).filter(Boolean) as string[]);

    let picked: PickedSong[];
    if (events.length === 0) {
      picked = await this.fallbackHot(config.limits.dailyRecommendation, excluded);
    } else {
      // 2. 构建用户画像和行为分析
      const [profile, behavior] = await Promise.all([
        this.profileBuilder.build(userId),
        this.behaviorAnalyzer.analyze(userId),
      ]);

      // 3. 获取候选池
      const pool = await this.getCandidatePool();
      const candidates = pool.filter(c => !excluded.has(c.id) && c.features);

      // 4. 获取用户最近播放的歌曲ID
      const recentSongIds = events.map(e => e.songId).filter(Boolean) as string[];

      // 构建 AI 增强分数（基于风格/情绪匹配 + 行为趋势，避免 LLM 延迟）
      const aiScores = new Map<string, { score: number; reason: string }>();
      for (const c of candidates) {
        aiScores.set(c.id, { score: this.aiEnhancer.score(c, profile, behavior), reason: '' });
      }

      // 动态权重（根据数据量与反馈调整）
      const dynamicWeights = computeDynamicWeights(events.length, feedbacks);

      // 使用融合引擎评分（AI 分数 + 收藏加权 + 动态权重）
      const fused = await this.fusion.fuse(candidates, profile, behavior, recentSongIds, userId, aiScores, favoriteIds, dynamicWeights);

      // 6. 生成AI推荐理由
      const reasonMap = this.aiEnhancer.generateReasons(fused.map(f => f.song), profile, behavior);

      // 7. 取Top-K
      picked = fused.slice(0, config.limits.dailyRecommendation).map(f => ({
        id: f.songId,
        song: f.song,
        reason: reasonMap.get(f.songId) || f.reason,
      }));

      // 8. 候选不足时用热门歌曲补齐到目标数量
      // 有特征的可播放歌曲不足（或排除过多）时，避免每日推荐返回少于配置数量
      if (picked.length < config.limits.dailyRecommendation) {
        const pickedIds = new Set(picked.map(p => p.id));
        const fillers = await this.fallbackHot(
          config.limits.dailyRecommendation - picked.length,
          new Set([...excluded, ...pickedIds]),
        );
        picked = [...picked, ...fillers];
      }
    }

    // 持久化
    await this.persist(userId, picked);
    return picked.map(p => p.song);
  }

  private async getCandidatePool() {
    const cached = await cache.get<any[]>(POOL_CACHE_KEY);
    if (cached) return cached;

    // 获取所有可播放歌曲（必须有 audioUrl）
    const allSongs = await prisma.song.findMany({
      where: {
        playable: true,
        archived: false,
        NOT: { audioUrl: '' },
      },
      include: {
        features: true,
        genres: { select: { genreId: true } },
        moods: { select: { moodId: true } },
      },
      orderBy: { hotScore: 'desc' },
      take: 2000,
    });

    // 内容过滤：排除非歌曲内容（播客、有声书、广播节目等）
    const pool = allSongs.filter(song => this.isMusicContent(song));

    // 优先选择有特征数据的歌曲，按热度排序取前1000
    const withFeatures = pool.filter(s => s.features);
    const withoutFeatures = pool.filter(s => !s.features);
    const result = [...withFeatures, ...withoutFeatures].slice(0, 1000);

    console.log(`[REC] 候选池: 总${allSongs.length}首, 音乐${pool.length}首, 有特征${withFeatures.length}首, 最终${result.length}首`);
    await cache.set(POOL_CACHE_KEY, result, POOL_CACHE_TTL);
    return result;
  }

  /**
   * 判断歌曲是否为音乐内容（排除播客、有声书、广播节目等非歌曲内容）
   */
  private isMusicContent(song: any): boolean {
    const title = (song.title || '').toLowerCase();
    const artist = (song.artist || '').toLowerCase();

    // 排除标记为节目的内容
    const nonMusicKeywords = [
      '节目', '有声', '广播', '评书', '相声', '小品', '脱口秀',
      ' audiobook', 'podcast', 'talk show', 'drama', '广播剧',
      '睡前故事', '儿童故事', '寓言', '经文', '佛经', '圣经',
      '冥想', '白噪音', '雨声', 'asmr', '助眠',
      '教程', '教学', '课程', '讲座',
    ];

    for (const keyword of nonMusicKeywords) {
      if (title.includes(keyword) || artist.includes(keyword)) {
        return false;
      }
    }

    // 排除标题格式异常的内容（如"224. 趙雷【成都】"这种播客编号格式）
    if (/^\d+\.\s/.test(song.title)) {
      return false;
    }

    // 排除时长异常的歌曲（< 30秒或 > 10分钟，可能是非音乐内容）
    if (song.duration) {
      const durationSec = song.duration / 1000;
      if (durationSec < 30 || durationSec > 600) {
        return false;
      }
    }

    return true;
  }

  async invalidatePoolCache(): Promise<void> {
    await cache.del(POOL_CACHE_KEY);
  }

  private async persist(userId: number, picked: PickedSong[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.dailyRecommendation.deleteMany({
      where: { userId, generatedAt: { gte: today } },
    });
    if (picked.length === 0) return;
    await prisma.dailyRecommendation.createMany({
      data: picked.map((p, i) => ({
        userId, songId: p.id, rank: i + 1, reason: p.reason ?? '综合推荐', generatedAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  private async fallbackHot(k: number, excluded: Set<string> = new Set()): Promise<PickedSong[]> {
    // P1-4 修复（v1.4.7）：兜底与主候选池统一标准——
    // ① 补齐 NOT audioUrl='' 与主池一致；② 结果同样过 isMusicContent；
    // ③ 优先有特征歌曲。多取 3 倍以保证过滤后仍能凑满 k 个。
    // 旧实现（不过滤，播客/异常内容可经兜底混入每日推荐）：
    // const songs = await prisma.song.findMany({
    //   where: { playable: true, archived: false, id: { notIn: [...excluded] } },
    //   orderBy: { hotScore: 'desc' },
    //   take: k,
    // });
    // return songs.map(s => ({ id: s.id, song: s, reason: '热度推荐' }));
    const songs = await prisma.song.findMany({
      where: {
        playable: true,
        archived: false,
        NOT: { audioUrl: '' },
        id: { notIn: [...excluded] },
      },
      include: { features: true },
      orderBy: { hotScore: 'desc' },
      take: k * 3,
    });

    const music = songs.filter(s => this.isMusicContent(s));
    const withFeatures = music.filter(s => s.features);
    const withoutFeatures = music.filter(s => !s.features);
    const ordered = [...withFeatures, ...withoutFeatures].slice(0, k);

    return ordered.map(s => ({ id: s.id, song: s, reason: '热度推荐' }));
  }

  /** 获取相似歌曲推荐 */
  async getSimilarSongs(songId: string, limit?: number) {
    const { SimilarSongRecommender } = await import('./similar-song-recommender');
    const recommender = new SimilarSongRecommender(prisma, this.featureExtractor);
    return recommender.recommend(songId, limit);
  }

  /** 获取用户画像 */
  async getUserProfile(userId: number) {
    return this.profileBuilder.build(userId);
  }

  /** 获取行为洞察 */
  async getBehaviorInsight(userId: number) {
    return this.behaviorAnalyzer.analyze(userId);
  }

  /** 更新推荐配置 */
  updateConfig(partial: any) {
    const { updateConfig } = require('./config');
    updateConfig(partial);
  }

  /**
   * 获取推荐质量评估报告
   * 包含准确率、多样性、覆盖率等指标
   */
  async getQualityReport(userId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 获取今日推荐
    const recs = await prisma.dailyRecommendation.findMany({
      where: { userId, generatedAt: { gte: today } },
      include: {
        song: {
          include: {
            features: true,
            genres: { include: { genre: true } },
            moods: { include: { mood: true } },
          },
        },
      },
      orderBy: { rank: 'asc' },
    });

    if (recs.length === 0) {
      return { message: '今日暂无推荐', metrics: {} };
    }

    // 获取用户反馈
    const feedbacks = await prisma.recommendationFeedback.findMany({
      where: { userId, createdAt: { gte: today } },
      select: { songId: true, feedback: true },
    });
    const feedbackMap = new Map(feedbacks.map(f => [f.songId, f.feedback]));

    // 计算指标
    const songs = recs.map(r => r.song);
    const total = songs.length;

    // 1. 准确率：C6 细化口径（v1.4.7）——旧实现 accuracy = 1 − dislike/total，
    // 把"无反馈"计为准确，指标虚高；改为仅在有反馈的推荐上计算准确率，
    // 另报 feedbackCoverage（反馈覆盖率）反映用户参与度
    // 旧实现：const accuracy = total > 0 ? (total - negativeCount) / total : 0;
    const positiveCount = recs.filter(r => {
      const fb = feedbackMap.get(r.songId);
      return fb === 'like' || fb === 'favorite';
    }).length;
    const negativeCount = recs.filter(r => feedbackMap.get(r.songId) === 'dislike').length;
    const feedbackCount = positiveCount + negativeCount;
    const accuracy = feedbackCount > 0 ? positiveCount / feedbackCount : 0;
    const feedbackCoverage = total > 0 ? feedbackCount / total : 0;

    // 2. 多样性：不同风格的数量
    const genreSet = new Set<number>();
    const artistSet = new Set<string>();
    for (const song of songs) {
      artistSet.add(song.artist);
      for (const g of song.genres || []) {
        genreSet.add(g.genreId);
      }
    }
    const genreDiversity = genreSet.size;
    const artistDiversity = artistSet.size;

    // 3. 新鲜度：用户未听过的歌曲比例
    const recentPlays = await prisma.listeningEvent.findMany({
      where: { userId, occurredAt: { gte: new Date(Date.now() - 30 * 86400 * 1000) } },
      select: { songId: true },
    });
    const playedSet = new Set(recentPlays.map(p => p.songId).filter(Boolean));
    const newSongs = songs.filter(s => !playedSet.has(s.id)).length;
    const freshness = total > 0 ? newSongs / total : 0;

    // 4. 内容质量：有特征数据的歌曲比例
    const withFeatures = songs.filter(s => s.features).length;
    const featureCoverage = total > 0 ? withFeatures / total : 0;

    // 5. 内容过滤：非歌曲内容检测
    const nonMusicCount = songs.filter(s => !this.isMusicContent(s)).length;
    const contentPurity = total > 0 ? (total - nonMusicCount) / total : 0;

    return {
      total,
      metrics: {
        accuracy: Math.round(accuracy * 100),
        feedbackCoverage: Math.round(feedbackCoverage * 100),
        genreDiversity,
        artistDiversity,
        freshness: Math.round(freshness * 100),
        featureCoverage: Math.round(featureCoverage * 100),
        contentPurity: Math.round(contentPurity * 100),
      },
      feedbackSummary: {
        total: feedbacks.length,
        likes: feedbacks.filter(f => f.feedback === 'like').length,
        dislikes: negativeCount,
        favorites: feedbacks.filter(f => f.feedback === 'favorite').length,
      },
    };
  }
}
