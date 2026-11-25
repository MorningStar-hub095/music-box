# 音乐盒子（Music Box）

一个全栈音乐播放器项目，包含 **Web 端**（用户端 + 管理后台 + 浏览页）、**Node.js API 服务**、**Electron 桌面版**（内嵌 PostgreSQL，单机自包含）与 **微信小程序端**（Taro + React）。内置 AI 电台（LLM Provider 可插拔）、听歌行为推荐（音乐 DNA / 情绪图谱 / 社交 DNA）与音频缓存加速等特性。

## 功能特性

- 🎵 **音乐播放**：在线曲库 + 音频本地缓存加速（并发安全下载、Range 流式响应）
- 🤖 **AI 电台**：按天气 / 时段 / 用户听歌画像生成主播口播文案，支持 Ollama（本地）/ OpenAI / DeepSeek / 通义千问 / GLM / Kimi 等热切换
- 🧬 **个性化推荐**：基于播放行为的每日推荐、音乐基因组地图、情绪 DNA、社交 DNA 可视化
- 💬 **社区**：评论 / 点赞 / 举报，热度排序
- 🖥 **桌面版**：Electron + 内嵌 PostgreSQL（预初始化集群），双击即用，无需安装数据库
- 📱 **小程序端**：离线曲库 + 本地播放列表（Taro 4 + React）

## 技术栈

| 层 | 技术 |
|---|---|
| API 服务 | Node.js + Express + TypeScript + Prisma + PostgreSQL（缓存为进程内 Map，无需 Redis） |
| Web 主站 | React + Vite + TypeScript |
| 管理后台 / 浏览页 | React + Vite（独立子项目） |
| 桌面端 | Electron 33 + electron-builder（NSIS / Portable）+ embedded-postgres |
| 小程序 | Taro 4 + React |
| AI | LangChain（OpenAI 兼容协议，Provider 可插拔） |
| 部署 | Docker 多阶段构建 + docker-compose（PostgreSQL / Redis / nginx）或 pm2 + nginx |

## 快速开始

### 环境要求

- Node.js ≥ 18
- PostgreSQL 14+ 与 Redis（或直接用 Docker / 桌面版内置）
- Python 3（可选：音源搜索爬虫）

### 1. 安装与启动（开发）

```bash
npm run setup        # 安装各子项目依赖 + prisma generate
npm run start:dev    # 启动 API + Web（开发模式）
# 或
npm start            # 生产模式启动
```

端口规划：`49200` API（同时托管 Web 构建产物）/ `49201` Web / `49202` Admin / `49203` Browse。
健康检查：`GET http://localhost:49200/api/health`。

### 2. Docker 部署

```bash
docker compose up -d --build   # postgres + api + nginx(web/admin/browse)
```

- PostgreSQL 仅绑定 `127.0.0.1`，Web 入口为 nginx `80` 端口（缓存为进程内 Map，无需 Redis）
- 生产环境务必通过环境变量注入 `JWT_SECRET` 与 `POSTGRES_PASSWORD`（见 `.env` 系列）
- 全新部署后可注入演示曲库（12 首自有曲库元数据，无第三方内容）：

```bash
cd server && DATABASE_URL="postgresql://..." npm run seed:demo
```

- 想让演示曲库可播放：把你有权分发的音频放入 `local-music/`（见 `local-music/README.md`）

### 3. 桌面版打包（Windows）

```bash
cd desktop
npm run stage     # 组装 server dist + web dist + 生产依赖 + prisma 引擎（含产物新鲜度检查，--force 可跳过）
npm run dist      # electron-builder 产出 NSIS 安装包 + Portable（release/ 目录）
```

图标：`desktop/build/icon.ico`（Windows exe/安装包）与 `icon.png` / `icon-64.png`（跨平台展示）。

### 4. 微信小程序

```bash
cd mini-app
npm install
npm run build:weapp   # 产物在 dist/，用微信开发者工具打开本项目目录
```

> 注意：`project.config.json` 当前为游客 appid，正式发布需替换为真实 appid；曲库数据体积较大，上线前需按分包规范拆分（详见 `docs/`）。

## 演示模式与自有版权曲库

公网演示部署时，请设置 `DEMO_MODE=true`（docker-compose 已支持）：

- **关闭**第三方音频的播放、预下载与缓存（`/api/audio/*`、`/api/refresh-track/*`、`/api/cache/download` 返回 403）——本项目的第三方音源来自公开爬取的临时直链，公开分发存在版权风险；
- 浏览、搜索、收藏、歌单、AI 电台文案等非音频功能不受影响；
- 唯一音频来源为 **自有版权曲库**：把你有权分发的音频放入 `local-music/` 并配置 `library.json`，经 `/api/library/tracks` 与 `/api/library/audio/:file` 提供（支持 Range，详见 `local-music/README.md`）；
- Web 主站会自动展示"演示模式"横幅（读取 `GET /api/config`）。

非演示环境（本地/私有部署）行为不变。

## 环境变量

- `server/.env`：`DATABASE_URL`、`JWT_SECRET`（生产必须为强随机值）、`PORT`、LLM 相关（`LLM_PROVIDER` / `OPENAI_API_KEY` / `OLLAMA_BASE_URL` 等），参考 `server/.env.example`
- 根目录 `.env.development`：各服务端口等开发默认值
- Docker 部署：复制 `.env.docker.example` 为根目录 `.env`（`POSTGRES_PASSWORD`、`JWT_SECRET` 必填；可选 `DEMO_MODE`）

## 项目结构

```
server/    API 服务（Express + Prisma + LLM 集成）
web/       Web 主站 + admin + browse（三个 Vite 子项目）
desktop/   Electron 桌面版（main.js + scripts/stage.js 打包暂存）
mini-app/  微信小程序（Taro）
scripts/   启动/停止/健康检查/端口管理等运维脚本
nginx/     Docker 部署用 nginx 配置
docs/      设计文档、检查报告、面试材料等
shared/    前后端共享类型与数据
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run start` / `start:dev` / `start:api` | 启动（生产 / 开发 / 仅 API） |
| `npm run stop` / `restart` | 停止 / 重启服务 |
| `npm run health` | 健康检查 |
| `npm run build:all` | 构建 server + web + admin + browse |
| `npm run kill-ports` | 释放项目端口（仅终止 LISTENING 中目标端口的进程） |
| `npm run troubleshoot` | 环境诊断 |

## 文档

更多设计与分析文档见 [`docs/`](./docs/)（架构、推荐算法、检查报告等）。

## License

[MIT](./LICENSE)
