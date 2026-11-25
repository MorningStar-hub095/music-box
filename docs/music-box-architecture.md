# 音乐盒子（Music Box）项目架构文档

> 版本：v1.1.0 ｜ 技术栈：React + Vite + TypeScript / Node.js + Express + Prisma / Python 爬虫 / Taro 小程序
> 本文档基于源码实际结构梳理，覆盖前后端分层、数据模型、音频 URL 生命周期、个性化推荐、AI 电台、缓存、安全与部署等核心机制。

---

## 1. 项目概述

音乐盒子是一个「Web 优先、多端覆盖」的音乐播放与个性化推荐平台，具备以下能力：

- **音乐播放**：本地缓存 + 实时代理的音频播放，支持 Range 请求拖拽、歌词、频谱可视化、黑胶封面、星云场景。
- **曲库管理**：多平台爬虫（网易云 / QQ / 酷狗）、手动添加、本地导入、分类标签体系（流派 / 语言 / 场景 / 心情 / 年代 / 标签）。
- **个性化推荐**：融合规则、内容、协同过滤与 LLM 多路算法的推荐引擎，产出「每日推荐」。
- **用户画像体系**：情绪 DNA（8 维声学向量）、社交 DNA（12 维暗号）、基因图谱（PCA 坐标）、时间胶囊 / 时光机。
- **AI 电台**：基于 LangChain / LangGraph 的 ReAct Agent 与单次 LLM 选歌两种模式，实现对话式与全自动推荐。
- **评论系统**：歌曲时间点评论、点赞、举报。
- **管理后台**：独立 admin 子应用（歌曲 / 用户 / 爬虫 / 统计 / 歌单管理）。

系统由多个可独立运行的子应用组成：`web`（主播放器）、`web/admin`（管理后台）、`web/browse`（浏览端）、`mini-app`（Taro 小程序），共享 `server`（API 服务）与 `shared`（共享前端逻辑）。

---

## 2. 技术栈总览

| 层次 | 技术选型 | 说明 |
|---|---|---|
| 主前端 | React 18 + Vite 5 + TypeScript | SPA，Hooks 驱动 |
| 3D / 可视化 | three.js 0.169 + @react-three/fiber 8 + @react-three/drei 9 | 星云背景、频谱 |
| 前端测试 | Vitest + jsdom + Testing Library | |
| 后端 | Node.js + Express 4 + TypeScript | REST API，模块化路由 |
| ORM | Prisma 5.22 + PostgreSQL | 声明式数据模型 |
| 认证 | JWT（jsonwebtoken）+ bcryptjs | 无状态鉴权 |
| AI / LLM | LangChain + LangGraph + @langchain/openai | Ollama / OpenAI / 兼容提供商 |
| 爬虫 | Python（requests 等） | 由 Node 通过子进程调度 |
| 缓存 | 进程内 Map（已替代 Redis） | 见第 8 章 |
| 小程序 | Taro + React | 多端（H5 / 微信） |
| 部署 | Docker + PM2（ecosystem.config.js）+ nginx | |

---

## 3. 总体架构

```
┌────────────────────────────────────────────────────────────────┐
│                        客户端层                                  │
│  web (React SPA)   web/admin   web/browse   mini-app (Taro)     │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTP (REST + 音频流)
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                        网关 / 反向代理                           │
│              nginx（生产） / 开发环境直连                         │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                     API 服务 (Express, 49200)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │ 中间件层  │ │ 路由层    │ │ 控制器层  │ │ 服务层 (业务逻辑)   │ │
│  │ helmet   │ │ modules/ │ │ controller│ │ service / agent    │ │
│  │ cors     │ │ 30+ 模块 │ │ (校验/编排)│ │ 推荐/DNA/电台/URL   │ │
│  │ rateLimit│ └──────────┘ └──────────┘ └─────────┬──────────┘ │
│  └──────────┘                                      │            │
│  ┌────────────────────────────────────────────────┴──────────┐ │
│  │  基础设施层                                                  │ │
│  │  Prisma(PostgreSQL)  ·  内存缓存Map  ·  Python子进程执行器   │ │
│  │  本地音频缓存(磁盘)  ·  内存LRU音频缓存                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────┬──────────────────────────────┬────────────────────┘
               ▼                              ▼
      ┌────────────────┐            ┌─────────────────────┐
      │  PostgreSQL     │            │  Python 爬虫 / 音频   │
      │  (业务数据)      │            │  网易云/QQ/酷狗 CDN    │
      └────────────────┘            └─────────────────────┘
```

**关键分层约定**：`routes`（路由与中间件挂载）→ `controller`（参数校验、响应编排）→ `service`（纯业务逻辑）→ `prisma`（数据访问）。该模式贯穿所有业务模块。

---

## 4. 前端架构

### 4.1 主应用（web）

- 入口 [main.tsx](file:///d:/music_box/web/src/main.tsx) 挂载根组件 [App.tsx](file:///d:/music_box/web/src/App.tsx)。
- `App.tsx` 采用「薄认证壳 + 重播放器主体」拆分：`App` 仅处理登录态检查，通过后渲染 `MainApp`，避免播放器 Hooks 崩溃影响鉴权流程。
- 认证通过 [api.ts](file:///d:/music_box/web/src/services/api.ts) 的 `authApi` 完成（token 存储、`getMe` 校验、超时保护）。

### 4.2 核心 Hooks（`web/src/hooks/`）

| Hook | 职责 |
|---|---|
| `useAudioPlayer` | 音频元素生命周期、播放/暂停/seek、自动播放策略、URL 刷新、错误自动跳过 |
| `useAudioAnalyser` | Web Audio API 分析器（getFrequencyData / getFeatures） |
| `useLyrics` | LRC 解析与当前歌词定位 |
| `useListeningTracker` | 播放/完成/跳过/收藏事件上报 |
| `usePlaylist` / `usePlaylistManager` | 播放队列、播放模式、收藏、本地存储同步 |
| `useVisualizer` | 频谱 canvas 绘制 |
| `useStorage` | 本地持久化封装 |
| `useVoiceInput` | 语音输入 |

### 4.3 可视化与 3D

- `sonic/SonicBackground`：基于 three.js 的随音乐律动背景，通过 `getFeatures` 驱动。
- `components/NebulaLyrics`：星云散点歌词全屏覆盖。
- `components/AlbumCover` / `VinylRecord`：封面与黑胶展示。
- `sonic/shaders.ts`、`sonic/themes.ts`：着色器与主题预设。

### 4.4 共享代码（`shared/`）

跨端复用的纯逻辑，不含 React DOM 依赖：`useSearch`、`useTheme`、`useLocalImport`、`theme-presets`、`design-tokens`、`parseLrc`、`pinyin`、`trackValidator`、`types`。

### 4.5 子应用

- `web/admin`：独立 Vite 应用，页面含 SongsPage、UsersPage、PlaylistsPage、CrawlerPage、StatsPage、GenresPage、SongDetailPage、LoginPage，通过 `services/api.ts` 调用后端。
- `web/browse`：轻量浏览端。
- `mini-app`：Taro 多端小程序，结构复用主应用的 hooks 与主题体系（`useAudioPlayer`、`useTheme`、`usePlaylist` 等）。

---

## 5. 后端架构

### 5.1 入口与中间件（`server/src/index.ts`）

启动流程：端口可用性检查 → 挂载中间件 → 注册 30+ 模块路由 → 静态文件服务（承载 web 构建产物）→ 优雅关闭。

中间件链：`helmet`（关闭跨域隔离策略）→ `cors`（白名单 + credentials）→ `express.json` → 全局/认证/搜索/音频刷新四级 `express-rate-limit` → 请求日志 → 各业务路由。

稳定性保障：`unhandledRejection` / `uncaughtException` 捕获、内存监控（>512MB 触发 GC）、`SIGTERM`/`SIGINT` 优雅关闭（停调度器 → 关 HTTP → 断 DB → 兜底退出）。

### 5.2 模块列表（`server/src/modules/`）

| 模块 | 职责 |
|---|---|
| `auth` | 注册/登录/JWT 签发与校验 |
| `songs` / `genres` / `languages` / `scenes` / `moods` / `decades` / `tags` | 曲库与分类标签 CRUD、归档 |
| `search` | 搜索（含拼音、模糊匹配、热度） |
| `stats` / `audit` / `users` | 统计、操作审计、用户管理 |
| `playlists` | 歌单（含热门 100、分类歌单刷新） |
| `crawler` | 多平台爬虫任务 |
| `content` / `sync` | 内容管理与数据同步 |
| `listening` | 聆听事件采集 |
| `recommendation` | 融合推荐引擎 |
| `emotion-dna` / `social-dna` / `genome` | 用户画像三件套 |
| `capsules` / `time-machine` | 时间胶囊 / 时光机 |
| `comments` | 评论 / 点赞 / 举报 |
| `radio` | AI 电台（LangGraph Agent + 自动电台） |
| `url-manager` | 音频 URL 生命周期管理 |
| `audio-cache` | 本地音频缓存与流式代理 |

### 5.3 基础设施（`server/src/lib/`）

- `prisma.ts`：Prisma 客户端单例。
- `redis.ts`：进程内 Map 实现的缓存（兼容 ioredis 接口）。
- `python-runner.ts`：Python 子进程统一执行器（并发信号量 + windowsHide + 超时）。
- `logger.ts`：日志。
- `llm-provider.ts` / `llm/`：LLM 提供商抽象层。

---

## 6. 数据模型（Prisma）

核心模型（PostgreSQL，表名/字段用 snake_case 映射）：

| 模型 | 说明 | 关键字段 |
|---|---|---|
| `Song` | 歌曲主表 | `audioUrl`、`audioUrlMp3`、`playable`、`hotScore`、URL 管理扩展字段（`urlExpiresAt`、`urlRefreshCount`、`urlFailureCount` 等） |
| `Genre` / `Language` / `Scene` / `Mood` / `Decade` / `Tag` | 六类分类维度 | 层级关系（parentId） |
| `SongGenre` 等 5 个连接表 | Song 与分类的多对多 | 复合主键 + 级联删除 |
| `User` | 用户 | `emotionDna`(Json)、`socialDna`、角色/状态 |
| `Playlist` / `PlaylistSong` | 歌单 | 排序、去重 |
| `ListeningEvent` | 聆听事件底座 | 8 维声学特征 + `engagementScore` + `heightsSeries` |
| `SongFeature` | 歌曲声学特征向量 | 8 维 + `bpm`、`energy`、`genomeX/Y`（PCA 坐标） |
| `DailyRecommendation` / `RecommendationFeedback` | 每日推荐与反馈 | `rank`、`reason`、`feedback` |
| `Capsule` | 时间胶囊 | `snapshotJson`、`lockedUntil`、`revealedAt` |
| `SocialDna` | 社交 DNA | 12 维 `vectorJson` + `cipherSvg` |
| `Comment` / `CommentLike` / `CommentReport` | 评论体系 | 时间点评论、点赞、举报 |
| `RadioSession` / `RadioMessage` | AI 电台会话 | 消息与歌单 Json |
| `UserPreferenceMemory` | 用户偏好记忆 | key/value/score |
| `UrlRefreshLog` / `UrlAlert` / `AudioErrorLog` | URL 管理可观测性 | 刷新日志、预警、播放错误 |
| `CrawlLog` | 爬虫任务日志 | 状态、计数 |
| `OperationLog` | 操作审计 | 变更前后值 |

枚举：`UserRole`（super_admin/admin/editor/user）、`UserStatus`、`CrawlStatus`、`DataSource`。

索引设计覆盖了搜索（`title`、`artist`、`(title,artist,album)`）、播放热度（`(playable,hotScore)`）、URL 健康（`urlExpiresAt`、`urlCheckedAt`、`(playable,urlCheckedAt)`）等高频查询路径。

---

## 7. 音频播放与 URL 生命周期（核心机制）

### 7.1 统一代理入口

前端**永远**只请求 `/api/audio/:trackId`（不再直接依赖平台临时 URL）。[audio-cache.service.ts](file:///d:/music_box/server/src/modules/audio-cache/audio-cache.service.ts) 按以下优先级返回：

1. **内存 LRU 缓存**（热歌秒播，上限 100MB / 40 首）
2. **本地磁盘缓存**（`data/audio-cache/{trackId}.mp3`，永久有效）
3. **实时代理**：获取平台 URL → 流式转发给客户端 + 后台落盘（PassThrough 分流）

支持 HTTP `Range` 请求（拖拽进度条），缓存命中后设置 `X-Audio-Source` 标识来源。

### 7.2 URL 生命周期管理（`url-manager`）

`url-manager` 是音频可用性的核心保障模块，围绕「一首歌的 URL 从有效到失效、再到刷新恢复」的完整生命周期，实现闭环自动化管理。核心类：[url-manager.service.ts](file:///d:/music_box/server/src/modules/url-manager/url-manager.service.ts)。

#### 7.2.1 URL 状态机

一首歌的 `playable` 与 URL 状态在以下状态间迁移：

```
                 ┌─────────────┐
                 │  NO_URL     │  audioUrl 为空 / 从未获取
                 └──────┬──────┘
                        │ 触发刷新 (refreshUrl)
                        ▼
  ┌───────────┐  ┌──────────────┐  刷新成功   ┌──────────────┐
  │  CACHED   │◄─│  PLAYABLE    │────────────►│  REFRESHING  │
  │ 内存缓存命中│  │ URL 有效可播  │             │  刷新进行中   │
  └───────────┘  └──────┬───────┘             └──────┬───────┘
                        │ urlExpiresAt 到期           │
                        ▼                            │ 连续失败 ≥ 2 且
                 ┌──────────────┐                     │ 本地无缓存
                 │   EXPIRED    │──触发刷新──────────►│
                 │ DB 标记已过期 │                     ▼
                 └──────────────┘              ┌──────────────┐
                                               │  UNPLAYABLE  │
                                               │ playable=false│
                                               └──────┬───────┘
                                                      │ 定时重试(4h 后)
                                                      ▼
                                               ┌──────────────┐
                                               │  REFRESHING  │
                                               └──────────────┘
```

状态迁移触发条件：

| 迁移 | 触发条件 |
|---|---|
| NO_URL → REFRESHING | `audioUrl` 为空，`getUrl` 触发刷新 |
| PLAYABLE → CACHED | 内存缓存命中（`url:cache:{id}` 未过期） |
| PLAYABLE → EXPIRED | `urlExpiresAt < now`（DB 判定过期） |
| PLAYABLE → REFRESHING | HEAD 校验失效，或 `shouldRefreshSoon`（临近过期） |
| REFRESHING → PLAYABLE | 新 URL 校验通过，更新 DB + 缓存 |
| REFRESHING → UNPLAYABLE | `urlFailureCount >= 2` 且本地无缓存文件 |
| UNPLAYABLE → REFRESHING | 定时任务 `retryFailedSongs`（间隔 4h） |

#### 7.2.2 获取 URL 流程（`getUrl`）

优先级：内存缓存 → DB + HEAD 校验 → 触发刷新。关键分支：

1. 缓存命中：`recordHot` 记录热度后直接返回。
2. DB 命中但 `urlExpiresAt` 已过期：跳过 HEAD，直接刷新（节省一次网络往返）。
3. DB 命中且 `shouldRefreshSoon`：异步预刷新（不阻塞当前请求），当前 URL 继续返回。
4. DB 命中且 HEAD 校验有效：回写缓存 + `markValid` + 记录热度。
5. 其余情况：触发 `refreshUrl`。

#### 7.2.3 刷新降级链时序图（`doRefreshWithRetry`）

```
 播放器/前端     UrlManagerService        Redis缓存       PostgreSQL        Python爬虫        多源TS API
      │  GET /api/audio/:id                    │                │                  │               │
      │─────────────────────────────────────► │                │                  │               │
      │                                       │ get(url:cache) │                  │               │
      │                                       │───────────────►│                  │               │
      │                                       │◄── miss ───────│                  │               │
      │                                       │ find song ────►│                  │               │
      │                                       │◄── audioUrl ───│                  │               │
      │                                       │ HEAD 校验(可播?)│                  │               │
      │                                       │   失效 ↓        │                  │               │
      │                                       │ acquireRefreshLock ───────────► │               │
      │                                       │ refreshFromNetease(原生ID) ──────────────────► │
      │                                       │   失败 ↓        │                  │               │
      │                                       │ refreshByNeteaseSearch(标题+歌手)────────────► │
      │                                       │   失败 ↓        │                  │               │
      │                                       │ fetchMusicUrlFromMultipleSources ─────────────► │ (netease/qq/kugou)
      │                                       │◄── newUrl ──────────────────────────────────────│
      │                                       │ checkAudioUrlPlayable(验证新URL) │               │
      │                                       │ update DB(playable/urlExpiresAt)─►│               │
      │                                       │ cacheUrl ─────►│                  │               │
      │                                       │ logRefresh + monitor ──────────► │               │
      │◄── 200 音频流 ─────────────────────────│                │                  │               │
```

降级链顺序（[url-manager.service.ts](file:///d:/music_box/server/src/modules/url-manager/url-manager.service.ts)）：

1. **Python 网易云爬虫**（原生 ID，最稳定）→ 失败则继续
2. **跨源搜索**（按标题 + 歌手在网易云搜索，覆盖 VIP / qq / 酷狗歌曲）
3. **多源 TS API**（`music-api.service.ts`：netease → qq → kugou，`Promise.allSettled` 取首个成功）

每级均套用 `withRetry` 指数退避。

#### 7.2.4 重试、自适应 TTL 与失败标记

- **指数退避**：`maxRetries=2`、`baseDelay=2000ms`、`maxDelay=15000ms`、抖动 1000ms、单链总超时 15000ms。
- **自适应 TTL**：基于同源近 7 天成功刷新记录，按「同一首歌相邻两次刷新间隔」取中位数 × 保守系数 0.7（最少 10min）；样本不足 5 条时回退静态 TTL（网易云 1h / qq/kugou 2h）。
- **失败阈值**：`markFailure` 中连续失败 ≥ 2 次才置 `playable=false`，避免网络抖动误判；本地已缓存歌曲始终可播，不被标记为不可播放。
- **防抖锁**：`acquireRefreshLock` 通过 `SET NX PX 120s` 语义避免并发重复刷新（当前为进程内 Map 实现，多副本部署时退化为非全局锁）。

#### 7.2.5 调度器（`url-manager.scheduler.ts`）

`UrlSchedulerService` 注册 8 类定时任务，均带重叠保护（`runTask`）：

| 任务 | 周期 | 说明 |
|---|---|---|
| 热门检查 | 1h | 对 `url:hot:today` Top 30 批量检查 |
| 全量检查 | 6h | `batchCheckAndRefresh`（batchSize 100，chunk 20 并发） |
| 预检测 | 15min | 刷新 `preDetectionWindowMs`（10min）内即将过期的 URL |
| 失效重试 | 4h | 重试 `playable=false` 且超时未重试的歌曲 |
| 缓存清理 | 24h | 清理过期 `url:cache:*` 与 30 天前已解决预警 |
| 预警检查 | 5min | 触发 `UrlMonitorService.checkAlerts` |
| 音频预下载 | 15min | 下载 15 首热门歌曲到本地 |
| 启动预热 | 启动后 300s | 下载 50 首热门歌曲 |

启动后还按延迟（10s/30s/60s/90s）先执行一轮预警、预检测、热门检查、预下载，降低瞬时压力。

#### 7.2.6 监控与预警（`url-manager.monitor.ts`）

`UrlMonitorService` 采集指标并持久化预警：

- **指标**：总曲目、有效 URL、过期 URL、刷新中数量、平均刷新耗时、各数据源成功率、24h/累计刷新成功失败数。
- **预警类型**：`validity_rate`（有效率 < 80% 警告，< 50% critical）、`source_failure`（数据源成功率 < 50% 警告，< 30% critical）、`refresh_failure`（单曲连续失败 ≥ 3 次）。
- **去重**：1 小时内同类型未解决预警不重复写入。

#### 7.2.7 多源 TS API（`music-api.service.ts`）

纯 TS 实现，不经 Python，作为最终降级源：

- **网易云**：`music.163.com/api/song/enhance/player/url`，码率 128/192/320k 递增重试。
- **QQ**：`u.y.qq.com/cgi-bin/musicu.fcg`（`vkey.GetVkeyServer`），HEAD 校验。
- **酷狗**：`wwwapi.kugou.com/yy/index.php?r=play/getdata`，HEAD 校验。
- 结果带 30min 内存缓存与按源请求统计。

#### 7.2.8 关键配置（`url-manager.config.ts`）

所有阈值均可用环境变量覆盖（`URL_*`、`ALERT_*` 前缀），例如 `URL_CACHE_TTL`、`URL_REFRESH_MAX_RETRIES`、`URL_ADAPTIVE_TTL_FACTOR`、`ALERT_VALIDITY_THRESHOLD`、`MAX_PYTHON_CONCURRENT` 等。

### 7.3 预下载与批量下载

- `preDownloadPopular`：按 `hotScore` 批量预下载热门歌曲。
- 前端 `CacheManager` 面板触发，后端维护 `downloadProgress` 状态并支持轮询。

---

## 8. 缓存层

2026-08-15 将 Redis 迁移为进程内 `Map`（[redis.ts](file:///d:/music_box/server/src/lib/redis.ts)），兼容 ioredis 接口（`get/set/setex/del/hincrby/lrange/multi`）。

- 容量上限：通用键 20000、哈希 2000×5000、列表 5000，超限近似 LRU 淘汰。
- 过期清理：60s 定时清理过期键与过期哈希。
- 服务能力：搜索/推荐/基因等模块的通用缓存、URL 管理缓存层、每日热度统计（`url:hot:today`）。

---

## 9. 个性化推荐引擎

`modules/recommendation` 采用「多路召回 + 加权融合 + 多样性重排」架构，核心编排类为 [recommendation.service.ts](file:///d:/music_box/server/src/modules/recommendation/recommendation.service.ts)。共 13 个源文件，职责如下：

| 组件 | 职责 |
|---|---|
| `RuleEngine` | 7 项规则的启发式打分 |
| `ContentFilter` | 基于声学特征质心的内容过滤 |
| `CollaborativeFilter` | 基于 Jaccard 相似用户的协同过滤 |
| `SongFeatureExtractor` | 声学 + 语义特征向量构建与相似度 |
| `UserProfileBuilder` | 用户画像（偏好/行为/时段） |
| `BehaviorAnalyzer` | 行为趋势 / 跳过特征 / 活跃度 |
| `AIEnhancer` | 确定性启发式「AI 增强」打分与理由 |
| `RecommendationFusion` | 加权融合 + MMR |
| `SimilarSongRecommender` | 相似歌曲 |
| `preference.engine` | 纯逻辑：声学质心 + 余弦 + MMR |
| `config` | 权重、MMR、缓存、限流配置 + 动态权重 |

### 9.1 推荐流水线（`generateForUser`）

完整流程：

1. **并行取数**：最近聆听事件、30 天反馈、最近播放、已推荐、收藏歌曲。
2. **构建排除集**：最近播放、`dislike` 反馈、已推荐歌曲全部排除。
3. **冷启动分支**：无聆听事件时直接回退热门推荐（`fallbackHot`）。
4. **构建画像 + 行为分析**：`UserProfileBuilder.build` + `BehaviorAnalyzer.analyze`（并行）。
5. **获取候选池**：`getCandidatePool`（缓存 300s，爬虫入库后失效）。
6. **计算 AI 分数**：对每个候选调用 `AIEnhancer.score`（确定性启发式，避免 LLM 延迟）。
7. **动态权重**：`computeDynamicWeights(事件数, 反馈)`。
8. **融合评分**：`RecommendationFusion.fuse`（四路加权 + 收藏加成 + MMR）。
9. **生成理由**：`AIEnhancer.generateReasons`。
10. **取 Top-K**（默认 10），不足时用热门补齐。
11. **持久化**：删除当日旧推荐 → `createMany` 写入 `rank` 与 `reason`。

### 9.2 候选池构建与内容过滤

- `getCandidatePool`：取 `playable=true`、`archived=false`、`audioUrl != ''`，按 `hotScore` 降序取 2000 首，经 `isMusicContent` 过滤后，优先有特征数据者，截取 1000 首。
- `isMusicContent` 排除非音乐内容：
  - 关键词过滤（节目、有声、广播、相声、播客、podcast、asmr、教程、讲座等）；
  - 编号标题格式（如 `224. 趙雷【成都】`）；
  - 时长异常（< 30 秒或 > 10 分钟）。

### 9.3 用户画像构建（`UserProfileBuilder`）

基于近 30 天（`behaviorAnalysis`）最多 500 条事件，`engagementScore` 加权：

- `favoriteGenres`（Top 10）、`favoriteArtists`（Top 15）、`favoriteMoods`（Top 8）。
- 行为特征：`avgListenDuration`（平均听歌秒数）、`skipRate`、`repeatRate`。
- `timePreferences`：按小时聚合的流派/心情偏好。
- `currentMood`：从 `user.emotionDna` 取最高分量标签。
- 缓存 TTL：`userProfileTTL`（3600s）。

### 9.4 行为分析（`BehaviorAnalyzer`）

- `recentTrend`：近 50 条事件的重复率，`repeatRate > 0.6` → `repeating`，`< 0.2` → `exploring`，否则 `balanced`。
- `currentHourPreference`：当前小时播过的流派/心情。
- `continuousPlayStreak`：连续播放数（遇 skip 中断）。
- `skippedFeatures`：跳过的流派/心情（出现 ≥ 2 次，各取 Top 5 / Top 3）。
- `activityScore`：7 天日均事件数 / 50。

### 9.5 规则引擎（`RuleEngine`）

对每个候选的七项评分（加权求和后截断到 [0,1]）：

| 规则 | 权重 | 说明 |
|---|---|---|
| 风格匹配 | 0.30 | 命中用户偏好流派（按偏好权重加权） |
| 情绪匹配 | 0.25 | 命中用户偏好心情 |
| 热度 | 0.15 | `min(hotScore/100, 1)` |
| 时段适配 | 0.15 | 当前小时偏好的流派/心情重叠率 |
| 新鲜度 | 0.10 | 30 天内 1、90 天 0.7、365 天 0.4、否则 0.2 |
| 行为趋势 | 0.10 | 探索模式 0.7、重复模式 0.3、否则 0.5 |
| 跳过惩罚 | -0.15~0 | 命中跳过流派每个 -0.05、心情每个 -0.03 |

### 9.6 内容过滤（`ContentFilter`）

- 取用户最近播放歌曲的特征向量，计算**质心**（各维取均值）。
- 候选歌曲特征与质心做余弦相似度，作为内容分。
- 相似度 > 0.7 理由「声学风格相似」，> 0.5「曲风相近」。

### 9.7 协同过滤（`CollaborativeFilter`）

- **相似用户发现**：取当前用户近 30 天歌曲集合，找也听过这些歌的用户，用 Jaccard 相似度（阈值 0.05），取 Top 10。
- **评分**：相似用户播放事件按 `similarity × engagementScore` 加权聚合，归一化后作为候选分。
- **理由**：命中用户数 ≥ 3「相似用户都喜欢」、≥ 2「相似用户推荐」。

### 9.8 歌曲特征提取（`SongFeatureExtractor`）

构建三类向量：

- **acoustic（8 维）**：subBass / bass / lowMid / mid / highMid / presence / brilliance / air。
- **semantic（12 维）**：5 流派 + 3 心情 + 3 场景（`id % 100 / 100` 归一化）+ 1 热度（`min(hotScore/100,1)`）。
- **combined（20 维）**：acoustic + semantic 拼接。

相似度：`0.6 × cosine(acoustic) + 0.4 × cosine(semantic)`。缓存 24h。

### 9.9 AI 增强（`AIEnhancer`）

为规避 LLM 延迟，采用**确定性启发式评分**（而非实时 LLM 调用）：

```
score = 0.5 × genreMatch + 0.3 × moodMatch
        + (exploring ? 0.1 : repeating ? 0.05 : 0)
```

其中 `genreMatch`/`moodMatch` 为候选与用户偏好流派/心情的命中占比，上限 1。理由生成则基于风格/情绪/时段/趋势。

### 9.10 融合与 MMR（`RecommendationFusion`）

融合公式（[recommendation-fusion.ts](file:///d:/music_box/server/src/modules/recommendation/recommendation-fusion.ts)）：

```
finalScore = w.rule·rule + w.content·content + w.collaborative·collab + w.ai·ai
            + (收藏歌曲) FAVORITE_SCORE_BOOST (0.3)
```

融合后使用 **MMR（Maximal Marginal Relevance）** 重排：

```
MMR = λ·score - (1-λ)·max_similarity(候选, 已选)
```

- `λ = 0.7`（`config.mmr.lambda`）。
- 相似度基于流派 + 心情的 Jaccard 均值。
- 另有纯逻辑版 `preference.engine.ts` 的 `mmrSelect`（基于特征向量余弦），供单测与声学场景使用。

### 9.11 动态权重（`computeDynamicWeights`）

默认权重 `rule=0.3, content=0.3, collaborative=0.25, ai=0.15`，按数据量/反馈调整后归一化到总和 1：

- **冷启动**（事件 < 10）：`collaborative` 降为 0.05，`content` +0.15（协同过滤数据不足不可靠）。
- **负反馈多**（不喜欢率 > 50%）：`content` +0.05，`ai` -0.05（内容过滤更稳定，降低不可控 AI）。

### 9.12 相似歌曲推荐（`SimilarSongRecommender`）

- 取目标歌曲特征，与候选池（可播放、排除自身，Top 500）逐首计算 `SongFeatureExtractor.similarity`，排序取 Top-K（默认 5）。
- 理由：`> 0.8`「风格高度相似」、`> 0.6`「曲风相近」，命中共同流派时附流派名。

### 9.13 质量评估（`getQualityReport`）

输出 6 项指标（百分比）：`accuracy`（无负面反馈占比）、`genreDiversity`、`artistDiversity`、`freshness`（未听过占比）、`featureCoverage`（有特征占比）、`contentPurity`（非歌曲内容占比）。

### 9.14 默认配置（`config.ts`）

| 配置项 | 默认值 |
|---|---|
| 权重 | rule 0.3 / content 0.3 / collaborative 0.25 / ai 0.15 |
| MMR λ | 0.7 |
| 用户画像缓存 | 3600s |
| 推荐结果缓存 | 1800s |
| 每日推荐数 | 10 |
| 相似歌曲数 | 5 |
| 最近播放窗口 | 50 |
| 行为分析窗口 | 30 天 |

---

## 10. 用户画像体系

### 10.1 情绪 DNA（`emotion-dna`）

情绪 DNA 是用户聆听行为的 8 维声学指纹，由 [emotion-dna.service.ts](file:///d:/music_box/server/src/modules/emotion-dna/emotion-dna.service.ts) 计算。

**向量定义**（`DnaVector`，8 个频段）：

```
subBass / bass / lowMid / mid / highMid / presence / brilliance / air
```

对应 `ListeningEvent` 中预计算的 `feat*` 字段（前端 Web Audio 分析器提取后上报）。

**计算公式**：对近 180 天（`EVENT_LOOKBACK_DAYS`）内、最多 5000 条（`EVENT_LIMIT`）`complete/play/skip/favorite` 事件做加权均值：

```
weight(e)  = sign(e) × engagementScore(e)
sign(e)    = -1  (eventType == 'skip')
             +1  (otherwise)
vector[k]  = Σ e.feature[k] × weight(e) / Σ |weight(e)|
```

- `engagementScore` 为沉浸度权重（缺失时取 0.3）。
- 结果逐维 clamp 到 [0, 1]。
- `skip` 事件取负权，使「被跳过的歌曲的声学特征」在 DNA 中被削弱。

**阈值与持久化**：

- 事件数 < `MIN_EVENTS_THRESHOLD`（5 条）时返回 `insufficient=true`，不写入全零向量（避免塌缩雷达图）。
- 数据充足时持久化到 `User.emotionDna`（Json）：`{ vector, eventCount, updatedAt }`。
- `getForUser` 对旧版全零向量做兼容：检测到全零则现场重算。

**接口输出**（`emotion-dna.controller.ts`）：`GET /api/emotion-dna` 返回 `vector`、`eventCount`、`interpretation`（每维 `label`：>0.6 强偏好 / >0.3 中等 / 否则弱）与 `insufficientMessage`（数据不足提示）。

### 10.2 社交 DNA（`social-dna`）

- 12 维向量 + SVG 暗号，通过余弦补集匹配相似用户。

### 10.3 基因图谱（`genome`）

- 对歌曲声学特征做 PCA 降维，产出 `genomeX / genomeY` 二维坐标，用于可视化与相似度计算。

### 10.4 时间胶囊 / 时光机

- `Capsule`：`snapshotJson` 快照 + `lockedUntil` 锁定时间，到期 `revealedAt` 揭晓。
- `time-machine`：按时间维度回溯聆听场景。

---

## 11. AI 电台（`radio`）

### 11.1 LLM Provider 抽象（`lib/llm`）

- `OllamaProvider` / `OpenAIProvider` / `OpenAICompatibleProvider`（deepseek/qwen/glm/kimi/custom）。
- `provider-factory` 统一注册与切换，`llm-provider.ts` 保留向后兼容接口（`createLLM` / `getLLMConfig`）。

### 11.2 对话式电台（LangGraph Agent 工具实现）

`agent.ts` 使用 `createReactAgent`（LangGraph prebuilt）实现 ReAct Agent，绑定 5 个 `DynamicStructuredTool`（`@langchain/core/tools` + zod 结构化参数）：

| 工具 | 参数 schema | 实现 |
|---|---|---|
| `queryUserHistory` | `type: recent/top`, `limit`(默认10) | 查 `listeningEvent`：`recent` 按时间倒序，`top` 用 `groupBy songId` 计数 |
| `queryUserDNA` | `type: emotion/social/daily` | 读 `User.emotionDna` / `SocialDna.vectorJson` / 今日 `DailyRecommendation` |
| `querySongLibrary` | `genre/mood/scene/artist/title`, `limit` | `Song.findMany` 按标签关系 + 标题/歌手 `contains` 模糊匹配，返回带标签、`hotScore` 降序 |
| `searchExternal` | `query` | 先查曲库，未命中则调 Python `music_crawler.py search --limit 5`，轻量 upsert 入库 |
| `generatePlaylist` | `songIds[]`, `reason`, `theme?` | 校验可播放 → 主题匹配排序 → MMR 重排，返回 `{success, reason, theme, songs, total}` |

**关键机制**：

- **主题一致性**：系统提示词强制 `generatePlaylist` 传 `theme`，主题匹配度主导排序（`score = themeMatch×0.85 + hotNorm×0.15`），保证回答与歌单一致。
- **MMR 重排**（`generatePlaylist` 内）：`MMR = λ·score - (1-λ)·maxSimilarity`（λ=0.7），相似度基于歌曲标签 Jaccard。
- **searchExternal 轻量入库**：`upsertSong` 按 `title+artist` 去重，不调用分类器保证响应速度，标签由后续定时任务补打。
- **性能优化**：Agent/工具按 userId 缓存、历史截断 10 条、`recursionLimit=50`、超时控制。
- **兜底**（`fallbackRecommend`）：LLM 未产出歌单时，按 `THEME_KEYWORDS` 提取主题 → 标签检索 → 标题/歌手模糊 → 热门兜底。

### 11.3 全自动电台（RadioStream 生产者-消费者）

[radio-stream.service.ts](file:///d:/music_box/server/src/modules/radio/radio-stream.service.ts) 采用「后台生产者 + 前台消费者」架构，实现秒开与无限连播：

- **StreamState**（内存，按 userId）：`readyBatches`（就绪批次队列）、`playedSongIds`/`playedTitles`（去重）、`generating`（单用户同时只跑一个 LLM）、`active`。
- **生产者** `topUpChain`：持续补货直到队列满（`MAX_READY_BATCHES=3`）或达到本轮上限（`MAX_GENERATE_ATTEMPTS=3`），避免 LLM 失败时紧循环。
- **消费者**：`start` / `next` / `refresh` 从队列 `drainBatch` 取已就绪批次，LLM 未就绪时用 `fallbackSongs` 兜底。

**单次选歌 `generateSongsWithLLM`**（[agent.ts](file:///d:/music_box/server/src/modules/radio/agent.ts)）：

- 候选池：热门加权随机采样 150 首（`weightedSample`）+ 收藏歌曲前置。
- 提示词注入：用户偏好歌手、收藏（建议至少选 3 首）、已播去重、动态策略提示（冷启动/负反馈/稳定偏好）。
- 输出 JSON 数组 → 反查曲库，最多 10 首。

**兜底 `fallbackSongs`**：按探索比例 `explorationRatio`（默认 0.3，`RADIO_EXPLORATION_RATIO` 可调）混合「个性化（每日推荐，3s 超时）+ 探索（热门池加权随机）」，洗牌后返回。

**多样性工具**（`radio-diversity.ts`）：`weightedSample`（加权无放回采样）+ `shuffle`（Fisher-Yates），对标「心动模式」的探索性，避免每次返回相同歌单。

---

## 12. 定时任务（`scheduler.ts`）

每日 03:00 执行（启动延迟 60s 避免资源峰值，每小时检查一次）：

1. 刷新热门 100 歌单
2. 多关键词爬取新歌（10 关键词 × 20 首）
3. 清除推荐候选池缓存
4. 批量检查 URL 健康（每批 10 并发，最多 50 首）
5. 刷新全部分类歌单
6. 为活跃用户预生成每日推荐
7. 重算活跃用户情绪 DNA
8. 重算活跃用户社交 DNA
9. 重算基因图谱 PCA

---

## 13. 安全

- **认证**：JWT（`jwtSecret` 生产环境强制 32+ 字符）+ bcryptjs 密码哈希。
- **限流**：全局、认证（更严）、搜索、音频刷新四档 `express-rate-limit`。
- **安全头**：`helmet`（关闭跨域隔离策略以兼容前端跨源音频）。
- **CORS 白名单**：允许 localhost 各端口、Tauri/Electron 桌面来源。
- **请求体限制**：`express.json` 限制体积。
- **输入校验**：`middleware/validate.ts` + `validators/` + zod。
- **净化**：`middleware/sanitize.ts`。
- **审计**：`OperationLog` 记录操作前后值。
- **桌面共享 API Key**：`DESKTOP_API_KEY` 生产环境强制 24+ 字符。

---

## 14. 部署与运维

- **容器**：`Dockerfile`、`docker-compose.yml`、`docker-compose.dev.yml`。
- **进程守护**：`server/ecosystem.config.js`（PM2）。
- **反向代理**：`nginx/default.conf`。
- **启动脚本**：根目录 `start.bat` / `start.ps1` / `start-server.bat`，`scripts/` 下 `start.js` / `startup.cjs` / `health.js` / `troubleshoot.js` / `db-tool.cjs` 等。
- **健康检查**：`/health` 与 `/api/health` 双端点（统一 handler）。
- **桌面安装包**：`scripts/build-exe.js`（Electron 打包）。

---

## 15. 目录结构

```
music_box/
├── web/                  # 主前端 (React + Vite)
│   ├── src/components/   # 播放器组件
│   ├── src/hooks/        # 核心 Hooks
│   ├── src/pages/        # 页面
│   ├── src/sonic/        # 3D/可视化
│   ├── src/services/     # API 封装
│   └── src/types/
├── web/admin/            # 管理后台
├── web/browse/           # 浏览端
├── mini-app/             # Taro 小程序
├── shared/               # 跨端共享逻辑
├── server/               # Node API 服务
│   ├── prisma/schema.prisma
│   ├── src/index.ts      # 入口
│   ├── src/modules/      # 业务模块
│   ├── src/lib/          # 基础设施
│   ├── src/middleware/   # 中间件
│   ├── src/services/     # 跨模块服务
│   └── tests/
├── tools/                # Python 爬虫与音频脚本
├── scripts/              # 构建/启动/运维脚本
├── data/audio-cache/     # 本地音频缓存（运行时，不入库）
└── docs/                 # 文档
```

---

## 16. 关键设计决策

1. **本地缓存优先的音频方案**：用本地磁盘缓存替代对平台临时 URL 的依赖，彻底规避 URL 频繁失效问题。
2. **Redis → 内存 Map**：为降低部署复杂度，用进程内 Map 替代 Redis，代价是失去跨实例共享（多副本部署时需注意分布式锁/缓存语义变化）。
3. **Python 爬虫与 Node 解耦**：通过 `python-runner.ts` 子进程调度，`windowsHide` 抑制弹窗、信号量限制并发。
4. **LLM Provider 可插拔**：工厂 + 接口抽象，支持 Ollama/OpenAI/兼容提供商，Agent 缓存与超时保障本地模型可用性。
5. **多路推荐融合**：规则 + 内容 + 协同 + AI 四路加权 + MMR 多样性，兼顾个性化与探索。
6. **「薄壳 + 主体」前端拆分**：鉴权与播放器解耦，提升健壮性。
