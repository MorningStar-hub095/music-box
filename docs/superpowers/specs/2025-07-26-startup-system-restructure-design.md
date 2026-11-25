# Music Box 启动体系全面重构设计方案

**日期**: 2025-07-26
**状态**: 待实施
**方案**: 混合方案 — 本地 Node.js + Docker 生产部署

---

## 1. 背景与目标

### 1.1 现状问题

当前项目存在两套启动机制，各有不足：

| 机制 | 文件 | 问题 |
|------|------|------|
| `start.bat` | `d:\music_box\start.bat` | Windows 批处理，功能简单，固定等待3秒，无健康检查 |
| `scripts/start.js` | `d:\music_box\scripts\start.js` | Node.js 脚本，功能较完善但与 start.bat 重复维护 |

具体痛点：
- 启动后前端连接失败（API Server 未就绪即打开浏览器）
- 无端口冲突检测（启动后才发现端口被占用）
- 无依赖完整性检查（首次运行容易遗漏 npm install）
- 启动失败无诊断信息（用户不知如何排查）
- 无运行时监控（服务崩溃后无法自动恢复）
- 无 Docker/CI 支持（无法容器化部署）

### 1.2 设计目标

1. **高连接可靠性**：启动后所有服务就绪才允许访问，消除"无法连接服务器"问题
2. **快速启动**：从执行命令到服务就绪 < 10 秒（开发模式）
3. **全场景覆盖**：本地开发 + Docker 生产 + CI/CD 流水线
4. **开发者友好**：首次安装向导 + 结构化错误提示 + 排查指南

### 1.3 范围

- **纳入**: server + web + admin + browse（4个子项目）
- **不纳入**: mini-app（独立 Taro 构建体系）

---

## 2. 架构设计

### 2.1 整体架构

```
用户入口
  │
  ├─ npm run start        ← 开发模式（本地 Node.js 直接启动）
  ├─ npm run start:dev    ← 仅启动 API + Web + Admin
  ├─ npm run start:api    ← 仅启动 API Server
  ├─ npm run start:prod   ← 生产模式（Docker Compose）
  ├─ npm run stop         ← 优雅停止所有服务
  ├─ npm run health       ← 健康检查
  └─ npm run setup        ← 首次安装向导
```

### 2.2 启动编排流程（开发模式）

```
Phase 0: 环境校验（并行）
  ├─ Node.js >= 18 检查
  ├─ MySQL 连通性检查（TCP 3306）
  ├─ Redis 连通性检查（TCP 6379，可选）
  ├─ 端口占用检查（3000/5173/5174/5175）
  └─ 依赖完整性检查（node_modules）

Phase 1: 数据库准备
  ├─ prisma generate（如 Client 不存在）
  └─ prisma migrate dev（开发）/ deploy（生产）

Phase 2: 服务启动
  ├─ API Server 启动 + 就绪等待（HTTP /health 轮询，最多30s）
  └─ 前端服务并行启动（Web/Admin/Browse）
      └─ 各自等待 VITE 就绪日志

Phase 3: 就绪验证
  ├─ API /health → 200
  ├─ Web 5173 可访问
  ├─ Admin 5174 可访问
  └─ Browse 5175 可访问

Phase 4: 运行时监控（持续）
  ├─ 心跳检测（每 30s）
  ├─ 进程存活监控
  └─ 自动重启（可配置 AUTO_RESTART=true）
```

### 2.3 文件结构

```
music_box/
├── package.json                    # 根 scripts 入口
├── start.bat                       # Windows 快捷入口（调用 scripts/start.js）
├── scripts/
│   ├── start.js                    # 核心启动编排器（重写）
│   ├── stop.js                     # 优雅停止（增强）
│   ├── health.js                   # 健康检查服务（新增）
│   ├── env-check.js                # 环境校验模块（新增）
│   ├── setup.js                    # 首次安装向导（新增）
│   ├── install-all.js              # 批量依赖安装（新增）
│   └── build-all.js                # 批量构建（新增）
├── docker-compose.yml              # 生产容器编排（新增）
├── docker-compose.dev.yml          # 开发容器编排（新增）
├── Dockerfile                      # 多阶段构建（新增）
├── nginx/
│   └── default.conf                # Nginx 反向代理配置（新增）
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI/CD 流水线（新增）
├── .env.example                    # 环境变量模板（增强）
├── .env.development                # 开发默认值（新增）
├── docs/
│   ├── setup.md                    # 安装指南（新增）
│   ├── deployment.md               # 部署指南（新增）
│   └── troubleshooting.md          # 排查指南（新增）
├── server/
│   ├── .env                        # 实际配置（.gitignore）
│   └── ...
├── web/
│   ├── ...
│   ├── admin/
│   │   └── ...
│   └── browse/
│       └── ...
└── mini-app/                       # 不纳入本次范围
```

---

## 3. 环境配置策略

### 3.1 环境分层

| 文件 | 用途 | Git 管理 |
|------|------|---------|
| `.env.example` | 完整模板，所有可配置项都有说明 | 提交 |
| `.env.development` | 开发环境默认值 | 提交 |
| `.env.test` | 测试环境配置 | 提交 |
| `.env` | 本地实际配置 | 忽略 |
| `.env.production` | 生产环境 | CI/CD Secrets 注入 |

### 3.2 关键配置项

```bash
# 服务端口
API_PORT=3000
WEB_PORT=5173
ADMIN_PORT=5174
BROWSE_PORT=5175

# 数据库
DATABASE_URL=mysql://root:password@localhost:3306/music_box

# Redis（可选）
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key-at-least-32-chars
JWT_EXPIRES_IN=7d

# 启动行为
AUTO_RESTART=false          # 运行时崩溃自动重启
STARTUP_TIMEOUT=30000       # 服务启动超时（ms）
HEALTH_CHECK_INTERVAL=30000 # 心跳间隔（ms）
MAX_RESTART_ATTEMPTS=3      # 最大重启次数

# 日志
LOG_LEVEL=info
ENABLE_REQUEST_LOGGING=false
```

### 3.3 Redis 降级策略

Redis 在项目中用于缓存（热门歌曲、搜索结果等）。当 Redis 不可用时：
- **开发模式**：打印警告（E003），继续启动，缓存功能降级（直接查数据库）
- **生产模式**：终止启动，要求 Redis 必须可用
- **服务器代码**已有 Redis 连接容错（`ioredis` 自动重连），无需额外修改

### 3.4 端口冲突处理

检测到端口占用时的行为：
1. 打印占用进程信息（PID + 进程名）
2. 提供三个选项：终止占用进程 / 使用替代端口 / 跳过该服务
3. 交互式模式下等待用户选择，非交互模式下自动终止

---

## 4. 启动脚本设计

### 4.1 `scripts/start.js`（核心编排器）

**输入参数**：
- `--dev`：仅启动 API + Web + Admin（不含 Browse）
- `--api-only`：仅启动 API Server
- `--skip-checks`：跳过环境校验
- `--verbose`：详细日志输出

**输出**：
- 控制台彩色输出（chalk）
- 启动性能报告（各阶段耗时）
- 服务状态摘要（端口 + 状态 + PID）

**关键实现**：
- 使用 `child_process.spawn` 启动子进程（非 `exec`，支持长生命周期）
- 子进程 stdout/stderr 管道到控制台 + 日志文件
- 使用 `AbortController` 实现超时控制
- 使用 `signal-exit` 处理优雅退出

### 4.2 `scripts/health.js`（健康检查）

**功能**：
- 单次检查：`npm run health`（打印状态后退出）
- 持续监控：`npm run health --watch`（每30s检查一次）
- 输出 JSON：`npm run health --json`（供 CI/CD 使用）

**检查项**：
- API Server `/health` 端点（200/500/超时）
- 前端服务端口可访问性
- MySQL 连通性
- Redis 连通性
- 磁盘空间
- 内存使用

### 4.3 `scripts/setup.js`（首次安装向导）

**交互流程**：
1. 检测 Node.js 版本 → 不满足则提示安装
2. 检测 MySQL → 不在运行则提示启动
3. 检测 Redis → 不在运行则提示启动（可跳过）
4. 复制 `.env.example` → `.env`（如不存在）
5. 安装所有子项目依赖（并行 `npm install` × 4）
6. 执行 Prisma 迁移 + 生成 Client
7. 导入预设数据（`seed_data.sql`）
8. 打印完成摘要 + 下一步操作指引

### 4.4 `start.bat`（Windows 快捷入口）

简化为调用 Node.js 脚本的包装器：
```batch
@echo off
node "%~dp0scripts\start.js" %*
```

---

## 5. 性能监控机制

### 5.1 启动性能指标

每次启动记录各阶段耗时，输出性能报告：
```
┌──────────────────────────────────────────────┐
│         Startup Performance Report           │
├──────────────────────────────────────────────┤
│  Phase 0: Environment Check    1.2s          │
│  Phase 1: Database Prepare     3.5s          │
│  Phase 2: Service Start                       │
│    ├─ API Server               5.8s          │
│    ├─ Web Player               2.1s          │
│    ├─ Admin                    1.9s          │
│    └─ Browse                   1.8s          │
│  Phase 3: Ready Verification   0.3s          │
├──────────────────────────────────────────────┤
│  Total:                        7.6s          │
│  Bottleneck: API Server (TypeScript compile)  │
└──────────────────────────────────────────────┘
```

### 5.2 运行时健康监控

- 心跳检测：每 30 秒轮询 `/health` 端点
- 连续 3 次失败 → 标记为不健康
- 不健康时自动重启服务（可配置 `AUTO_RESTART=true`）
- 重启次数限制（`MAX_RESTART_ATTEMPTS=3`，防止无限循环）
- 子进程意外退出 → 立即重启 + 通知

### 5.3 日志管理

```
logs/
├── startup.log           # 启动日志
├── server.log            # API Server 输出
├── web.log               # Web Player 输出
├── admin.log             # Admin 输出
├── browse.log            # Browse 输出
└── health.log            # 健康检查日志
```

---

## 6. Docker 生产部署

### 6.1 容器架构

```yaml
services:
  mysql:
    image: mysql:8.0
    volumes:
      - mysql_data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: music_box

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  api:
    build:
      context: .
      target: api-runtime
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_started
    environment:
      DATABASE_URL: mysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/music_box
      REDIS_URL: redis://redis:6379

  web:
    build:
      context: .
      target: web-runtime

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    depends_on:
      - api
      - web
```

### 6.2 Nginx 反向代理

```nginx
server {
    listen 80;
    
    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location / {
        root /usr/share/nginx/html/web;
        try_files $uri $uri/ /index.html;
    }
    
    location /admin/ {
        alias /usr/share/nginx/html/admin/;
        try_files $uri $uri/ /admin/index.html;
    }
    
    location /browse/ {
        alias /usr/share/nginx/html/browse/;
        try_files $uri $uri/ /browse/index.html;
    }
}
```

### 6.3 CI/CD 流水线

**触发条件**：Push to main / Pull Request

**阶段**：
1. **Test**：lint + 单元测试
2. **Build**：Docker 多阶段构建
3. **Deploy**：docker-compose up（仅 main 分支）

---

## 7. 异常处理矩阵

| 异常场景 | 检测方式 | 处理策略 | 错误码 |
|---------|---------|---------|--------|
| Node.js 版本不满足 | `process.version` | 终止 + 提示 | E001 |
| MySQL 未启动 | TCP 连接测试 | 终止 + 提示 | E002 |
| Redis 未启动 | TCP 连接测试 | 警告 + 跳过 | E003 |
| 端口被占用 | netstat 检测 | 询问用户 | E004 |
| 依赖未安装 | node_modules 检查 | 自动安装 | E005 |
| Prisma 迁移失败 | 命令退出码 | 终止 + 日志 | E006 |
| API Server 启动失败 | 30s 超时 | 终止 + 日志 | E007 |
| 前端编译失败 | Vite 错误输出 | 终止 + 日志 | E008 |
| 启动超时 | 定时器 | 终止 + 日志 | E009 |
| 运行时进程崩溃 | 进程退出事件 | 自动重启 | E010 |

每个错误码对应一份排查指南（`docs/troubleshooting.md`）。

---

## 8. 实施计划概要

| 阶段 | 内容 | 文件 |
|------|------|------|
| 1 | 环境校验模块 | `scripts/env-check.js` |
| 2 | 首次安装向导 | `scripts/setup.js` |
| 3 | 核心启动编排器重写 | `scripts/start.js` |
| 4 | 健康检查服务 | `scripts/health.js` |
| 5 | 优雅停止增强 | `scripts/stop.js` |
| 6 | 批量工具脚本 | `scripts/install-all.js`, `scripts/build-all.js` |
| 7 | 根 package.json 更新 | `package.json` |
| 8 | 环境配置文件 | `.env.example`, `.env.development` |
| 9 | Docker 配置 | `Dockerfile`, `docker-compose.yml`, `nginx/` |
| 10 | CI/CD 配置 | `.github/workflows/ci.yml` |
| 11 | 文档 | `docs/setup.md`, `docs/deployment.md`, `docs/troubleshooting.md` |
| 12 | start.bat 简化 | `start.bat` |

---

## 9. 成功标准

1. `npm run setup` 一键完成首次安装（含数据库迁移和预设数据）
2. `npm run start` 从执行到所有服务就绪 < 10 秒
3. 启动后前端零连接失败（健康检查通过后才打开浏览器）
4. 端口冲突自动检测并提供解决方案
5. 服务崩溃后 5 秒内自动重启（可配置）
6. `docker-compose up` 一键启动生产环境
7. CI/CD 流水线自动测试 + 构建 + 部署
8. 所有错误场景都有结构化提示 + 排查指南
