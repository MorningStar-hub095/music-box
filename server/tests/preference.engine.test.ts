import { computeAcousticCentroid, mmrSelect, cosine, acousticSimilarity } from '../src/modules/recommendation/preference.engine';

describe('preference engine', () => {
  it('computes weighted centroid of feature vectors', () => {
    const events = [
      { features: { subBass:0.8, bass:0.7, lowMid:0.5, mid:0.4, highMid:0.3, presence:0.2, brilliance:0.1, air:0.1 }, weight: 0.9 },
      { features: { subBass:0.2, bass:0.2, lowMid:0.3, mid:0.3, highMid:0.4, presence:0.5, brilliance:0.6, air:0.7 }, weight: 0.3 },
    ];
    const c = computeAcousticCentroid(events as any);
    // 高权重第一项主导，低频应更高
    expect(c.subBass).toBeGreaterThan(c.air);
    const totalW = 0.9 + 0.3;
    expect(c.subBass).toBeCloseTo((0.8*0.9 + 0.2*0.3) / totalW, 3);
    expect(c.air).toBeCloseTo((0.1*0.9 + 0.7*0.3) / totalW, 3);
  });

  it('cosine similarity returns 1 for identical, 0 for orthogonal', () => {
    expect(cosine([1,0], [1,0])).toBeCloseTo(1, 3);
    expect(cosine([1,0], [0,1])).toBeCloseTo(0, 3);
    expect(cosine([], [])).toBe(0); // 空向量安全
  });

  it('selects diverse top-k via MMR', () => {
    const candidates = [
      { id:'a', vector:[1,0], score:0.9 },
      { id:'b', vector:[0.99,0.01], score:0.88 }, // 与 a 极相似
      { id:'c', vector:[0,1], score:0.85 },
      { id:'d', vector:[0.5,0.5], score:0.8 },
    ];
    const picked = mmrSelect(candidates as any, 3, 0.5);
    const ids = picked.map(p=>p.id);
    expect(picked).toHaveLength(3);
    expect(ids).toContain('a');
    expect(ids).toContain('c'); // a 和 c 互补，应都被选；b 因与 a 太相似被淘汰
    expect(ids).not.toContain('b');
  });

  it('mmrSelect returns all when candidates <= k', () => {
    const candidates = [
      { id:'a', vector:[1,0], score:0.9 },
      { id:'b', vector:[0,1], score:0.8 },
    ];
    const picked = mmrSelect(candidates as any, 5, 0.5);
    expect(picked).toHaveLength(2);
  });

  it('acousticSimilarity of identical features is 1', () => {
    const f = { subBass:0.5, bass:0.4, lowMid:0.3, mid:0.2, highMid:0.1, presence:0.1, brilliance:0.05, air:0.05 };
    expect(acousticSimilarity(f, f)).toBeCloseTo(1, 3);
  });
});
