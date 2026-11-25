/**
 * 内容过滤器批量特征提取测试
 * 对应优化3（M4）：验证评分路径使用单次 extractBatch，不再逐首 extract（N+1）
 */
import { ContentFilter } from '../src/modules/recommendation/content-filter';
import type { SongFeatureVector } from '../src/modules/recommendation/song-feature-extractor';

function vec(id: string, values: number[]): SongFeatureVector {
  return { songId: id, acoustic: values.slice(0, 8), semantic: values.slice(8), combined: values };
}

describe('ContentFilter 批量特征提取（N+1 消除）', () => {
  it('评分只调用一次 extractBatch，不调用逐首 extract', async () => {
    let batchCalls = 0;
    let singleCalls = 0;
    const candidates = Array.from({ length: 50 }, (_, i) => ({ id: `cand-${i}` }));

    const stubExtractor: any = {
      // 近期播放特征
      extractBatch: async (ids: string[]) => {
        batchCalls++;
        const m = new Map<string, SongFeatureVector>();
        for (const id of ids) m.set(id, vec(id, new Array(20).fill(0.5)));
        return m;
      },
      // 逐首提取：若被调用即计数（优化前评分路径会对每首候选调用）
      extract: async (_id: string) => {
        singleCalls++;
        return vec(_id, new Array(20).fill(0.5));
      },
    };

    const filter = new ContentFilter(stubExtractor);
    const profile: any = { favoriteGenres: [], favoriteMoods: [] };
    const results = await filter.score(candidates, profile, ['recent-1', 'recent-2']);

    expect(batchCalls).toBe(2);        // 近期播放 1 次 + 候选批量 1 次 = 2
    expect(singleCalls).toBe(0);       // 逐首 extract 不应被调用
    expect(results.length).toBe(50);
    // 全部候选特征与质心相同 → 相似度 1
    expect(results[0].score).toBeCloseTo(1, 6);
    expect(results[0].reason).toBe('声学风格相似');
  });

  it('无近期播放时返回中性默认分，不触发任何特征提取', async () => {
    let batchCalls = 0;
    const stubExtractor: any = {
      extractBatch: async () => { batchCalls++; return new Map(); },
      extract: async () => null,
    };
    const filter = new ContentFilter(stubExtractor);
    const results = await filter.score([{ id: 'a' }], {} as any, []);
    expect(batchCalls).toBe(0);
    expect(results[0].score).toBe(0.3);
  });
});
