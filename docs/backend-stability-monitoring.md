# 后端服务稳定性保障方案

- 日期：2026-08-22
- 目标：后端服务 7×24 小时稳定运行，杜绝非手动关闭导致的服务消失/断开/意外退出

---

## 1. 根因分析

排查发现，后端服务「持续运行一段时间后自动消失」主要由以下原因导致：

| # | 根因 | 说明 |
|---|------|------|
| 1 | **内存泄漏 → OOM** | `lib/redis.ts` 内存缓存中：① 无 TTL 的 `store` 条目永不清理；② `hashStore`（如 `url:hot:today` 热度哈希）无过期机制，字段随访问无限增长；③ `listStore` 列表无长度上限。长期运行内存持续增长，最终被操作系统 OOM 杀死。 |
| 2 | **无持久化日志** | 仅 `console.*` 输出到 stdout，进程崩溃后日志丢失，无法追溯退出根因。 |
| 3 | **部署无守护/资源限制** | Docker 部署虽有 `restart: unless-stopped`，但 `api` 服务无 `healthcheck`（只能检测退出，无法检测挂起）、无内存/CPU 上限；`npm run dev` 用 `ts-node` 直接运行，崩溃后不重启。 |
| 4 | **优雅关闭不完整** | `gracefulShutdown` 未关闭 HTTP 服务器与数据库连接。 |

## 2. 已实施的稳定性措施

### 2.1 修复内存泄漏（`server/src/lib/redis.ts`）
- 为 `store` / `hashStore` / `listStore` 增加容量上限（近似 LRU 淘汰）：
  - `MAX_STORE_ENTRIES = 20000`、`MAX_HASH_KEYS = 2000`、`MAX_HASH_FIELDS = 5000`、`MAX_LIST_ENTRIES = 5000`
- 新增 `hashExpiry` 跟踪哈希键过期，`MemoryMulti.expire` 支持哈希键（修复 `url:hot:today` 永久不清理）
- 60s 定时清理增加哈希过期清理

### 2.2 持久化日志（`server/src/lib/logger.ts`）
- 新增滚动日志模块：写入 `logs/server.log`，单文件 10MB 轮转，保留 5 个文件
- 集成到启动、错误处理、优雅关闭、全局错误中间件等关键节点

### 2.3 错误捕获与优雅关闭（`server/src/index.ts`）
- `unhandledRejection` / `uncaughtException` 统一写入日志文件
- `gracefulShutdown` 增强：关闭 HTTP 服务器、断开 Prisma、3 秒兜底退出
- `/api/health` 增加 `cacheEntries`（内存缓存条目数）监控指标

### 2.4 容器资源限制与健康检查（`docker-compose.yml`）
- `api` 服务增加 `mem_limit: 1g`、`cpus: 1.0`
- 增加 `healthcheck`（探测 `/api/health`，30s 间隔，3 次失败重启）
- 日志目录挂载到 `api_logs` 卷持久化

### 2.5 PM2 进程守护（`server/ecosystem.config.js`）
- 新增 PM2 配置：`autorestart` + `max_memory_restart: 512M` + `max_restarts: 10`

## 3. 部署方案

### 方案 A：Docker Compose（推荐）
```bash
docker compose up -d --build
```
- 所有服务 `restart: unless-stopped`，意外退出自动重启
- `api` 有健康检查与资源限制

### 方案 B：PM2（裸机）
```bash
npm i -g pm2
cd server && npm run build
pm2 start ecosystem.config.js
pm2 save && pm2 startup   # 开机自启
```

## 4. 长期监控方案

| 维度 | 手段 | 频率 |
|------|------|------|
| 服务存活 | `GET /api/health`（status/uptime/memory/cacheEntries/pid） | Docker healthcheck 30s / 外部监控 1min |
| 资源使用 | `/api/health` 的 `memory.rss`、`memory.heapUsed` | 1min 采样 |
| 内存缓存增长 | `/api/health` 的 `cacheEntries`（应稳定不持续增长） | 5min 采样 |
| 错误频率 | `logs/server.log` 中 `[ERROR]` / `[STABILITY]` 关键字统计 | 每日汇总 |
| 进程退出事件 | `logs/server.log` 中「收到 xxx 信号」「进程退出」 | 事件驱动告警 |
| 崩溃恢复 | PM2 `pm2 status` / Docker `docker compose ps` 重启计数 | 持续 |

### 告警阈值建议
- `memory.heapUsed` > 512MB：触发 GC（已内置），持续 > 1GB 需排查
- `cacheEntries` 持续线性增长：缓存泄漏信号
- 5 分钟内出现 > 10 条 `[STABILITY]` 错误：需人工介入
- 进程重启次数（Docker `RestartCount` / PM2 `restarts`）异常增长：需排查根因

## 5. 稳定性测试方案

- **内存泄漏测试**：运行服务，持续调用触发缓存的接口（搜索/推荐/播放/电台），每 5 分钟记录 `/api/health` 的 `heapUsed` 与 `cacheEntries`，确认 24h 内无持续线性增长。
- **高负载测试**：并发压测（如 `ab`/`k6`）播放与搜索接口，确认内存不突破 1GB 上限、无未捕获异常。
- **异常注入测试**：手动 kill 进程 / 触发未捕获异常，验证 Docker 或 PM2 能自动重启且日志记录完整退出信息。
- **网络波动测试**：断网/高延迟下调用多源刷新接口，确认指数退避 + 总超时（15s）生效，不阻塞、不崩溃。
