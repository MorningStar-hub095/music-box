# 全自动 AI 电台系统设计文档

> 日期：2026-08-17
> 状态：已确认，待实现

## 1. 概述

将现有「对话式 AI 电台」重构为「全自动 AI 电台」：用户点击播放器控制栏的「电台」按钮后，系统立即生成并播放个性化歌单，播完自动续播（无限连播），全程无需人工干预。与现有对话式电台并存，互不影响。

核心矛盾与解法：用户要求「点击后立即播放」，但纯 LLM Agent 存在 30~110 秒延迟。解法为**秒开 + 后台 AI 优化**——首屏用规则推荐引擎秒级出歌单立即播放，同时后台异步调用 LLM 生成更个性化歌单，完成后无缝衔接。

## 2. 需求清单（已确认）

| 维度 | 决策 |
|------|------|
| 核心生成方式 | 纯 LLM Agent（复用现有 `chatWithAgent`，优化为自动触发） |
| LLM 未配置/失败 | 规则兜底（复用 `RecommendationService.generateForUser`，保证始终可播） |
| 歌曲来源 | 本地曲库为主，`searchExternal` 外部搜索补充 |
| 播放控制 | 无限连播（播完自动重新生成新歌单继续） |
| UI 入口 | 复用播放器控制栏现有「电台」按钮 |
| 推荐依据 | 个性化数据（听歌历史 + 情绪DNA + 社交DNA + 每日推荐） |
| 秒开策略 | 规则推荐秒开 + 后台 LLM 异步优化 |
| 连续生成 | 共享会话上下文（越播越懂你） |
| 单曲失败 | 自动跳到下一首 |
| 中途交互 | 完全自动，无需任何人工干预 |
| 与对话电台 | 并存 |

## 3. 核心流程

```
点击「电台」按钮
   ↓  POST /api/radio/stream/start
后端：创建/复用会话 → 立即调用 RecommendationService.generateForUser(userId)
   ↓  立即返回规则歌单（<1s）
前端：立即开始自动连播
   ↓  后端同时后台异步（fire-and-forget）调用 LLM Agent（共享会话上下文）
   ↓  LLM 完成
前端：轮询 GET /api/radio/stream/:sessionId/next 获取 LLM 优化歌单，追加到队列尾部
   ↓  队列剩余 ≤ 3 首时预取下一批
   →  无限连播（单曲失败自动跳过）
```

## 4. 技术架构

```
前端（React）
├─ 「电台」按钮 → 启动自动电台（复用现有按钮）
├─ 自动电台状态机（start → playing → prefetch → playing …）
├─ 播放队列复用 extraTracks + select / peekNext
└─ 对话电台面板保留为独立入口
    ↓
后端 API（Express）
├─ POST /api/radio/stream/start    — 启动自动电台（秒开规则歌单 + 后台触发 LLM）
├─ GET  /api/radio/stream/:id/next — 获取下一批歌单（LLM 优先，规则兜底）
└─ POST /api/radio/stream/:id/feedback — 上报跳过/完成（供个性化与去重）
    ↓
规则推荐引擎（秒开）
└─ RecommendationService.generateForUser（候选池缓存 + 内容过滤 + MMR）
    ↓
LLM Agent（后台异步）
└─ chatWithAgent（含内部 fallbackRecommend 兜底）
```

## 5. 后端改动

### 5.1 新增 `radio-stream.service.ts`

封装自动电台状态机，内存维护流式状态（无需新增数据库表，重启后重新开始即可）。

流式状态（内存 Map，key 为 sessionId）：
- `cursor`：已返回歌单的游标
- `playedSongIds`：已播放/已返回的歌曲集合（用于去重与排除）
- `llmPending`：后台 LLM 是否在跑
- `llmResultSongs`：LLM 已生成的待返回歌单

### 5.2 新增端点（`radio.controller.ts` 中注册）

**`POST /api/radio/stream/start`**
1. 校验用户
2. 创建 `RadioSession`（复用现有模型，作为共享上下文）
3. 调用 `RecommendationService.generateForUser(userId)` 生成规则歌单（秒开）
4. 记录已返回歌曲到流式状态
5. 后台 fire-and-forget：构造自动推荐 prompt，调用 `chatWithAgent` 生成 LLM 歌单，写入流式状态
6. 立即返回规则歌单 + sessionId

**`GET /api/radio/stream/:sessionId/next`**
1. 校验会话归属
2. 若 LLM 结果已就绪 → 返回 LLM 歌单，并后台触发下一轮 LLM
3. 否则 → 调用 `RecommendationService.generateForUser` 规则兜底，排除已播歌曲
4. 更新游标与已播集合，返回歌单

**`POST /api/radio/stream/:sessionId/feedback`**
- 记录 `{ songId, type: 'skip' | 'complete' }`，加入排除集，供后续生成参考

### 5.3 复用现有能力（不重写）

- 规则秒开：[RecommendationService.generateForUser](../../server/src/modules/recommendation/recommendation.service.ts) — 已有候选池缓存、内容过滤（排除播客/白噪音等）、MMR 多样性、热门兜底
- LLM 路径：[chatWithAgent](../../server/src/modules/radio/agent.ts) — 已有 `fallbackRecommend` 规则兜底
- 外部搜索：[searchExternal](../../server/src/modules/radio/tools/searchExternal.ts) — 已有 12s 超时与轻量入库
- 会话/历史：复用 `RadioSession` / `RadioMessage`（共享上下文 + 记录生成历史）

## 6. 前端改动

### 6.1 「电台」按钮行为

- 点击「电台」按钮 → 改为**启动自动电台**（调用 `stream/start`），不再仅打开对话面板
- 对话面板改为独立入口保留（如面板内「对话模式」或长按/图标切换），保证并存

### 6.2 自动电台状态机

```
idle → starting → playing → (queueLow) → fetching → playing → …
```
- `starting`：调用 `start`，拿到首批歌单
- `playing`：复用现有 `extraTracks` + `select` 播放，`onEnded` 自动切下一首
- `fetching`：`peekNext` 剩余 ≤ 3 首时调用 `next` 补充队列尾部

### 6.3 复用现有能力

- 播放队列：[extraTracks + select](file:///d:/music_box/web/src/App.tsx#L648-L661)（复用现有 `onPlayPlaylist` 逻辑）
- 自动连播：现有 `onEnded` 自动切歌机制
- 单曲失败自动跳过：现有 `autoSkipCountdown` / `setOnEnded` 错误处理链路

## 7. 错误处理

- LLM 未配置 / 调用失败 / 超时 → 规则兜底（始终可播）
- 单曲 URL 失效 / 不可播 → 自动跳到下一首，连续多次失败才提示
- 外部搜索超时 → 已有 12s 超时保护，降级本地曲库
- 规则推荐也无可用歌 → 返回空歌单并提示「暂无可用歌曲」

## 8. 性能

- 秒开：规则推荐同步返回（候选池已内存缓存，毫秒级）
- LLM 异步：fire-and-forget，不阻塞首屏响应
- 队列预取：剩余 ≤ 3 首时提前请求下一批，避免播完卡顿
- 去重：排除已播/已返回歌曲，避免重复推荐

## 9. 与现有系统的关系

- **对话式电台**：完整保留，独立入口，功能不变
- **推荐引擎**：完全复用，不改动推荐算法
- **数据模型**：复用 `RadioSession` / `RadioMessage`，不新增数据库表
- **播放器**：复用 `extraTracks` / `select` / `onEnded`，不改动播放器核心

## 10. 测试计划

- 后端：`stream/start` 秒开返回歌单；`next` 轮询返回；LLM 未配置时规则兜底
- 前端：点击「电台」立即播放；播完自动续播；单曲失败自动跳过
- 集成：与对话电台并存、互不干扰

## 11. 实现约束（来自项目规范）

- 严禁删除原有代码，通过注释代替删除效果，修改部分需添加普通注释
- 遵循现有代码风格与模块结构
