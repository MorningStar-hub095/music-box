# 推荐算法优化设计文档

## 1. 概述

全面优化音乐盒子的推荐算法，采用混合推荐（规则+内容过滤+协同过滤）+ AI 增强（LangChain Agent）的方式，提升推荐准确性、多样性和实时性。

## 2. 优化目标

### 2.1 准确性
- 动态权重：根据用户反馈（喜欢/不喜欢/跳过）实时调整推荐权重
- 行为序列分析：识别用户的听歌模式（连续播放、跳过模式）
- 上下文感知：考虑当前时间、情绪状态、场景

### 2.2 多样性
- MMR（Maximal Marginal Relevance）算法：在准确性和多样性之间取得平衡
- 风格覆盖：确保推荐结果涵盖不同风格/情绪的歌曲
- 避免重复：减少近期已推荐过的歌曲

### 2.3 实时性
- 实时上下文：根据用户当前状态动态调整推荐
- 增量更新：用户行为实时反馈到推荐模型
- 会话感知：在电台会话中根据对话内容调整推荐

## 3. 技术架构

```
数据层
├─ 用户行为数据（ListeningEvent）
├─ 用户画像（UserPreferenceMemory）
├─ 歌曲特征（SongFeature）
├─ 情绪DNA（emotionDna）
└─ 社交DNA（SocialDna）
    ↓
预处理层
├─ 用户画像构建（UserProfileBuilder）
├─ 歌曲特征提取（SongFeatureExtractor）
└─ 行为序列分析（BehaviorAnalyzer）
    ↓
推荐引擎层
├─ 规则引擎（RuleEngine）— 权重评分、过滤规则
├─ 内容过滤（ContentFilter）— 歌曲特征相似度
├─ 协同过滤（CollaborativeFilter）— 用户行为相似度
└─ AI 增强（AIEnhancer）— LangChain Agent 分析
    ↓
融合层（RecommendationFusion）
├─ 加权排序
├─ MMR 多样性保障
├─ 去重和过滤
└─ 结果缓存
    ↓
输出层
├─ 每日推荐（DailyRecommendationGenerator）
├─ AI 电台（RadioAgent）
├─ 搜索推荐（SearchRecommender）
└─ 相似歌曲推荐（SimilarSongRecommender）
```

## 4. 核心算法

### 4.1 用户画像构建
```typescript
interface UserProfile {
  userId: number;
  // 音乐偏好
  favoriteGenres: { genre: string; weight: number }[];
  favoriteArtists: { artist: string; weight: number }[];
  favoriteMoods: { mood: string; weight: number }[];
  // 行为特征
  avgListenDuration: number;  // 平均听歌时长
  skipRate: number;           // 跳过率
  repeatRate: number;         // 重复播放率
  // 时段偏好
  timePreferences: { hour: number; genre: string; mood: string }[];
  // 情绪状态
  currentMood: string;
  moodHistory: { mood: string; timestamp: Date }[];
}
```

### 4.2 歌曲特征向量
```typescript
interface SongFeatureVector {
  songId: string;
  // 声学特征（已有）
  acousticFeatures: number[];  // [subBass, bass, lowMid, mid, highMid, presence, brilliance, air]
  bpm: number;
  energy: number;
  // 语义特征
  genreVector: number[];       // 风格向量
  moodVector: number[];        // 情绪向量
  sceneVector: number[];       // 场景向量
  // 综合特征
  combinedVector: number[];    // 拼接后的综合向量
}
```

### 4.3 混合推荐算法
```
最终分数 = α × 规则分数 + β × 内容过滤分数 + γ × 协同过滤分数 + δ × AI增强分数

其中：
- α = 0.3（规则权重）
- β = 0.3（内容过滤权重）
- γ = 0.2（协同过滤权重）
- δ = 0.2（AI增强权重）
- α + β + γ + δ = 1
```

### 4.4 MMR 多样性算法
```
MMR(d) = λ × Sim(d, query) - (1-λ) × max{Sim(d, dj)} for dj in Selected

其中：
- λ = 0.7（准确性权重）
- Sim(d, query) = 歌曲与用户偏好的相似度
- Sim(d, dj) = 歌曲与已选歌曲的相似度
```

## 5. 推荐入口优化

### 5.1 每日推荐
- 每日凌晨3:00自动生成
- 结合用户长期偏好和近期行为
- 考虑当前季节、天气（可选）
- 推荐10首歌曲，附推荐理由

### 5.2 AI 电台
- 实时对话推荐
- 结合会话上下文和用户画像
- 支持多轮对话调整推荐
- 推荐5-10首歌曲

### 5.3 搜索推荐
- 关键词扩展（同义词、相关词）
- 搜索结果排序优化
- 相关歌曲推荐

### 5.4 相似歌曲推荐
- 基于歌曲特征向量相似度
- 考虑用户对原歌曲的反馈
- 推荐3-5首相似歌曲

## 6. 配置参数

```typescript
interface RecommendationConfig {
  // 权重配置
  weights: {
    rule: number;           // 规则权重，默认0.3
    content: number;        // 内容过滤权重，默认0.3
    collaborative: number;  // 协同过滤权重，默认0.2
    ai: number;             // AI增强权重，默认0.2
  };
  // MMR配置
  mmr: {
    lambda: number;         // 准确性权重，默认0.7
    diversityThreshold: number; // 多样性阈值，默认0.3
  };
  // 缓存配置
  cache: {
    userProfileTTL: number;    // 用户画像缓存时间，默认1小时
    recommendationTTL: number; // 推荐结果缓存时间，默认30分钟
  };
  // 推荐数量
  limits: {
    dailyRecommendation: number; // 每日推荐数量，默认10
    radioRecommendation: number; // 电台推荐数量，默认10
    similarSong: number;         // 相似歌曲数量，默认5
  };
}
```

## 7. 性能优化

- 用户画像预计算（每日更新）
- 歌曲特征向量预计算（离线处理）
- 推荐结果缓存（Redis/内存）
- 增量更新（仅更新变化的部分）
