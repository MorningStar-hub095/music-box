// 偏好分析引擎：声学质心计算 + MMR 多样性选择
// 纯逻辑模块，不依赖 Prisma，便于单测

export type Feat = {
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  presence: number;
  brilliance: number;
  air: number;
};

const FEAT_KEYS: (keyof Feat)[] = [
  'subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air',
];

/**
 * 计算带权重的事件特征向量的加权质心。
 * 高权重（高沉浸度）事件对质心贡献更大。
 */
export function computeAcousticCentroid(
  events: { features: Feat; weight: number }[]
): Feat {
  const totalW = events.reduce((s, e) => s + e.weight, 0) || 1;
  const acc: Feat = {
    subBass: 0, bass: 0, lowMid: 0, mid: 0,
    highMid: 0, presence: 0, brilliance: 0, air: 0,
  };
  for (const e of events) {
    for (const k of FEAT_KEYS) {
      acc[k] += e.features[k] * e.weight;
    }
  }
  for (const k of FEAT_KEYS) {
    acc[k] /= totalW;
  }
  return acc;
}

/** 余弦相似度，空向量返回 0（安全） */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function featToVector(f: Feat): number[] {
  return [f.subBass, f.bass, f.lowMid, f.mid, f.highMid, f.presence, f.brilliance, f.air];
}

/** 两个 Feat 的声学相似度（余弦） */
export function acousticSimilarity(a: Feat, b: Feat): number {
  return cosine(featToVector(a), featToVector(b));
}

/**
 * MMR（Maximal Marginal Relevance）通用选择：在相关性与多样性间权衡。
 *
 * 公式：MMR(d) = λ·score(d) − (1−λ)·max_{s∈已选} sim(d, s)
 *  - λ = 1   退化为纯相关性排序（准确性优先）
 *  - λ 越小  越强调与已选结果的差异性（多样性优先）
 *
 * 相似度由调用方通过 similarity 回调注入（融合层用类别 Jaccard，
 * 向量场景可用余弦），保证全项目只有这一处 MMR 实现。
 */
export function mmrSelectBySimilarity<T extends { score: number }>(
  candidates: T[],
  k: number,
  lambda: number,
  similarity: (a: T, b: T) => number
): T[] {
  // 注意：不在此处对 k >= n 提前返回——调用方（推荐融合层）依赖本函数
  // 输出「按 MMR 逐个选择的全序」，提前返回会丢失多样性排序语义
  if (candidates.length === 0) return [];
  const picked: T[] = [];
  const remaining = [...candidates];
  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const maxSim = picked.length === 0 ? 0 : Math.max(...picked.map((p) => similarity(c, p)));
      const mmr = lambda * c.score - (1 - lambda) * maxSim;
      if (mmr > bestVal) {
        bestVal = mmr;
        bestIdx = i;
      }
    }
    picked.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return picked;
}

/**
 * 向量版 MMR 选择：在相关性与多样性间权衡。
 * 每步选 argmax(score(c) - lambda * max_{s in 已选} sim(c, s))。
 * 注意：此参数化与 mmrSelectBySimilarity 不同——这里 lambda 是「多样性惩罚系数」，
 * lambda 越大越强调多样性；供纯向量场景与单测使用。
 */
export function mmrSelect<T extends { id: string; vector: number[]; score: number }>(
  candidates: T[],
  k: number,
  lambda: number
): T[] {
  if (candidates.length <= k) return [...candidates];
  const picked: T[] = [];
  const remaining = [...candidates];
  while (picked.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const maxSim = picked.length === 0
        ? 0
        : Math.max(...picked.map((p) => cosine(c.vector, p.vector)));
      const mmr = c.score - lambda * maxSim;
      if (mmr > bestVal) {
        bestVal = mmr;
        bestIdx = i;
      }
    }
    picked.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return picked;
}
