/**
 * 推荐优化 v1.4.7 回归测试（对应分析报告 P0-2 / P1-2 / P1-3 / P2-1 / P2-5）
 * 纯逻辑测试：不依赖 DB，通过桩对象替代 RuleEngine/ContentFilter/CollaborativeFilter
 */

import { AIEnhancer } from '../src/modules/recommendation/ai-enhancer';
import { RecommendationFusion } from '../src/modules/recommendation/recommendation-fusion';
import { getConfig, updateConfig, defaultConfig } from '../src/modules/recommendation/config';
import type { UserProfile } from '../src/modules/recommendation/user-profile-builder';
import type { BehaviorInsight } from '../src/modules/recommendation/behavior-analyzer';

// ---------- 测试夹具 ----------

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 1,
    favoriteGenres: [{ id: 1, name: 'Jazz', weight: 5 }],
    favoriteArtists: [{ name: 'ArtistA', weight: 5 }],
    favoriteMoods: [{ id: 10, name: 'Calm', weight: 5 }],
    avgListenDuration: 120,
    skipRate: 0.1,
    repeatRate: 0.2,
    timePreferences: [],
    currentMood: null,
    totalPlays: 100,
    uniqueSongs: 40,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeBehavior(overrides: Partial<BehaviorInsight> = {}): BehaviorInsight {
  return {
    recentTrend: 'exploring',
    currentHourPreference: null,
    continuousPlayStreak: 0,
    skippedFeatures: { genreIds: [], moodIds: [] },
    activityScore: 0.5,
    ...overrides,
  };
}

function makeSong(id: string, genreIds: number[], artist = 'ArtistX') {
  return {
    id,
    title: `Song ${id}`,
    artist,
    genres: genreIds.map(g => ({ genreId: g })),
    moods: [],
    hotScore: 50,
  };
}

// ---------- 1. config：mmr.topN ----------

describe('P0-2 config: mmr.topN', () => {
  test('默认 topN = 50，且 updateConfig 可合并更新', () => {
    expect(defaultConfig.mmr.topN).toBe(50);
    expect(getConfig().mmr.topN).toBe(50);

    updateConfig({ mmr: { lambda: 0.8, topN: 30 } });
    expect(getConfig().mmr.lambda).toBe(0.8);
    expect(getConfig().mmr.topN).toBe(30);
    // 其他字段不被覆盖
    expect(getConfig().weights.rule).toBe(defaultConfig.weights.rule);

    // 还原
    updateConfig({ mmr: { lambda: defaultConfig.mmr.lambda, topN: defaultConfig.mmr.topN } });
  });
});

// ---------- 2. AIEnhancer：新颖度独立信号（P1-2） ----------

describe('P1-2 AIEnhancer.score 改为新颖度信号', () => {
  const enhancer = new AIEnhancer();

  test('熟悉内容（收藏风格+收藏艺术家）新颖度应低于陌生内容', () => {
    const profile = makeProfile();
    const behavior = makeBehavior();

    const known = enhancer.score(makeSong('known', [1], 'ArtistA'), profile, behavior);
    const novel = enhancer.score(makeSong('novel', [999], 'ArtistZ'), profile, behavior);

    expect(known).toBeLessThan(novel);
    expect(novel).toBeLessThanOrEqual(1);
    expect(known).toBeGreaterThanOrEqual(0);
  });

  test('repeating 趋势压低新颖度，exploring 放大', () => {
    const profile = makeProfile();
    const song = makeSong('novel', [999], 'ArtistZ');

    const exploring = enhancer.score(song, profile, makeBehavior({ recentTrend: 'exploring' }));
    const repeating = enhancer.score(song, profile, makeBehavior({ recentTrend: 'repeating' }));
    expect(repeating).toBeLessThan(exploring);
  });

  test('近期高频跳过的风格应被打折', () => {
    const profile = makeProfile();
    const song = makeSong('skipped-dir', [999], 'ArtistZ');
    const base = enhancer.score(song, profile, makeBehavior());
    const penalized = enhancer.score(
      song,
      profile,
      makeBehavior({ skippedFeatures: { genreIds: [999], moodIds: [] } })
    );
    expect(penalized).toBeLessThan(base);
  });

  test('与旧实现不同：不再以风格匹配率为主信号（匹配 favoriteGenres 应得低分）', () => {
    const profile = makeProfile();
    const behavior = makeBehavior();
    // 完全命中收藏风格 + 收藏艺术家 → 新颖度 0
    const fullyKnown = enhancer.score(makeSong('hit', [1], 'ArtistA'), profile, behavior);
    expect(fullyKnown).toBe(0);
  });
});

// ---------- 3. Fusion：收藏硬加分移除 + 协同自适应 + MMR Top-N ----------

type ScoreRow = { songId: string; score: number; reason: string };

function stubRule(scores: Record<string, number>) {
  return {
    score: (candidates: any[]): { songId: string; score: number; reason: string }[] =>
      candidates.map(c => ({ songId: c.id, score: scores[c.id] ?? 0, reason: '' })),
  } as any;
}

function stubContent(scores: Record<string, number>) {
  return {
    score: async (candidates: any[]): Promise<ScoreRow[]> =>
      candidates.map(c => ({ songId: c.id, score: scores[c.id] ?? 0, reason: '' })),
  } as any;
}

function stubCollab(constantScore: number | null) {
  return {
    score: async (candidates: any[]): Promise<ScoreRow[]> =>
      candidates.map(c => ({
        songId: c.id,
        // 有区分度分支：按完整 id 求和哈希，保证不同候选分数不同
        score: constantScore === null
          ? ([...c.id].reduce((s: number, ch: string) => s + ch.charCodeAt(0), 0) % 10) / 10
          : constantScore,
        reason: '',
      })),
  } as any;
}

function stubFeatureExtractor() {
  return {} as any;
}

describe('P1-3 / P2-1 / P0-2 fusion 行为', () => {
  function buildFusion(ruleScores: Record<string, number>, contentScores: Record<string, number>, collab: any) {
    return new RecommendationFusion(
      stubRule(ruleScores),
      stubContent(contentScores),
      collab,
      stubFeatureExtractor()
    );
  }

  test('收藏歌曲不再获得 +0.3 硬加分（分数尺度保持 0-1 加权和）', async () => {
    const fusion = buildFusion({ fav: 0.5, other: 0.5 }, { fav: 0.5, other: 0.5 }, stubCollab(0.3));
    const profile = makeProfile();
    const behavior = makeBehavior();
    const candidates = [makeSong('fav', [1], 'ArtistA'), makeSong('other', [2], 'ArtistB')];
    const favorites = new Set(['fav']);

    const out = await fusion.fuse(candidates, profile, behavior, [], 1, new Map(), favorites);
    const favScore = out.find(r => r.songId === 'fav')!.score;
    const otherScore = out.find(r => r.songId === 'other')!.score;

    // 两首歌四路分数完全一致 → 融合分必须相等（旧实现 fav 会多 0.3）
    expect(favScore).toBeCloseTo(otherScore, 6);
    // 且不超过 1（0.3*0.5+0.45*0.5+0*0.3+0.15*0 ≈ 0.375）
    expect(favScore).toBeLessThanOrEqual(1);
  });

  test('协同分数恒定时权重自适应重分配（collab→0，content+60%，rule+40%）', async () => {
    // rule=1, content=0, ai=0 → 重分配后期望 0.4*1 = 0.4（旧实现为 0.3*1+0.25*0.3 = 0.375）
    const fusion = buildFusion({ s1: 1, s2: 0 }, { s1: 0, s2: 1 }, stubCollab(0.3));
    const out = await fusion.fuse(
      [makeSong('s1', [1]), makeSong('s2', [2])],
      makeProfile(),
      makeBehavior(),
      [],
      1,
      new Map()
    );
    const s1 = out.find(r => r.songId === 's1')!;
    expect(s1.sources.collaborative).toBe(0.3); // 原始协同分仍记录
    // 0.4*1 + 0.45*0 + 0*0.3 + 0.15*0 = 0.4
    expect(s1.score).toBeCloseTo(0.4, 6);

    // 协同分数有区分度时不重分配（id 改用 x*，避免 s1 哈希值恰使 0.3+0.25*collab=0.4 的巧合）
    const fusion2 = buildFusion({ x1: 1, x2: 0 }, { x1: 0, x2: 1 }, stubCollab(null));
    const out2 = await fusion2.fuse(
      [makeSong('x1', [1]), makeSong('x2', [2])],
      makeProfile(),
      makeBehavior(),
      [],
      1,
      new Map()
    );
    // 0.3*1 + 0.25*collab(x1) ≈ 非 0.4 的重分配值（只断言不等于重分配结果）
    const s1v2 = out2.find(r => r.songId === 'x1')!;
    expect(s1v2.score).not.toBeCloseTo(0.4, 6);
  });

  test('MMR 只对融合分 Top-N（默认 50）重排，输出截断为 Top-N', async () => {
    const ruleScores: Record<string, number> = {};
    const contentScores: Record<string, number> = {};
    const candidates: any[] = [];
    for (let i = 0; i < 80; i++) {
      const id = `song${String(i).padStart(3, '0')}`;
      ruleScores[id] = (i % 20) / 20; // 有区分度
      contentScores[id] = (i % 7) / 7;
      candidates.push(makeSong(id, [i % 5 + 1], `Artist${i % 10}`));
    }
    const fusion = buildFusion(ruleScores, contentScores, stubCollab(0.3));
    const out = await fusion.fuse(candidates, makeProfile(), makeBehavior(), [], 1, new Map());

    expect(out.length).toBe(50);
    // 分数降序大体保持（MMR 允许多样性微调，但 Top 高分不应被挤出前列）
    expect(out[0].score).toBeGreaterThanOrEqual(out[out.length - 1].score);
  });
});
