# Music Box Docker 部署指南

> 2026-10-26 更新：数据库统一为 **PostgreSQL**（与 `server/prisma/schema.prisma` 的 provider 一致），
> 原文档中的 MySQL 配置已废弃。

## 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0
- 可用端口：80、3000、5432、6379

## 部署步骤

### 1. 获取项目

```bash
git clone <repository-url>
cd music-box
```

### 2. 配置环境变量

```bash
# 生产环境务必修改以下默认值
export POSTGRES_PASSWORD="your-strong-pg-password"
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
```

或创建 `.env` 文件（与 docker-compose.yml 同目录，勿提交到 git）：

```env
POSTGRES_PASSWORD=your-strong-pg-password
JWT_SECRET=your-random-jwt-secret-at-least-32-characters-long
DESKTOP_API_KEY=your-random-desktop-api-key-at-least-24-chars
```

### 3. 构建并启动

```bash
docker compose up -d --build
```

首次启动需要等待 PostgreSQL 初始化完成（约 10-30 秒），API 服务会自动重试连接。

### 4. 执行数据库迁移

```bash
docker compose exec api npx prisma migrate deploy
```

> 注意：`prisma/migrations/` 中存在历史遗留的 MySQL 方言迁移脚本（`0_init`、
> `20260821_add_listening_events`、`add_search_indexes`）。全新环境首次部署时，
> 建议直接用 `npx prisma migrate deploy` 若报方言错误，则改用
> `npx prisma db push`（全新空库无风险），并重建迁移基线。

### 5. 可选：导入种子数据

```bash
# seed_data.sql 为历史 MySQL 方言导出，PostgreSQL 环境需先转换或改用爬虫采集数据
docker compose exec -T postgres psql -U postgres -d music_box < <转换后的seed文件>
```

### 6. 上线后验证清单（冒烟测试）

| 检查项 | 方法 | 预期 |
|---|---|---|
| API 存活 | `curl http://localhost/health` | 200，含 cacheEntries |
| 注册/登录 | 前端注册新账号并登录 | 成功拿到 token |
| 曲库列表 | 打开主站 | 歌曲正常展示 |
| 搜索 | 搜索中文/拼音关键词 | 有结果、无 500 |
| 音频播放 | 播放任意歌曲、拖拽进度 | 正常播放（Range 206） |
| 每日推荐 | 打开推荐页 | 出现推荐列表 |
| 评论 | 发表/删除一条评论 | 成功，计数正确 |
| 管理后台 | /admin/ 登录、用户列表 | admin 角色可见，普通用户 403 |

### 7. 回滚方案

```bash
# 记录当前镜像（以 git SHA 打标签的构建）
docker compose down
# 回退到上一版本镜像与代码后
docker compose up -d
# 数据库回滚：恢复最近一次备份
docker compose exec -T postgres psql -U postgres -d music_box < backup_latest.sql
```

建议每日定时备份：

```bash
docker compose exec postgres pg_dump -U postgres music_box | gzip > backup_$(date +%F).sql.gz
```

## 服务访问

| 服务 | 地址 | 说明 |
|------|------|------|
| Web 主站 | http://localhost | 音乐播放器 |
| Admin 后台 | http://localhost/admin/ | 管理后台 |
| Browse 浏览 | http://localhost/browse/ | 歌曲浏览 |
| API 服务 | http://localhost:3000 | REST API |
| 健康检查 | http://localhost/health | 服务状态 |

## 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f          # 所有服务
docker compose logs -f api      # 仅 API
docker compose logs -f web      # 仅 Web

# 重启服务
docker compose restart api
docker compose restart web

# 停止所有服务
docker compose down

# 停止并删除数据卷（⚠️ 会清除数据库）
docker compose down -v

# 重新构建并启动
docker compose up -d --build
```

## 仅启动数据库（开发模式）

如果 API 和前端在宿主机原生运行，只需启动 PostgreSQL 和 Redis：

```bash
docker compose -f docker-compose.dev.yml up -d
```

此时数据库连接地址为 `localhost:5432`（与 `server/.env` 的
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/music_box` 一致），Redis 为 `localhost:6379`。

## 架构说明

```
                    ┌──────────┐
                    │  Nginx   │ :80
                    │  (web)   │
                    └────┬─────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
       /admin/      /browse/      /api/
         │              │            │
         ▼              ▼            ▼
    Admin SPA      Browse SPA   ┌──────────┐
                                 │ API Server│ :3000
                                 └─────┬─────┘
                                       │
                           ┌───────────┼───────────┐
                           │                       │
                      ┌────▼─────┐           ┌─────▼─────┐
                      │PostgreSQL│ :5432     │   Redis   │ :6379
                      └──────────┘           └───────────┘
```

## 云服务器部署建议（上云路径）

1. **镜像管理**：以 git SHA 打镜像标签（`docker build -t music-box-api:<sha>`），禁用 latest；
   一次构建、多环境晋升。
2. **密钥**：`JWT_SECRET` / `POSTGRES_PASSWORD` / `DESKTOP_API_KEY` 每环境独立生成，通过
   服务器环境文件或密钥管理服务下发，绝不入库。
3. **HTTPS**：在 Nginx 前加 TLS（Caddy/Traefik 或云 LB 证书），CORS 的 `ALLOWED_ORIGINS`
   改为正式域名白名单。
4. **可观测性**：沿用 `docs/backend-stability-monitoring.md` 的阈值（heapUsed > 512MB 触发
   排查、5 分钟内 >10 条 [STABILITY] 错误需人工介入），对 `/health` 配置拨测告警。
5. **防火墙**：仅放行 80/443 与 SSH（建议密钥登录）；5432/6379 不对公网暴露。
