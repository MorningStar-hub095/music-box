# 后端服务器启动脚本使用说明 (start-server.cjs)

> 独立、可单文件运行的音乐盒子后端服务器启动脚本。该脚本绕过了 `MusicBox-Launcher.exe` 自动启动失败的链路，提供完整的**环境检查 → 配置 → 启动 → 健康检查 → 状态反馈**闭环。

## 1. 脚本概述

- **路径**：`scripts/start-server.cjs`
- **类型**：CommonJS（`.cjs` 后缀，与项目 `package.json` 中 `"type": "module"` 兼容）
- **依赖**：仅依赖 Node.js 内置模块（`child_process`、`path`、`fs`、`net`），脚本本身零外部依赖
- **目标**：解决 `MusicBox-Launcher.exe` 启动后端不可靠的问题，让运维人员能以单一命令可靠启动后端

## 2. 前置条件

| 依赖 | 版本要求 | 检查方式 |
| --- | --- | --- |
| Node.js | ≥ 18.x LTS | `node --version` |
| MySQL | ≥ 5.7 / 8.0 | `mysql --version` 或服务管理器查看 |
| Redis | ≥ 6.x（可选） | `redis-cli ping` |
| `server/node_modules` | 已安装 | 存在 `server/node_modules/` 目录 |
| Prisma Client | 已生成 | 存在 `server/node_modules/.prisma/client/` |
| `server/.env` | 已配置 | 至少包含 `DATABASE_URL` |

如缺失 `server/.env`，脚本会自动从 `server/.env.example` 复制默认配置，但仍建议手工修改数据库密码等参数。

## 3. 使用方法

### 3.1 基本用法

```bash
# 标准启动（推荐）
node scripts/start-server.cjs

# 显示帮助
node scripts/start-server.cjs --help
```

### 3.2 命令行参数

| 参数 | 说明 |
| --- | --- |
| `--skip-checks` | 跳过环境依赖检查（仅在已确认环境就绪时使用，可显著加速启动） |
| `--dev` | 以开发模式启动（使用 `ts-node` 运行 `src/index.ts`，需已安装 `ts-node`） |
| `--foreground` | 前台运行模式，按 `Ctrl+C` 会同时停止子进程（便于调试） |
| `--port <端口>` | 覆盖 `.env` 中的 `PORT` 设置（1–65535） |
| `--verbose` | 输出详细子进程日志（调试用） |
| `-h, --help` | 显示帮助信息 |

### 3.3 常用场景

#### 场景 1：首次启动

```bash
node scripts/start-server.cjs
```

脚本会按顺序执行：
1. Phase 0：检查 Node.js / server 依赖 / MySQL / Redis
2. Phase 1：加载 `.env` 并注入环境变量
3. Phase 2：检查并生成 Prisma Client
4. Phase 3：检查目标端口是否可用，被占用时自动尝试释放
5. Phase 4：启动服务器进程（优先 `dist/index.js`）
6. Phase 5：HTTP 健康检查 `http://localhost:<port>/health`
7. 输出彩色状态总结

#### 场景 2：开发调试

```bash
node scripts/start-server.cjs --dev --foreground --verbose
```

- `--dev`：直接运行 TypeScript 源码，修改后重启
- `--foreground`：Ctrl+C 同步停止子进程，便于反复启动
- `--verbose`：实时显示服务 stdout/stderr

#### 场景 3：自定义端口

```bash
node scripts/start-server.cjs --port 5050
```

#### 场景 4：跳过环境检查（环境已确认就绪）

```bash
node scripts/start-server.cjs --skip-checks
```

⚠️ 风险提示：跳过检查意味着 MySQL / Redis / Prisma Client 都不会被验证，若实际未就绪，服务可能在启动后立即报错。

## 4. 启动状态反馈

脚本输出包含三层反馈：

### 4.1 控制台彩色输出

| 标记 | 含义 |
| --- | --- |
| `[→]` 蓝色 | 步骤进展 |
| `[✓]` 绿色 | 步骤成功 |
| `[!]` 黄色 | 警告（不致命） |
| `[✗]` 红色 | 错误（致命） |
| `[INFO]` 青色 | 信息提示 |

### 4.2 启动状态总结表

启动结束后会输出状态总结表，包含：服务名、端口、PID、健康检查状态、访问地址、日志路径。

### 4.3 日志文件

- **启动日志**：`logs/start-server.log`（记录脚本自身执行过程）
- **服务日志**：`logs/api-server.log`（记录后端服务 stdout/stderr）

## 5. 退出码

| 退出码 | 含义 | 排查建议 |
| --- | --- | --- |
| `0` | 启动成功 | — |
| `1` | 环境检查失败 | 检查 Node 版本、依赖、MySQL |
| `2` | Prisma Client 生成失败 | 手动执行 `cd server && npx prisma generate` |
| `3` | 端口被占用且无法释放 | 手动 `taskkill /F /T /PID <PID>` |
| `4` | 服务启动超时 | 查看 `logs/api-server.log` |
| `5` | 健康检查失败（非致命，仍可能启动成功） | 稍后用 `curl http://localhost:<port>/health` 验证 |
| `99` | 内部异常 | 查看启动日志获取堆栈 |

## 6. 常见问题（FAQ）

### Q1：启动后立即报「MySQL 连接失败 (端口 3306 不可达)」

**原因**：MySQL 服务未运行，或 `server/.env` 中 `DATABASE_URL` 端口配置错误。

**解决**：
1. 检查 MySQL 服务状态：`Get-Service mysql*`（PowerShell）
2. 启动 MySQL 服务：`net start MySQL80`（管理员权限）
3. 验证 `server/.env`：`DATABASE_URL="mysql://root:密码@localhost:3306/music_box"`
4. 注意密码中如有 `+`、`@`、`#` 等特殊字符，需 URL 编码（如 `+` → `%2B`）

### Q2：启动后立即报「Redis 连接失败」

**原因**：Redis 服务未启动（仅警告，不影响启动）。

**解决**：
- Redis 为可选依赖，仅影响缓存与速率限制；如不需要缓存功能可忽略。
- 如需启动 Redis：
  - Linux/macOS：`redis-server`
  - Windows：启动 Redis Windows 服务，或通过 WSL 运行

### Q3：报「端口 49200 被占用 (E004)」

**原因**：上一次启动的服务未正常关闭，残留进程占用端口。

**解决**：
- 脚本会自动尝试 `taskkill /F /T /PID <PID>`，通常无需手动处理。
- 若自动释放失败，可手动执行：
  ```powershell
  netstat -ano | findstr :49200
  taskkill /F /T /PID <上一步得到的PID>
  ```
- 也可使用项目自带工具：`node scripts/kill-ports.js`

### Q4：报「Prisma Client 生成失败」

**原因**：Prisma 二进制引擎下载失败、`schema.prisma` 配置错误、或网络问题。

**解决**：
1. 手动生成查看详细错误：
   ```bash
   cd server
   npx prisma generate
   ```
2. 检查 `server/prisma/schema.prisma` 中 `datasource db` 的 `url` 配置
3. 如因网络问题导致引擎下载失败，可设置镜像：
   ```powershell
   $env:PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"
   ```

### Q5：服务「进程意外退出 (code=1)」

**原因**：服务进程启动后立即报错。

**解决**：
1. 查看服务日志：`logs/api-server.log`
2. 启动时加 `--verbose` 参数查看实时输出：
   ```bash
   node scripts/start-server.cjs --verbose
   ```
3. 常见根因：
   - `MODULE_NOT_FOUND`：`cd server && npm install`
   - `EADDRINUSE`：端口被占用，见 Q3
   - `ER_ACCESS_DENIED`：数据库账号密码错误
   - `ER_BAD_DB_ERROR`：数据库 `music_box` 不存在，需先 `mysql -u root -p < scripts/init_database.sql`

### Q6：健康检查未通过，但服务已启动

**原因**：服务启动较慢（如执行定时任务），健康检查 15 秒内未响应。

**解决**：
- 这只是警告，脚本仍会以退出码 `5` 提示，但服务进程已在后台运行。
- 稍后手动验证：
  ```bash
  curl http://localhost:49200/health
  ```
- 或在浏览器访问：`http://localhost:49200/health`

### Q7：能否让 `MusicBox-Launcher.exe` 调用本脚本？

可以。本脚本与 [scripts/start-api.cjs](../scripts/start-api.cjs) 设计目标一致但功能更完整。

### Q8：脚本输出乱码

**原因**：Windows 终端默认编码为 GBK，但脚本使用 UTF-8 输出 ANSI 颜色码和中文。

**解决**：执行前切换为 UTF-8：
```powershell
chcp 65001
```

## 7. 与现有脚本的关系

| 脚本 | 用途 | 与本脚本关系 |
| --- | --- | --- |
| `scripts/start.js` | 完整开发环境启动（API + Web + Admin + Browse） | 更重型，包含前端服务 |
| `scripts/start-api.cjs` | 轻量级 API 启动 | 本脚本的超集，本脚本增加环境检查与健康检查 |
| `scripts/start-server.cjs` | **独立后端启动（本脚本）** | 自包含、可独立运行、提供完整状态反馈 |

## 8. 故障排查清单

如脚本反复启动失败，按以下顺序排查：

1. ✅ Node.js ≥ 18：`node --version`
2. ✅ 依赖已安装：`ls server/node_modules/`
3. ✅ `.env` 配置正确：`cat server/.env`
4. ✅ MySQL 服务运行中：`Get-Service mysql*`
5. ✅ 数据库存在：`mysql -u root -p -e "SHOW DATABASES;" | grep music_box`
6. ✅ Prisma Client 已生成：`ls server/node_modules/.prisma/client/`
7. ✅ 端口未被占用：`netstat -ano | findstr :49200`
8. ✅ 服务日志无报错：`cat logs/api-server.log`

如以上均正常但服务仍无法启动，建议以 `--foreground --verbose` 模式启动，实时观察服务输出。
