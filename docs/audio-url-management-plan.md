# 音频 URL 实时更新系统 — 技术文档

本文档描述音乐盒子项目音乐（音频 URL）实时更新功能的实际实现，供维护与排障参考。

> 2026-08-21 重写：本文档早前描述的是 NestJS + Redis 架构，与实际 Express 实现不符，已按当前代码重写。

---

## 一、技术架构

### 1.1 整体链路

```
前端 useAudioPlayer (web/src/hooks/useAudioPlayer.ts)
   │
   ├── 播放失败（audio error 事件）→ 自动刷新
   │     GET /api/refresh-track?id=xxx         （刷新 URL）
   ├── 播放音频
   │     GET /api/audio/:trackId                （本地缓存优先 + Range）
   └── 播放错误上报
         POST /api/audio/error-report

后端 Express (server/src/index.ts)
   ├── UrlManagerService    （内存缓存 → DB 校验 → Python/多源刷新）
   ├── UrlSchedulerService  （定时任务闭环）
   ├── UrlMonitorService    （健康度指标 + 预警）
   └── AudioCacheService    （磁盘缓存 + 内存 LRU + 流式代理）
```

### 1.2 缓存分层

| 层级 | 存储 | 有效期 | 用途 |
|------|------|--------|------|
| 内存缓存 | Node.js Map（`server/src/lib/redis.ts`，已从 Redis 迁移） | 30 分钟 | URL 快速命中 |
| 数据库 | `songs.audio_url` + `url_expires_at` | 自适应 TTL | 持久 URL |
| 本地磁盘 | `data/audio-cache/{platform}_{id}.mp3` | 永久 | 彻底摆脱临时 URL 失效 |
| 内存 LRU | 进程内 Buffer | 100MB / 40 首 | 热歌秒播 |

---

## 二、关键代码说明

### 2.1 UrlManagerService（核心服务）

文件：`server/src/modules/url-manager/url-manager.service.ts`

- `getUrl(trackId)`：三级缓存获取
  1. 内存缓存命中直接返回
  2. DB 中存在且未过期 → HEAD 校验 → 有效则缓存并返回
  3. 失效 → 触发 `refreshUrl()`
- `refreshUrl(trackId)`：多级降级刷新
  1. 分布式刷新锁（防止并发重复刷新）
  2. **第一优先**：Python 网易云爬虫 `tools/refresh_song_url.py`（最稳定）
  3. **第二降级**：多源 TS API（netease → qq → kugou），见 [music-api.service.ts](../server/src/modules/url-manager/music-api.service.ts)
  4. 指数退避重试（默认 2 次）+ 新 URL 在线验证 + 自适应 TTL 预测
- `predictExpiryAdaptive()`：基于历史刷新间隔中位数 × 0.7 预测过期时间，样本不足回退静态 TTL（网易云 1 小时）
- `markFailure()`：连续失败 2 次才标记 `playable=false`（防网络抖动误判）；本地已缓存则始终可播放

### 2.2 music-api.service.ts（多源获取服务）

文件：`server/src/modules/url-manager/music-api.service.ts`

纯 TS 多源获取，不依赖 Python：

- `fetchFromNetease()`：网易云 `song/enhance/player/url` 接口，多码率尝试（128/192/320）
- `fetchFromQQ()`：QQ 音乐 `vkey.GetVkeyServer` 接口
- `fetchFromKugou()`：酷狗 `play/getdata` 接口
- `fetchMusicUrlFromMultipleSources()`：并发多源，返回第一个有效结果
- `parseTrackId()`：解析 `netease:123` / `qq:xxx` / `kugou:xxx` 前缀

### 2.3 UrlSchedulerService（定时任务）

文件：`server/src/modules/url-manager/url-manager.scheduler.ts`

| 任务 | 间隔 | 说明 |
|------|------|------|
| hotCheck | 1 小时 | 检查热门歌曲 URL |
| fullCheck | 6 小时 | 全量检查并刷新失效 URL |
| preDetection | 15 分钟 | 预刷新即将过期的 URL |
| failedRetry | 4 小时 | 重试失效歌曲 |
| cacheCleanup | 24 小时 | 清理过期缓存与旧预警 |
| alertCheck | 5 分钟 | 检查预警条件 |
| audioPreDownload | 30 分钟 | 预下载热门音频到本地 |
| audioWarmup | 启动延迟执行 | 预热下载 50 首热门 |

### 2.4 UrlMonitorService（监控预警）

文件：`server/src/modules/url-manager/url-manager.monitor.ts`

- 指标：URL 有效率、刷新成功率、各源成功率、平均刷新耗时
- 预警：有效率过低、单曲连续失败、数据源成功率过低
- 记录：`url_refresh_logs`、`url_alerts`、`audio_error_logs`

### 2.5 AudioCacheService（本地缓存与代理）

文件：`server/src/modules/audio-cache/audio-cache.service.ts`

- `serveAudio()`：按「内存缓存 → 磁盘缓存 → 远程代理」优先级返回音频，支持 Range 请求
- 未缓存时流式代理网易云并后台落盘，形成永久本地缓存

---

## 三、接口一览

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/refresh-track?id=xxx` | 公开 + 专属限流 | 刷新并返回可用 URL |
| GET | `/api/audio/:trackId` | 公开 | 音频流（缓存优先，支持 Range） |
| HEAD | `/api/audio/:trackId` | 公开 | 预加载触发 |
| GET | `/api/audio/:trackId/check` | 公开 | URL 有效性预检测 |
| POST | `/api/audio/error-report` | 公开 | 前端播放错误上报 |
| GET | `/api/url-manager/status` | 登录用户 | 系统状态 |
| GET | `/api/url-manager/dashboard` | 登录用户 | 实时面板 |
| GET | `/api/url-manager/metrics` | 登录用户 | 监控指标 |
| GET | `/api/url-manager/alerts` | 登录用户 | 预警列表 |
| GET | `/api/url-manager/logs` | 登录用户 | 刷新日志 |
| POST | `/api/url-manager/refresh/:trackId` | admin | 手动刷新 |
| POST | `/api/url-manager/refresh-batch` | admin | 批量刷新 |
| POST | `/api/url-manager/emergency/:trackId` | admin | 紧急刷新 |

---

## 四、维护指南

### 4.1 环境变量

配置集中在 `server/src/modules/url-manager/url-manager.config.ts`：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `URL_CACHE_TTL` | 1800000 (30min) | URL 缓存 TTL |
| `URL_REFRESH_TIMEOUT` | 30000 | 单曲刷新超时 |
| `URL_REFRESH_MAX_RETRIES` | 2 | 刷新重试次数 |
| `URL_RETRY_BASE_DELAY` | 2000 | 退避基础延迟 |
| `URL_BATCH_SIZE` | 100 | 批量检查单批数量 |
| `URL_CHUNK_SIZE` | 20 | 批量并发分片 |
| `URL_PREDETECTION_WINDOW` | 600000 (10min) | 预刷新窗口 |
| `URL_FAILED_RETRY_INTERVAL` | 14400000 (4h) | 失效重试间隔 |
| `ALERT_VALIDITY_THRESHOLD` | 0.8 | URL 有效率预警阈值 |
| `ALERT_FAILURE_THRESHOLD` | 3 | 单曲连续失败阈值 |
| `ALERT_SOURCE_RATE` | 0.5 | 数据源成功率阈值 |

### 4.2 常见故障排查

**URL 失效 / 播放失败**
- 前端自动触发 `/api/refresh-track` 刷新，最多重试 2 次。
- 检查 `url_refresh_logs` 表刷新记录；检查 Python 环境（`PYTHON_BIN`）。

**Python 爬虫失败**
- 检查 `tools/netease_crawler.py` 是否可运行；`python tools/refresh_song_url.py <id>` 手动验证。
- 失败后系统自动降级到 TS 多源（netease → qq → kugou）。

**429 刷新过于频繁**
- `/api/refresh-track` 专属限流（15 分钟 / 20 次 / IP），前端已有友好提示。

**本地缓存覆盖不足**
- 手动触发 `POST /api/cache/download`，或等待定时预下载任务。
- 查看 `GET /api/cache/status` 了解缓存覆盖情况。

---

## 五、相关文件索引

- 前端播放器：`web/src/hooks/useAudioPlayer.ts`
- 后端入口与路由：`server/src/index.ts`
- URL 管理模块：`server/src/modules/url-manager/`
- 音频缓存模块：`server/src/modules/audio-cache/audio-cache.service.ts`
- 数据库模型：`server/prisma/schema.prisma`（`Song`、`UrlRefreshLog`、`UrlAlert`、`AudioErrorLog`）
- 多源获取服务：`server/src/modules/url-manager/music-api.service.ts`
