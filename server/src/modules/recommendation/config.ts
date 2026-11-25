/**
 * 推荐算法配置
 *
 * P2-3（v1.4.7）：配置持久化——
 * 旧实现 PUT /config 修改仅存内存单例，重启即失。
 * 现通过 data/rec-config.json 文件持久化：
 *  - updateConfig 时写入；模块加载时读取恢复（schema 无 KV 表，避免迁移影响部署 DB 快照）
 *  - 测试进程（JEST_WORKER_ID 存在）自动跳过读写，避免副作用
 *  - 读写全程 try/catch 静默降级为内存配置（文件不可写时不影响服务）
 */

import * as fs from 'fs';
import * as path from 'path';

/** 持久化文件路径：<cwd>/data/rec-config.json（桌面打包态为 resources/server/data/） */
const PERSIST_FILE = path.join(process.cwd(), 'data', 'rec-config.json');
const IS_TEST = !!process.env.JEST_WORKER_ID;

export interface RecommendationConfig {
  /** 混合推荐权重 */
  weights: {
    rule: number;           // 规则权重
    content: number;        // 内容过滤权重
    collaborative: number;  // 协同过滤权重
    ai: number;             // AI增强权重
  };
  /** MMR多样性配置 */
  mmr: {
    lambda: number;         // 准确性权重（0-1，越大越强调准确性/相关性，越小越强调多样性；与 preference.engine 的 mmrSelectBySimilarity 语义一致）
    topN: number;           // MMR 重排候选数：只对融合分 Top-N 做多样性重排（默认 50 ≈ 5×每日推荐数），避免全量 1000 首的 O(n³) 开销
  };
  /** 缓存配置 */
  cache: {
    userProfileTTL: number;    // 用户画像缓存时间（秒）
    recommendationTTL: number; // 推荐结果缓存时间（秒）
  };
  /** 推荐数量 */
  limits: {
    dailyRecommendation: number;
    radioRecommendation: number;
    similarSong: number;
    searchRecommendation: number;
  };
  /** 行为分析窗口 */
  windows: {
    recentPlays: number;    // 最近播放窗口
    behaviorAnalysis: number; // 行为分析窗口（天）
  };
}

export const defaultConfig: RecommendationConfig = {
  weights: {
    rule: 0.3,
    content: 0.3,
    collaborative: 0.25,
    ai: 0.15,
  },
  mmr: {
    lambda: 0.7,
    topN: 50,
  },
  cache: {
    userProfileTTL: 3600,      // 1小时
    recommendationTTL: 1800,   // 30分钟
  },
  limits: {
    dailyRecommendation: 10,
    radioRecommendation: 10,
    similarSong: 5,
    searchRecommendation: 8,
  },
  windows: {
    recentPlays: 50,
    behaviorAnalysis: 30,
  },
};

let currentConfig: RecommendationConfig = { ...defaultConfig };

/** 深合并嵌套段（weights/mmr/cache/limits/windows），顶层标量直接覆盖 */
function mergeConfig(base: RecommendationConfig, partial: Partial<RecommendationConfig>): RecommendationConfig {
  return {
    ...base,
    ...partial,
    weights: { ...base.weights, ...(partial.weights || {}) },
    mmr: { ...base.mmr, ...(partial.mmr || {}) },
    cache: { ...base.cache, ...(partial.cache || {}) },
    limits: { ...base.limits, ...(partial.limits || {}) },
    windows: { ...base.windows, ...(partial.windows || {}) },
  };
}

/** 模块加载时恢复持久化配置（测试进程跳过；失败静默降级为默认值） */
function loadPersisted(): void {
  if (IS_TEST) return;
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf-8'));
      currentConfig = mergeConfig(currentConfig, raw);
    }
  } catch (e) {
    console.warn('[REC-CONFIG] 持久化配置读取失败，使用默认配置:', (e as Error).message);
  }
}
loadPersisted();

/** 持久化当前配置（失败仅告警，不影响内存配置生效） */
function persist(): void {
  if (IS_TEST) return;
  try {
    const dir = path.dirname(PERSIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[REC-CONFIG] 配置持久化写入失败:', (e as Error).message);
  }
}

export function getConfig(): RecommendationConfig {
  return currentConfig;
}

export function updateConfig(partial: Partial<RecommendationConfig>): void {
  // 旧实现（仅内存合并，重启即失）：
  // currentConfig = {
  //   ...currentConfig,
  //   ...partial,
  //   weights: { ...currentConfig.weights, ...partial.weights },
  //   mmr: { ...currentConfig.mmr, ...partial.mmr },
  //   cache: { ...currentConfig.cache, ...partial.cache },
  //   limits: { ...currentConfig.limits, ...partial.limits },
  //   windows: { ...currentConfig.windows, ...partial.windows },
  // };
  currentConfig = mergeConfig(currentConfig, partial);
  persist();
}

/** 动态权重结果 */
export interface DynamicWeights {
  rule: number;
  content: number;
  collaborative: number;
  ai: number;
}

/**
 * 基于用户数据量与反馈动态调整推荐权重。
 * - 冷启动（事件少）：协同过滤不可靠 → 降协同、升内容
 * - 负反馈多（不喜欢率高）：内容过滤更稳定 → 升内容、降 AI
 * - 最终归一化到总和为 1
 */
export function computeDynamicWeights(
  eventCount: number,
  feedbacks: { feedback: string }[],
): DynamicWeights {
  const w: DynamicWeights = { ...defaultConfig.weights };
  const dislikes = feedbacks.filter(f => f.feedback === 'dislike').length;
  const likes = feedbacks.filter(f => f.feedback === 'like').length;
  const feedbackCount = likes + dislikes;

  // 冷启动：协同过滤需要足够数据才可靠
  if (eventCount < 10) {
    w.collaborative = 0.05;
    w.content += 0.15;
  }
  // 负反馈多：内容过滤更稳定，降低不可控的 AI 权重
  if (feedbackCount > 0 && dislikes / feedbackCount > 0.5) {
    w.content += 0.05;
    w.ai = Math.max(0, w.ai - 0.05);
  }

  // 归一化
  const sum = w.rule + w.content + w.collaborative + w.ai;
  return {
    rule: w.rule / sum,
    content: w.content / sum,
    collaborative: w.collaborative / sum,
    ai: w.ai / sum,
  };
}
