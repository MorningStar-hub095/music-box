# 推荐算法技术文档

## 1. 架构概述

推荐系统采用混合推荐架构，融合四种推荐算法：

```
用户行为数据
    ↓
数据预处理层
├─ UserProfileBuilder（用户画像）
├─ SongFeatureExtractor（歌曲特征）
└─ BehaviorAnalyzer（行为分析）
    ↓
推荐引擎层
├─ RuleEngine（规则引擎）— 权重0.3
├─ ContentFilter（内容过滤）— 权重0.3
├─ CollaborativeFilter（协同过滤）— 权重0.2
└─ AIEnhancer（AI增强）— 权重0.2
    ↓
RecommendationFusion（融合层）
├─ 加权排序
├─ MMR多样性选择
└─ AI推荐理由生成
    ↓
输出
├─ 每日推荐（/api/recommendation/daily）
├─ 相似歌曲（/api/recommendation/similar/:songId）
├─ 用户画像（/api/recommendation/profile）
└─ 行为洞察（/api/recommendation/behavior）
```

## 2. 核心模块

### 2.1 UserProfileBuilder（用户画像构建器）

**文件**: `server/src/modules/recommendation/user-profile-builder.ts`

构建用户画像，包含：
- 音乐偏好（风格、艺术家、情绪）
- 行为特征（平均听歌时长、跳过率、重复播放率）
- 时段偏好（每个小时的风格/情绪偏好）
- 当前情绪状态

**缓存**: 1小时TTL，键 `user:profile:{userId}`

### 2.2 SongFeatureExtractor（歌曲特征提取器）

**文件**: `server/src/modules/recommendation/song-feature-extractor.ts`

提取歌曲特征向量：
- 声学特征（8维）：subBass, bass, lowMid, mid, highMid, presence, brilliance, air
- 语义特征（multi-hot）：风格字典 + 情绪字典 + 场景字典（维度与全量标签表一一对应，v1.2.0 起）
- 综合特征：声学 + 语义拼接

标签字典按标签表 id 升序构建，24h 内存缓存；歌曲特征缓存键为 `song:feature:v2:{songId}`（24h TTL）。

### 2.3 BehaviorAnalyzer（行为分析器）

**文件**: `server/src/modules/recommendation/behavior-analyzer.ts`

分析用户行为模式：
- 最近播放趋势（exploring/repeating/balanced）
- 当前时段偏好
- 连续播放模式
- 活跃度评分

### 2.4 RuleEngine（规则引擎）

**文件**: `server/src/modules/recommendation/rule-engine.ts`

评分维度：
| 维度 | 权重 | 说明 |
|------|------|------|
| 风格匹配 | 0.3 | 用户偏好风格与歌曲风格的匹配度 |
| 情绪匹配 | 0.25 | 用户偏好情绪与歌曲情绪的匹配度 |
| 热度分数 | 0.15 | 歌曲热度归一化分数 |
| 时段适配 | 0.15 | 当前时段与歌曲风格的适配度 |
| 新鲜度 | 0.1 | 新歌加分（30天内+1.0，90天+0.7，365天+0.4） |
| 行为趋势 | 0.05 | 探索模式下新歌加分，重复模式下熟悉歌加分 |

### 2.5 ContentFilter（内容过滤器）

**文件**: `server/src/modules/recommendation/content-filter.ts`

基于歌曲特征向量的余弦相似度推荐：
1. 获取用户最近播放歌曲的特征向量
2. 计算特征质心
3. 计算候选歌曲与质心的余弦相似度

### 2.6 CollaborativeFilter（协同过滤器）

**文件**: `server/src/modules/recommendation/collaborative-filter.ts`

基于用户行为相似度推荐：
1. 找到与当前用户相似的用户（Jaccard相似度）
2. 获取相似用户的播放记录
3. 加权推荐相似用户喜欢的歌曲

### 2.7 AIEnhancer（AI增强器）

**文件**: `server/src/modules/recommendation/ai-enhancer.ts`

确定性启发式评分（非实时 LLM 调用，避免延迟）：
- 风格命中率 × 0.5 + 情绪命中率 × 0.3
- 行为趋势加成（exploring +0.1，repeating +0.05）
- 推荐理由为模板化生成（风格匹配/情绪匹配/时段/趋势）

### 2.8 RecommendationFusion（推荐融合器）

**文件**: `server/src/modules/recommendation/recommendation-fusion.ts`

融合算法（v1.2.1+ 默认权重）：
```
finalScore = 0.3 × ruleScore + 0.3 × contentScore + 0.25 × collabScore + 0.15 × aiScore
```

MMR多样性选择（统一实现在 preference.engine.mmrSelectBySimilarity）：
```
MMR(d) = λ × score(d) - (1-λ) × max{sim(d, dj)} for dj in Selected
```
默认 λ = 0.7（λ 越大越强调准确性）

## 3. API 接口

### 3.1 每日推荐
```
GET /api/recommendation/daily
Authorization: Bearer <token>
```

### 3.2 推荐反馈
```
POST /api/recommendation/feedback
Authorization: Bearer <token>
Body: { songId: string, feedback: 'like'|'dislike'|'favorite', weight?: number }
```

### 3.3 相似歌曲推荐
```
GET /api/recommendation/similar/:songId?limit=5
```

### 3.4 用户画像
```
GET /api/recommendation/profile
Authorization: Bearer <token>
```

### 3.5 行为洞察
```
GET /api/recommendation/behavior
Authorization: Bearer <token>
```

### 3.6 更新配置（仅 admin/super_admin）
```
PUT /api/recommendation/config
Authorization: Bearer <token>
Body: { weights?: { rule, content, collaborative, ai }, mmr?: { lambda }, ... }
```

### 3.7 版本信息（免登录）
```
GET /api/version
```
返回 `{ version, changelog }`；桌面版主进程启动时据此做更新提示（v1.2.0 起新增）。

## 4. 配置参数

```typescript
interface RecommendationConfig {
  weights: {
    rule: number;           // 默认 0.3
    content: number;        // 默认 0.3
    collaborative: number;  // 默认 0.2
    ai: number;             // 默认 0.2
  };
  mmr: {
    lambda: number;         // 默认 0.7
  };
  cache: {
    userProfileTTL: number;    // 默认 3600秒
    recommendationTTL: number; // 默认 1800秒
  };
  limits: {
    dailyRecommendation: number; // 默认 10
    similarSong: number;         // 默认 5
  };
  windows: {
    recentPlays: number;       // 默认 50
    behaviorAnalysis: number;  // 默认 30天
  };
}
```

## 5. 缓存策略

| 数据 | 缓存键 | TTL |
|------|--------|-----|
| 用户画像 | `user:profile:{userId}` | 1小时 |
| 歌曲特征 | `song:feature:v2:{songId}`（v1.2.0 起编码升级） | 24小时 |
| 候选池 | `rec:pool:v1` | 5分钟 |
| 相似歌曲 | `rec:similar:{songId}:{limit}` | 30分钟 |

## 6. 性能优化

- 候选池缓存（跨用户共享）
- 用户画像预计算
- 歌曲特征向量预计算
- 内容过滤批量特征提取（v1.2.2 起，单次批量查询替代逐首 extract 的 N+1）
