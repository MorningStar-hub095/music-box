/**
 * 语义特征 multi-hot 编码单元测试
 * 对应优化1（H1）：验证语义向量的槽位语义与相似度数学意义
 */
import { SongFeatureExtractor, type SemanticVocab } from '../src/modules/recommendation/song-feature-extractor';

function makeVocab(): SemanticVocab {
  const genreIds = [10, 20, 30];
  const moodIds = [100, 200];
  const sceneIds = [1000];
  return {
    genreIds,
    moodIds,
    sceneIds,
    genreIndex: new Map(genreIds.map((id, i) => [id, i])),
    moodIndex: new Map(moodIds.map((id, i) => [id, i])),
    sceneIndex: new Map(sceneIds.map((id, i) => [id, i])),
  };
}

describe('SongFeatureExtractor.buildSemanticVector (multi-hot)', () => {
  const extractor = new SongFeatureExtractor({} as any);
  const vocab = makeVocab();

  it('维度 = 风格字典 + 情绪字典 + 场景字典 + 热度 1 维', () => {
    const song = { genres: [], moods: [], scenes: [], hotScore: 50 };
    const vec = extractor.buildSemanticVector(song, vocab);
    expect(vec.length).toBe(3 + 2 + 1 + 1);
  });

  it('相同标签的歌曲语义向量完全一致（余弦相似度 = 1）', () => {
    const a = { genres: [{ genreId: 10 }, { genreId: 20 }], moods: [{ moodId: 100 }], scenes: [], hotScore: 60 };
    const b = { genres: [{ genreId: 20 }, { genreId: 10 }], moods: [{ moodId: 100 }], scenes: [], hotScore: 60 };
    const va = extractor.buildSemanticVector(a, vocab);
    const vb = extractor.buildSemanticVector(b, vocab);
    expect(SongFeatureExtractor.cosineSimilarity(va, vb)).toBeCloseTo(1, 10);
  });

  it('不同标签的歌曲语义相似度显著低于相同标签', () => {
    const a = { genres: [{ genreId: 10 }], moods: [{ moodId: 100 }], scenes: [], hotScore: 0 };
    const b = { genres: [{ genreId: 30 }], moods: [{ moodId: 200 }], scenes: [], hotScore: 0 };
    const va = extractor.buildSemanticVector(a, vocab);
    const vb = extractor.buildSemanticVector(b, vocab);
    const sim = SongFeatureExtractor.cosineSimilarity(va, vb);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThan(0.5);
  });

  it('槽位语义正确：共享同一标签才有公共非零维度', () => {
    const a = extractor.buildSemanticVector({ genres: [{ genreId: 20 }], moods: [], scenes: [], hotScore: 0 }, vocab);
    const b = extractor.buildSemanticVector({ genres: [{ genreId: 20 }], moods: [], scenes: [], hotScore: 0 }, vocab);
    const c = extractor.buildSemanticVector({ genres: [{ genreId: 10 }], moods: [], scenes: [], hotScore: 0 }, vocab);
    const sharedIdx = vocab.genreIds.indexOf(20);
    expect(a[sharedIdx]).toBe(1);
    expect(b[sharedIdx]).toBe(1);
    expect(c[sharedIdx]).toBe(0);
  });

  it('字典外标签被忽略（不崩溃、不污染维度）', () => {
    const song = { genres: [{ genreId: 999999 }], moods: [{ moodId: 42 }], scenes: [], hotScore: 80 };
    const vec = extractor.buildSemanticVector(song, vocab);
    const hotDim = vec.length - 1;
    expect(vec.slice(0, hotDim).every((v) => v === 0)).toBe(true);
    expect(vec[hotDim]).toBeCloseTo(0.8, 10);
  });
});
