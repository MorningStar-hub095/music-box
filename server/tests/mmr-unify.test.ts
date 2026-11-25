/**
 * MMR 统一实现测试
 * 对应优化4（L2）：mmrSelectBySimilarity 与融合层公式一致
 * （MMR(d) = λ·score − (1−λ)·maxSim，λ 越大越强调准确性）
 */
import { mmrSelectBySimilarity } from '../src/modules/recommendation/preference.engine';

type Item = { id: string; score: number };

/** 相似度：同组内互相相似（1），跨组为 0 */
const groupSim = (a: Item, b: Item) => (a.id[0] === b.id[0] ? 1 : 0);

describe('mmrSelectBySimilarity（统一 MMR）', () => {
  const items: Item[] = [
    { id: 'A1', score: 0.9 },
    { id: 'A2', score: 0.85 }, // 与 A1 同组（高相似）
    { id: 'B1', score: 0.8 },
    { id: 'B2', score: 0.75 },
  ];

  it('λ=1 退化为纯相关性排序', () => {
    const out = mmrSelectBySimilarity(items, 4, 1, groupSim);
    expect(out.map((x) => x.id)).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('λ 小时多样性起作用：高分组垄断被打散', () => {
    const out = mmrSelectBySimilarity(items, 4, 0.3, groupSim);
    // 第一位仍是最高分 A1；第二位若选 A2，MMR=0.3*0.85-0.7*1=-0.445，
    // 而 B1 的 MMR=0.3*0.8-0.7*0=0.24，必然选 B1 → 组间交替
    expect(out[0].id).toBe('A1');
    expect(out[1].id).toBe('B1');
    expect(out.map((x) => x.id)).not.toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('k >= n 时返回全部 n 项且按 MMR 顺序排列（融合层依赖该语义）', () => {
    const out = mmrSelectBySimilarity(items, items.length, 0.7, groupSim);
    expect(out.length).toBe(items.length);
    expect(new Set(out.map((x) => x.id))).toEqual(new Set(items.map((x) => x.id)));
    expect(out[0].id).toBe('A1');
  });

  it('k < n 时只返回前 k 个 MMR 选择', () => {
    const out = mmrSelectBySimilarity(items, 2, 0.3, groupSim);
    expect(out.map((x) => x.id)).toEqual(['A1', 'B1']);
  });

  it('空候选返回空数组', () => {
    expect(mmrSelectBySimilarity([], 3, 0.7, groupSim)).toEqual([]);
  });
});
