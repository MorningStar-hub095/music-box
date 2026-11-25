# 音乐 URL 实时更新 — 缺陷修复设计方案

- 日期：2026-08-21
- 范围：审查并修复项目音乐（音频 URL）实时更新链路的关键缺陷
- 目标：优化网易云源并接入 QQ/酷狗多源降级、加固鉴权、补齐测试、修正文档

---

## 1. 现状分析

### 1.1 已实现的完整链路

音乐 URL 的实时更新能力已经存在，核心链路如下：

```
前端 useAudioPlayer
   │ 播放失败(error 事件)
   ├── GET /api/refresh-track?id=xxx        → 刷新 URL
   ├── GET /api/audio/:trackId               → 音频代理（本地缓存优先 + Range）
   └── POST /api/audio/error-report          → 播放错误上报

后端 Express
   ├── UrlManagerService  （Redis → DB 校验 → Python 爬虫刷新）
   ├── UrlSchedulerService（8 个定时任务）
   ├── UrlMonitorService  （健康度指标 + 预警）
   └── AudioCacheService  （本地磁盘缓存 + 内存 LRU + 流式代理）
```

关键文件：

- 后端核心：[url-manager.service.ts](../../server/src/modules/url-manager/url-manager.service.ts)
- 后端调度：[url-manager.scheduler.ts](../../server/src/modules/url-manager/url-manager.scheduler.ts)
- 后端监控：[url-manager.monitor.ts](../../server/src/modules/url-manager/url-manager.monitor.ts)
- 后端音频缓存：[audio-cache.service.ts](../../server/src/modules/audio-cache/audio-cache.service.ts)
- 后端路由：[index.ts](../../server/src/index.ts)
- 前端播放器：[useAudioPlayer.ts](../../web/src/hooks/useAudioPlayer.ts)
- 多源获取（仅 dev）：[music-api-service.ts](../../web/vite-plugins/music-api-service.ts)
- Vite 刷新插件（仅 dev）：[audio-refresher.ts](../../web/vite-plugins/audio-refresher.ts)

### 1.2 数据库模型（已具备）

`Song` 表已含 URL 管理字段：`audioUrl`、`audioUrlMp3`、`urlSource`、`urlExpiresAt`、`urlCheckedAt`、`urlRefreshCount`、`urlLastFailure`、`urlFailureCount`。

配套表：`UrlRefreshLog`（刷新日志）、`UrlAlert`（预警）、`AudioErrorLog`（播放错误）。

### 1.3 识别到的关键缺陷

| # | 缺陷 | 位置 | 影响 |
|---|------|------|------|
| 1 | 生产环境多源降级缺失：`refreshUrl` 仅支持 `netease`，QQ/酷狗只在 dev-only 插件中 | [url-manager.service.ts](../../server/src/modules/url-manager/url-manager.service.ts#L246-L262) | 网易云源失效时无法降级，刷新成功率受限 |
| 2 | 多源逻辑重复且仅 dev 生效 | [music-api-service.ts](../../web/vite-plugins/music-api-service.ts)、[audio-refresher.ts](../../web/vite-plugins/audio-refresher.ts) | 职责重叠，生产未复用 |
| 3 | `/api/refresh-track` 公开无鉴权，可触发昂贵 Python 爬取 | [index.ts](../../server/src/index.ts#L211-L232) | 滥用风险、资源消耗 |
| 4 | url-manager / audio-cache 无单元测试 | `server/tests/` | 缺少回归保障 |
| 5 | 文档失真：描述 NestJS+Redis 架构，与实际 Express 不符 | [audio-url-management-plan.md](../../docs/audio-url-management-plan.md) | 误导维护者 |

---

## 2. 设计原则

1. **保持现有架构不大改**：复用现有 `UrlManagerService` 的缓存/锁/重试/TTL 机制。
2. **不删除原有代码**：对废弃/迁移的代码用注释标记 `@deprecated`，保留文件。
3. **修改处添加普通注释**，遵守项目代码规范。

---

## 3. 目标架构

```
前端 useAudioPlayer（保持现有错误→刷新→重试→切歌逻辑）
   │
后端 Express
   ├── GET /api/refresh-track（保留公开 + 新增专属限流 + 去重防抖）
   │        └── UrlManagerService.getUrl()
   │                ├── Redis 缓存（TTL 30min）
   │                ├── DB audioUrl + 在线验证
   │                └── refreshUrl()  ← 改造点
   │                        ├── 分布式锁 + 指数退避
   │                        └── 多源降级（新增 music-api.service.ts）
   │                                netease(Python) → netease(TS API) → qq → kugou
   └── GET /api/audio/:trackId（本地缓存优先 + Range，保持不变）
```

---

## 4. 具体改动

### 4.1 新增：`server/src/modules/url-manager/music-api.service.ts`

移植并增强 [music-api-service.ts](../../web/vite-plugins/music-api-service.ts) 到服务端，作为**纯 TS 多源获取服务**（不含 Python 调用）：

- 保留 `MusicSource` 类型（`netease` / `qq` / `kugou`）、`MusicUrlResult` 接口、`parseTrackId()`。
- 保留三个源的 HTTP 获取函数与 `fetchMusicUrlFromMultipleSources()` 并发降级逻辑。
- 增强：统一 `httpGet` / `headCheck`、超时、重定向跟随、请求统计。

### 4.2 改造：`UrlManagerService.refreshUrl()`

在 [doRefreshWithRetry](../../server/src/modules/url-manager/url-manager.service.ts#L225-L321) 中，刷新流程改为多级降级：

1. **第一优先**：现有 `refreshFromNetease(trackId)`（Python 爬虫 `get_song_url`，最稳定）。
2. **第二降级**：Python 失败后调用 `music-api.service.ts` 的 `fetchMusicUrlFromMultipleSources()`，按 `netease(TS API) → qq → kugou` 顺序降级。
3. 保留现有 `withRetry` 指数退避、`checkAudioUrlPlayable` 验证、自适应 TTL 预测、`markFailure` 连续失败计数。
4. 返回结果记录实际来源 `source`。

### 4.3 加固：`/api/refresh-track` 鉴权与防滥用

在 [index.ts](../../server/src/index.ts#L211) 中：

- 新增 `refreshTrackLimiter` 专属限流器（默认 15 分钟 / 20 次 / IP）。
- 保留公开访问（前端匿名播放器无需登录）。
- 接口层去重：复用 `UrlManagerService` 已有的分布式刷新锁，避免同一曲目短时间重复触发 Python 爬取。

### 4.4 前端：`useAudioPlayer` 小优化

- 保持现有「error 事件 → `refreshAudioUrl` → 重试（≤2）→ 自动切歌」逻辑。
- 确认刷新成功后通过 `onUrlRefreshed` 持久化新 URL 到 React state（现有逻辑已具备）。

### 4.5 代码去重（不删除）

- [audio-refresher.ts](../../web/vite-plugins/audio-refresher.ts)、[music-api-service.ts](../../web/vite-plugins/music-api-service.ts) 顶部添加 `@deprecated` 注释，说明生产已由后端 `url-manager` 承接，文件保留不动。

---

## 5. 缓存策略（保持 + 微调）

| 层级 | 策略 | 现状 |
|------|------|------|
| Redis URL 缓存 | TTL 30 分钟 | 保持 |
| 数据库 | `urlExpiresAt` 自适应 TTL（历史间隔中位数 × 0.7，下限 10 分钟） | 保持 |
| 本地磁盘缓存 | 永久有效，`data/audio-cache/*.mp3` | 保持 |
| 内存 LRU | 100MB / 40 首 | 保持 |
| 失效检测 | `checkAudioUrlPlayable`（GET Range bytes=0-1023） | 保持 |

---

## 6. 异常处理（保持 + 增强）

- URL 获取失败：多源降级（netease→qq→kugou），全失败返回 null。
- 播放失败：前端 `error` 事件触发刷新，重试上限 2 次，超限自动切歌。
- 刷新失败：`markFailure` 连续失败 2 次才标记 `playable=false`（防抖动误判）；本地已缓存则始终可播放。
- 限流：`/api/refresh-track` 超过阈值返回 429，前端已有 429 友好提示。

---

## 7. 测试方案

### 7.1 后端（jest + supertest，复用现有 [jest.config.ts](../../server/jest.config.ts)）

**单元测试**
- `music-api.service`：`parseTrackId`、URL 缓存、多源解析（mock http）。
- `url-manager.service`：`getUrl` 三级缓存、`refreshUrl` 多源降级、`markFailure` 连续 2 次、`predictExpiryAdaptive`。
- `url-manager.monitor`：`getStats`、`checkAlerts`。
- `url-manager.config`：环境变量解析。

**集成测试**
- `GET /api/refresh-track`：缓存命中、DB 有效、触发刷新、限流 429。
- `GET /api/audio/:trackId`：本地缓存命中、Range 请求、404。

**用户场景测试（service 层 mock）**
- 播放错误上报 → 刷新 → 多源降级 → 失败自动切歌全链路。

### 7.2 前端（新增 vitest + @testing-library/react + jsdom）

- `useAudioPlayer`：play 成功、error 触发刷新、重试上限 2 次、自动切歌倒计时、预缓冲。

---

## 8. 文档产出

- 重写 [audio-url-management-plan.md](../../docs/audio-url-management-plan.md)，匹配实际 Express 实现。
- 内容包含：技术架构、关键代码说明、维护指南、常见故障排查。

---

## 9. 验收标准

1. 生产环境 URL 刷新支持 netease → qq → kugou 多源降级。
2. `/api/refresh-track` 具备专属限流，滥用风险可控。
3. 后端新增 url-manager / audio-cache / music-api 单元与集成测试，前端新增 useAudioPlayer 单测，全部通过。
4. 文档与实际实现一致。
