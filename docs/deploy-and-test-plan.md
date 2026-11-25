# 音乐盒子 · 封装打包、部署与测试方案

> 适用版本：v1.1.0 ｜ 编写日期：2026-10-27
> 技术栈：Node 18+ / TypeScript 5 / Express 4 + Prisma 5.22（PostgreSQL 16）/ React 18 + Vite 5 + Three.js / Taro 4 微信小程序 / Python 3.10+（爬虫工具）/ Docker Compose + Nginx
> 核心理念：**一切皆自动化、一切皆可回滚、一切皆可观测**

---

## 〇、总体架构与环境矩阵

```
┌────────────────────────── Nginx (80) ──────────────────────────┐
│  /        → web 主站静态资源 (React SPA)                        │
│  /admin/  → 管理后台静态资源                                    │
│  /browse/ → 浏览页静态资源                                      │
│  /api/    → 反向代理 → Express API (3000)                       │
│  /health  → 反向代理 → API 健康检查                             │
└─────────────────────────────────────────────────────────────────┘
        │                                    │
  PostgreSQL 16 (5432)                 Redis 7 (6379)
  33 张数据表 / Prisma 迁移            缓存（天气/歌单三级缓存）
        │
  本地目录挂载：音频缓存 data/audio-cache/、日志 server/logs/
```

| 环境 | 用途 | 数据库 | 域名/端口 | 部署方式 |
|------|------|--------|-----------|----------|
| dev | 日常开发 | 本机 PG (5432) | API :49200 / Web :49201 | `npm run dev`（ts-node + Vite HMR） |
| staging（本机生产验证） | 发布前全量验证 | Docker PG | 容器 80/3000 | Docker Compose |
| production | 正式服务 | 云 PG 或容器 PG | 域名 + TLS | Docker Compose（镜像 SHA 锁定） |

> ⚠️ 三环境凭据必须完全独立：每环境单独的 `JWT_SECRET` 与 `POSTGRES_PASSWORD`，严禁复用。

---

## 一、项目依赖梳理与环境准备

### 1.1 运行时依赖清单

| 组件 | 版本要求 | 用途 | 验证命令 |
|------|---------|------|---------|
| Node.js | ≥ 18（容器内 node:18-alpine） | server 构建/运行、web 构建 | `node -v` |
| npm | ≥ 9 | 依赖管理（需 `--legacy-peer-deps`） | `npm -v` |
| PostgreSQL | 16（alpine） | 主数据库（33 表，Prisma provider=postgresql） | `psql --version` / 容器 `pg_isready` |
| Redis | 7（alpine） | 缓存 | `redis-cli ping` |
| Python | ≥ 3.10 | tools/ 爬虫（netease_crawler 等） | `python --version` |
| Docker + Compose v2 | 24+ / v2.20+ | 容器化部署 | `docker compose version` |

### 1.2 依赖拓扑（谁依赖谁）

```
root package.json        → 编排脚本（start/stop/health/build:all/setup）
├─ server/  Express+Prisma+LangChain+zod   ← 依赖 PostgreSQL、Redis、.env
├─ web/     React+Vite+Three.js（含 admin/、browse/ 两个子应用） ← 依赖 server API
├─ mini-app/ Taro 4（仅构建 weapp 时需要）  ← 依赖 server API 地址
├─ shared/  被 web 与 mini-app 引用的公共 TS/JSON（构建期拷入，无运行时依赖）
└─ tools/   Python 爬虫（netease_crawler.py 等）← 依赖 Python + 网络
```

> ⚠️ **已知约束**：`langchain` 的 peer 依赖要求 `zod@3`，而本项目使用 `zod@4`，安装必须带 `--legacy-peer-deps`（已在 `server/.npmrc` 固化）。CI 与 Docker 构建中同样生效。

### 1.3 环境准备步骤（每步含验证）

```bash
# ① 克隆/拉取代码后，检查 .env 是否就绪（.env 不入库，见 §4.5 密钥管理）
cp server/.env.example server/.env        # 首次准备
# 必填项：DATABASE_URL / JWT_SECRET / PORT
#   JWT_SECRET 生成（≥64 位随机）：
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ② 一键安装全部子项目依赖
npm run install:all
# 验证：四个 node_modules 目录均生成
ls server/node_modules web/node_modules web/admin/node_modules web/browse/node_modules

# ③ 生成 Prisma Client + 校验 schema
cd server && npx prisma generate && npx prisma validate
# 验证：无报错，node_modules/.prisma/client 生成

# ④ 数据库迁移（staging/production 首次）
npx prisma migrate deploy
# 验证：psql 查询表数量应约为 33
#   docker exec music-box-postgres psql -U postgres -d music_box -c "\dt" | wc -l

# ⑤ 环境自检（项目自带）
npm run setup     # 首次配置向导
npm run health    # 运行中服务的健康检查
# 验证：health 输出 api/web 状态均为 ok
```

---

## 二、打包方式及配置说明

### 2.1 四条产物线

| # | 产物 | 命令 | 输出位置 | 验证方法 |
|---|------|------|---------|---------|
| 1 | API 服务 | `cd server && npm run build`（tsc） | `server/dist/` | `node dist/index.js` 可启动且 `/health` 200 |
| 2 | Web 主站 + admin + browse | `cd web && npm run build`（tsc && vite build） | `web/dist/`、`web/admin/dist/`、`web/browse/dist/` | `npm run preview` 打开无白屏；控制台无报错 |
| 3 | 微信小程序 | `cd mini-app && npm run build:weapp` | `mini-app/dist/` | 微信开发者工具导入 dist，编译通过、真机预览 |
| 4 | Docker 镜像 | `docker compose build` | 本地镜像（见 2.4 打标签） | `docker images` 见新 SHA 标签镜像 |

> 💡 根目录 `npm run build:all`（scripts/build-all.js）可一次跑完 1+2。

### 2.2 构建前检查门禁（fail fast，顺序不可变）

```bash
# ① lint（当前基线：0 error，warning 不阻塞）
cd server && npm run lint
# ② 后端单元测试（24 套件 / 133 用例，全绿才允许出包）
npm test
# ③ 前端类型检查 + 单测
cd ../web && npx tsc --noEmit && npm test   # vitest
# 验证：三条命令退出码均为 0；任何 flaky 测试要么修复要么删除，不得跳过
```

### 2.3 配置说明

**server/.env（运行时配置，不入库）**

| 变量 | 说明 | 生产要求 |
|------|------|---------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/music_box` | 使用环境独立凭据；容器网络内 host 为 `postgres` |
| `JWT_SECRET` | JWT 签名密钥 | ≥64 位随机 hex，**严禁**使用示例默认值 |
| `PORT` | API 端口 | 容器内固定 3000，由 Nginx 反代 |
| `ALLOWED_ORIGINS` | CORS 白名单 | 填真实域名，禁用 `*` 与 `file://` |
| `LLM_PROVIDER`/`OPENAI_API_KEY` 等 | LLM 功能可选 | 密钥不入库，生产用编排层 secrets 注入 |

**web 构建期环境变量**：`VITE_API_BASE` / `VITE_API_PORT` 决定 API 地址。
- 生产走 Nginx 同域反代时**不设置**（前端用相对路径 `/api`）；跨域部署时设为完整 URL。
- 验证：构建后 `grep -r "VITE_API" web/dist/assets/*.js` 确认注入值。

**Nginx（nginx/default.conf）**：已配好 `/api/` 反代、`/admin/`、`/browse/` 别名路由、SPA `try_files`、静态资源 30 天缓存。`client_max_body_size 10m` 如需上传更大文件需调整。

### 2.4 Docker 镜像打包（多阶段构建，推荐生产方式）

```bash
# 获取版本标识（禁止使用 latest 追踪生产版本）
GIT_SHA=$(git rev-parse --short HEAD)

# 构建两个目标镜像
docker build --target api-runtime -t music-box-api:${GIT_SHA} .
docker build --target web-runtime -t music-box-web:${GIT_SHA} .

# 验证镜像
docker images | grep music-box   # 应出现带 SHA 标签的两条记录
docker run --rm music-box-api:${GIT_SHA} node -e "console.log('ok')"
```

> ⚠️ **注意**：Dockerfile 第 45-54 行会构建 `web/admin` 与 `web/browse` 子应用，若某一子应用暂时不发布，需注释对应 stage，否则构建失败会阻塞整条产物线。
> 💡 镜像体积优化（可选）：api-runtime 当前复制了完整 `node_modules`（含 devDependencies），可在 builder 中加 `npm prune --omit=dev` 后再拷贝，预计体积减半。

### 2.5 产物归档（发布工件）

```
release/${GIT_SHA}/
├── music-box-api.tar        # docker save music-box-api:${GIT_SHA} -o ...
├── music-box-web.tar
├── server-dist.zip          # 无 Docker 环境的备用裸机产物
├── web-dist.zip
└── MANIFEST.txt             # git SHA、构建时间、node 版本、测试结果摘要
```

---

## 三、部署流程（含目标环境与回滚策略）

### 3.1 方案 A：Docker Compose（推荐，staging 与 production 通用）

**首次部署**

```bash
# ① 准备环境变量文件（不入库！）
cat > .env.production <<'EOF'
POSTGRES_PASSWORD=<强随机密码>
JWT_SECRET=<64位随机hex>
ALLOWED_ORIGINS=https://your-domain.com
EOF

# ② 启动数据库与缓存，等待健康检查通过
docker compose up -d postgres redis
docker compose ps          # 验证：postgres 状态 (healthy)

# ③ 执行数据库迁移（一次性任务）
docker compose run --rm api npx prisma migrate deploy
# 验证：输出 "No pending migrations" 或迁移成功 applied

# ④ 启动 API 与 Web
docker compose up -d api web
# ⑤ 全栈健康验证
curl -s http://localhost/health | jq      # 验证：{"status":"ok"}
curl -s http://localhost/api/songs?limit=1 | jq '.success'   # 验证：true
```

**升级部署（一次构建、多环境晋升）**

```bash
# ① 发布前自动备份（强制，不可跳过）
docker exec music-box-postgres pg_dump -U postgres music_box \
  | gzip > backups/db_$(date +%Y%m%d_%H%M%S).sql.gz
# 验证：文件 > 0 且 gunzip -t 通过

# ② 拉取新镜像（以 SHA 追踪）并滚动替换
docker compose pull
docker compose up -d api web
# 验证：docker compose ps 全部 Up/healthy；新 SHA 与 MANIFEST 一致

# ③ 部署后冒烟（见 §5.3 接口冒烟清单，全过才算成功）
```

### 3.2 方案 B：裸机 PM2（Windows 本机 / 无 Docker 环境）

```bash
cd server
npm run build                          # 产出 dist/
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup                # 开机自启
# 验证：pm2 status 为 online；curl http://localhost:49200/api/health 200
```
> ⚠️ `ecosystem.config.js` 已移除硬编码端口，端口由 `.env` 的 `PORT` 控制（本机为 49200），与容器内 3000 区分。

### 3.3 回滚策略（每个部署动作都必须有回滚预案）

| 故障类型 | 回滚操作 | 验证方法 |
|---------|---------|---------|
| 新镜像异常 | `docker compose down api && docker run -d ... music-box-api:<旧SHA>`（或改 compose 引用旧 tag 后 `up -d`） | `/health` 200 + 冒烟清单通过 |
| 迁移出错（未写入业务数据） | `npx prisma migrate resolve --rolled-back <name>` 后修复重跑 | `prisma migrate status` 无失败记录 |
| 迁移出错（已污染数据） | **停服** → `gunzip < backups/db_xxx.sql.gz \| docker exec -i music-box-postgres psql -U postgres -d music_box` | 关键表行数与备份前一致 |
| 配置错误 | `git checkout <旧SHA> -- docker-compose.yml nginx/` 后 `docker compose up -d` | 冒烟清单通过 |
| 全站不可用 | 整体 `docker compose down` → 用上一版 `release/<旧SHA>/` 的 tar 重新 `docker load` + `up -d` | `docker compose ps` + 冒烟 |

> ⚠️ **回滚演练**：staging 环境每季度执行一次完整回滚演练（人为部署坏镜像 → 走 3.3 表回滚 → 记录耗时，目标 < 5 分钟）。

### 3.4 上线前检查单（Checklist）

- [ ] lint / 后端 133 用例 / 前端 tsc+vitest 全绿
- [ ] 镜像以 git SHA 标签，MANIFEST 已归档
- [ ] `.env.production` 三项密钥为环境独立强随机值
- [ ] 数据库备份完成且可解压校验
- [ ] `ALLOWED_ORIGINS` 已更新为生产域名
- [ ] staging 全量冒烟通过后才晋升 production

---

## 四、测试验证步骤

### 4.1 单元 / 集成测试（CI 门禁）

```bash
cd server && npm test          # Jest：24 套件 133 用例（服务层 + 路由 supertest）
npm run test:coverage          # 覆盖率报告 → coverage/lcov-report/index.html
cd ../web && npm test          # Vitest + Testing Library
# 验证：退出码 0；覆盖率关注 modules/ 目录核心服务 ≥ 现有基线，不回退
```

### 4.2 接口冒烟清单（部署后必跑，5 分钟内完成）

```bash
BASE=http://localhost   # 容器化经 Nginx；裸机改 http://localhost:49200

# ① 健康检查
curl -sf $BASE/health | grep -o '"status":"ok"'
# ② 曲库（核心读路径）
curl -sf "$BASE/api/songs?limit=3" | grep -o '"success":true'
# ③ 歌词字段（舞台歌词依赖此链路）
curl -sf "$BASE/api/songs/netease:28059417" | grep -c lyricContent
# ④ 搜索
curl -sf "$BASE/api/search?keyword=张杰" | grep -o '"success":true'
# ⑤ 天气电台（三级缓存 + Open-Meteo 外联）
curl -sf "$BASE/api/weather/playlist?city=北京" | grep -o '"success":true'
# ⑥ 认证（访客登录发 token）
curl -sf -X POST $BASE/api/auth/guest | grep -o '"token"'
# ⑦ Web 静态资源与 SPA 路由
curl -sf -o /dev/null -w "%{http_code}\n" $BASE/            # 200
curl -sf -o /dev/null -w "%{http_code}\n" $BASE/admin/      # 200
```
> ⚠️ 每条命令的预期输出都写在注释里；任何一条失败即回滚（§3.3），不带病上线。

### 4.3 功能验收（人工，按用户旅程走查）

| 模块 | 验收路径 | 通过标准 |
|------|---------|---------|
| 播放核心 | 首页→继续听→播放/暂停/上下曲/拖进度 | 出声、进度条同步、无控制台报错 |
| 沉浸舞台 | 播放中按 F 进入 | 粒子随节拍律动、**歌词滚动高亮正确**、点击歌词行跳转、ESC 退出 |
| 歌词链路 | 从每日推荐播放→进舞台 | 有歌词（按需补取生效） |
| 搜索 | 搜索→播放→加入歌单 | 结果正确、可播放、入队成功 |
| 天气电台 | 输入城市→队列预览→入队 | 返回真实天气对应歌单，二次请求走缓存（响应 <100ms） |
| 视觉控制台 | DIY→切预设→存档→导出/导入 | 切换即时生效，localStorage 持久化 |
| 管理后台 | /admin/ 登录→曲目管理 | CRUD 正常 |
| 小程序 | 开发者工具+真机 | 编译零错误、播放/歌词可用 |

### 4.4 性能测试

```bash
# 接口压测（autocannon，npx 免安装）
npx autocannon -d 30 -c 50 http://localhost/api/songs?limit=20
# 通过线：p99 < 300ms、错误率 0、QPS 满足预期日活的 5 倍峰值

# 音频代理并发（走本地缓存命中路径）
npx autocannon -d 30 -c 20 http://localhost/api/audio/netease%3A28059417
# 通过线：p99 < 500ms（CDN 回源场景放宽至 1s）

# 前端体验（Chrome DevTools → Lighthouse，生产构建 preview 模式）
npx lighthouse http://localhost --view
# 通过线：Performance ≥ 80；首屏 LCP < 2.5s
# 注意：web/dist 含大量静态资源（当前 ~37MB，其中含音频/图片），确认 Nginx 30 天缓存生效：
curl -sI http://localhost/assets/xxx.jpg | grep -i cache-control   # public, immutable
```

### 4.5 可观测性验证

```bash
docker compose logs -f api          # 结构化日志落盘 api_logs 卷
docker compose ps                    # 两容器 healthy（内置 healthcheck 30s 探测）
ls server/logs/                      # 文件日志按日期滚动
```
建议后续接入：UptimeRobot/自建探针监控 `/health`（面向症状告警：连续 3 次 5xx 或探针失败才告警，每条告警必须可操作）。

---

## 五、常见问题与注意事项

### 5.1 构建与依赖

| 现象 | 原因 | 处理 |
|------|------|------|
| `npm install` 报 ERESOLVE | langchain peer 要求 zod@3 | 加 `--legacy-peer-deps`（.npmrc 已固化，CI 同样生效） |
| Docker 构建 admin/browse 失败 | 子应用缺 lock 文件或暂不发布 | 注释对应 stage（§2.4） |
| `prisma generate` 找不到命令 | 容器内无全局 npx 缓存 | 用 `node node_modules/prisma/build/index.js generate`（package.json 已内置） |
| tsc 报 shared/parseLrc 不存在 | shared 不在编译范围 | web 由 vite 处理无此问题；mini-app 需 config/index.ts `compile.include`（已修） |

### 5.2 运行时

| 现象 | 原因 | 处理 |
|------|------|------|
| API 起不来：`P1001 can't reach database` | PG 未健康即启动 api | compose 已有 `condition: service_healthy`；裸机先起 PG 再起 API |
| 序列冲突：插入报 duplicate key | PG 自增序列落后于 max(id) | `SELECT setval(pg_get_serial_sequence('表名','id'), (SELECT max(id) FROM 表名));`（listening_events/users 曾中招） |
| 401 全线失败 | JWT_SECRET 与签发时不一致 | 环境变量持久化，勿每次重启随机生成 |
| CORS 报错 | ALLOWED_ORIGINS 未含前端域名 | 改 env 后 `docker compose up -d api` 重建 |
| 舞台无歌词 | 播放源入队时歌词为空 | 已实现按需补取（GET /api/songs/:id 回填）；确认该接口返回 lyricContent |
| 音频 404 | 音频缓存目录未挂载/被清理 | 容器挂载 `data/audio-cache`；或 POST /api/songs/refresh-track 刷新临时 URL |
| Vite 只监听 IPv6，127.0.0.1 不通 | dev server 绑定问题 | `npm run dev -- --host` 双栈绑定 |

### 5.3 安全与合规（红线）

- **密钥**：`.env`、备份 SQL、镜像内不得出现任何真实密钥；`.gitignore` 覆盖 `.env*`、`backups/`、`release/`。
- **镜像**：生产一律 git SHA 标签；`postgres:16-alpine` 等基础镜像定期升级修 CVE；容器非必要不 `-it` 进入，禁止 SSH 手工修复生产——一切变更走版本化配置。
- **数据**：用户 Cookie/听歌数据仅存本机或自有库（项目隐私声明要求）；每日 `pg_dump` 定时任务 + 异地留存 ≥ 7 天。
- **TLS**：生产域名全链路 HTTPS（Nginx 前置或云 LB 终结），`X-Forwarded-Proto` 已透传。

### 5.4 发布节奏建议

1. **日常**：PR → CI 门禁（lint + 单测）→ 合并主干
2. **发布**：打 tag（如 `v1.2.0`）→ 构建 SHA 镜像 → staging 全量验证（§4.2-4.4）→ 晋升 production
3. **复盘**：每次回滚/事故 48h 内出无责复盘，补充本档对应章节

---

## 附：一页纸快速命令

```bash
# 全量验证（提交前）
cd server && npm run lint && npm test && cd ../web && npx tsc --noEmit && npm test

# 打包
docker build --target api-runtime -t music-box-api:$(git rev-parse --short HEAD) .
docker build --target web-runtime -t music-box-web:$(git rev-parse --short HEAD) .

# 部署（生产）
docker compose --env-file .env.production up -d postgres redis
docker compose run --rm api npx prisma migrate deploy
docker compose --env-file .env.production up -d api web
curl -sf http://localhost/health

# 回滚
docker exec music-box-postgres pg_dump -U postgres music_box | gzip > backups/pre.sql.gz
# → 换回旧 SHA 镜像 → docker compose up -d → 冒烟
```
