import { shuffle, weightedSample } from '../src/modules/radio/radio-diversity';

describe('radio-diversity', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('shuffle 返回相同长度的排列', () => {
    const result = shuffle(items, () => 0.5);
    expect(result).toHaveLength(items.length);
    expect([...result].sort()).toEqual([...items].sort());
  });

  it('weightedSample 返回 k 个不重复元素', () => {
    const result = weightedSample(items, 3, () => 0.3);
    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3);
  });

  it('weightedSample k 大于等于长度时返回全部（洗牌）', () => {
    const result = weightedSample(items, 10, () => 0.1);
    expect(result).toHaveLength(items.length);
    expect([...result].sort()).toEqual([...items].sort());
  });

  it('weightedSample 全零权重时退化为均匀随机（不抛错）', () => {
    const result = weightedSample(items, 2, () => 0.5, () => 0);
    expect(result).toHaveLength(2);
    expect(new Set(result).size).toBe(2);
  });

  it('weightedSample 权重高者更可能被选中（确定性 rand 下）', () => {
    const pool = [
      { id: 'hot', w: 1000 },
      { id: 'cold', w: 0 },
    ];
    // rand=0 时 r=0，必然命中首个（权重最高）元素
    const result = weightedSample(pool, 1, () => 0, (s) => s.w);
    expect(result[0].id).toBe('hot');
  });
});
