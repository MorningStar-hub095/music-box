# 数据库访问工具使用说明 (db-tool.cjs)

> 基于 Prisma Client 的安全数据库访问脚本，提供连接验证、用户身份认证、数据查询等只读操作能力。适用于运维排查、数据校验、用户身份验证等场景。

## 1. 脚本概述

- **路径**：`scripts/db-tool.cjs`
- **类型**：CommonJS（与项目 `package.json` 中 `"type": "module"` 兼容）
- **数据库访问方式**：通过 Prisma Client（参数化查询，杜绝 SQL 注入）
- **安全策略**：
  - 默认所有写操作均被禁用（需 `--allow-write` 显式开启）
  - 用户密码不会以明文返回
  - 敏感字段（`passwordHash`、`resetToken`、`securityAnswer`）默认隐藏
  - 所有操作记录到 `logs/db-tool.log`

## 2. 前置条件

| 依赖 | 要求 |
| --- | --- |
| Node.js | ≥ 18.x LTS |
| `server/node_modules` | 已安装（包含 `@prisma/client`、`bcryptjs`、`jsonwebtoken`） |
| Prisma Client | 已生成（`server/node_modules/.prisma/client/`） |
| `server/.env` | 已配置 `DATABASE_URL`、`JWT_SECRET` |
| MySQL | 已运行且 `music_box` 数据库存在 |

如 Prisma Client 未生成，脚本会自动尝试执行 `npx prisma generate`。

## 3. 命令列表

```
ping                              验证数据库连接
auth <用户名>                     交互式密码输入并验证身份（推荐）
login <用户名> <密码>             验证用户身份（命令行模式，不推荐）
users [--limit N] [--role R]      列出用户
user <id>                         查询指定用户详情
songs [--limit N] [--offset N]    列出歌曲
    [--search 关键词] [--platform 平台]
song <id>                         查询指定歌曲详情
stats                             数据库统计
tables                            列出所有表（仅元数据）
help                              显示帮助信息
```

## 4. 全局选项

| 选项 | 说明 |
| --- | --- |
| `--json` | 以 JSON 格式输出（便于脚本处理） |
| `--allow-write` | 允许写操作（默认只读；仅 `auth` 命令在登录成功后更新 `lastLoginAt` 时需要） |
| `--verbose` | 显示详细日志与堆栈 |

## 5. 使用示例

### 5.1 验证数据库连接

```bash
node scripts/db-tool.cjs ping
```

输出示例：

```
[→] 验证数据库连接...
[INFO] DATABASE_URL: mysql://root:***@localhost:3306/music_box
[✓] 数据库连接成功 (45ms)
  服务器时间: 2026-08-06 13:25:18
  MySQL 版本: 8.0.36
  当前数据库: music_box
```

### 5.2 用户身份认证（推荐：交互式）

```bash
node scripts/db-tool.cjs auth admin
```

脚本会提示输入密码（**输入时不会显示在屏幕上**），校验成功后输出：

```
[→] 验证用户身份: admin
请输入密码:
[✓] 身份认证成功 ✓
  用户ID:    1
  用户名:    admin
  邮箱:      admin@musicbox.local
  角色:      super_admin
  状态:      active
  ...
  JWT Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

如需在登录成功后同时更新 `lastLoginAt`，添加 `--allow-write`：

```bash
node scripts/db-tool.cjs auth admin --allow-write
```

### 5.3 用户身份认证（命令行模式，不推荐）

```bash
node scripts/db-tool.cjs login admin mypassword
```

⚠️ **安全警告**：命令行参数会出现在进程列表与 Shell 历史中，仅用于自动化脚本测试。生产环境请使用 `auth` 交互式输入。

### 5.4 列出用户

```bash
# 列出前 20 个用户
node scripts/db-tool.cjs users --limit 20

# 仅列出 admin 角色用户
node scripts/db-tool.cjs users --role admin

# 以 JSON 输出（便于 jq 等工具处理）
node scripts/db-tool.cjs users --json | jq '.[] | .username'
```

### 5.5 查询用户详情

```bash
node scripts/db-tool.cjs user 1
```

输出包含用户基本信息、密保问题、播放列表数、聆听事件数、推荐记录数等。

### 5.6 列出歌曲

```bash
# 列出最新 20 首歌
node scripts/db-tool.cjs songs --limit 20

# 搜索标题/歌手/专辑包含"夜"的歌
node scripts/db-tool.cjs songs --search 夜 --limit 10

# 仅列出 netease 平台歌曲，跳过前 50 首
node scripts/db-tool.cjs songs --platform netease --offset 50 --limit 20
```

### 5.7 查询歌曲详情

```bash
node scripts/db-tool.cjs song 18273
```

### 5.8 数据库整体统计

```bash
node scripts/db-tool.cjs stats
```

输出包含：用户总数、活跃用户、歌曲总数、可播放歌曲数、播放列表数、爬虫日志数、聆听事件数、每日推荐数、操作日志数。

### 5.9 列出所有表

```bash
node scripts/db-tool.cjs tables
```

通过 `information_schema.TABLES` 查询，输出表名、行数（估算）、数据大小、创建时间。此命令**无需认证**，仅返回元数据。

## 6. 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 参数错误 |
| `2` | 数据库连接失败 |
| `3` | 认证失败（用户不存在/密码错误/账号被禁用） |
| `4` | Prisma Client 错误 |
| `99` | 内部异常 |

## 7. 安全设计说明

### 7.1 SQL 注入防护

所有数据库访问均通过 Prisma Client，使用参数化查询。脚本中**不包含任何字符串拼接 SQL**。

唯一的 `$queryRaw` 调用位于 `cmdPing` 与 `cmdTables`，使用的是 Prisma 的**标签模板字面量**语法（`` prisma.$queryRaw`SELECT 1 AS ok` ``），同样会被自动参数化。

### 7.2 密码安全

- `auth` 命令使用 `readline` 模块读取密码，并通过 `setRawMode(true)` 阻止字符回显
- 密码使用 `bcryptjs` 进行校验（与服务器端 `auth.service.ts` 使用相同算法与 salt rounds=10）
- 密码永远不会出现在任何输出中，包括日志文件

### 7.3 敏感字段保护

所有用户查询的 `select` 子句均显式排除以下字段：
- `passwordHash`
- `resetToken`
- `resetTokenExpiresAt`
- `securityAnswer`

### 7.4 JWT 密钥复用

`auth` 命令签发的 JWT Token 使用 `server/.env` 中的 `JWT_SECRET`，**与后端服务器签发的 Token 完全兼容**。这意味着你可以用 `db-tool.cjs auth` 获取的 Token 直接调用后端 API 进行测试：

```bash
# 1. 获取 Token
TOKEN=$(node scripts/db-tool.cjs auth admin --json | jq -r '.token')
# 2. 用该 Token 调用 API
curl -H "Authorization: Bearer $TOKEN" http://localhost:49200/api/users/me
```

### 7.5 写操作保护

默认所有写操作均被禁用。当前实现中唯一需要写操作的场景是 `auth` 命令成功后更新 `lastLoginAt`。

未添加 `--allow-write` 时，`auth` 命令会跳过此更新但仍返回成功（退出码 `0`）。

未来扩展其他写命令（如创建用户、修改密码）时，应统一受 `--allow-write` 控制。

### 7.6 操作日志

所有认证相关操作（成功/失败）均记录到 `logs/db-tool.log`，包含时间戳、用户名、失败原因（如 `user_not_found`、`password_mismatch`）。可用于安全审计。

## 8. 常见问题（FAQ）

### Q1：执行 `ping` 报「Prisma Client 初始化失败: 未找到 @prisma/client」

**原因**：`server/node_modules` 未安装或损坏。

**解决**：
```bash
cd server
npm install
npx prisma generate
```

### Q2：执行 `auth` 报「用户不存在」

**原因**：用户名拼写错误，或数据库中尚无该用户。

**解决**：
1. 列出所有用户：`node scripts/db-tool.cjs users --limit 100`
2. 或查询数据库：`mysql -u root -p music_box -e "SELECT id, username FROM users;"`
3. 如需创建用户，可通过 API `/api/auth/register` 注册

### Q3：执行 `auth` 报「密码错误」但确认密码正确

**原因**：
- 数据库中存储的是 bcrypt 哈希，可能与输入的明文不匹配
- 终端编码问题导致中文密码被转码

**排查**：
1. 直接通过 API 验证：`curl -X POST http://localhost:49200/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"yourpass"}'`
2. 如 API 也失败，说明密码确实错误，可使用 `init_database.py` 重置
3. 如 API 成功但本脚本失败，请提交 issue 并附上 `--verbose` 输出

### Q4：Windows 终端密码输入无回显但看起来像卡住了

**说明**：这是**正常行为**。脚本通过 `setRawMode(true)` 阻止了字符回显，输入完成后按回车即可。

### Q5：能否在 CI/CD 中使用？

可以。`--json` 选项专为脚本化场景设计：

```bash
# 等待数据库就绪（CI 中常见用法）
until node scripts/db-tool.cjs ping --json > /dev/null 2>&1; do
  echo "等待数据库..."
  sleep 2
done

# 检查用户数（如为 0 则初始化）
USER_COUNT=$(node scripts/db-tool.cjs stats --json | jq '.users')
if [ "$USER_COUNT" -eq 0 ]; then
  echo "无用户，执行初始化..."
  python scripts/init_database.py
fi
```

### Q6：报「ER_ACCESS_DENIED_ERROR: Access denied for user 'root'@'localhost'」

**原因**：`server/.env` 中 `DATABASE_URL` 的密码错误。

**解决**：
1. 用相同账号密码登录 MySQL 验证：`mysql -u root -p`
2. 如忘记密码，可重置：
   - Windows：参考 `scripts/reset_mysql_password.sql`
   - Linux：`sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'newpassword';"`
3. 更新 `server/.env` 中 `DATABASE_URL`
4. 注意密码中特殊字符需 URL 编码（如 `+` → `%2B`，`@` → `%40`，`#` → `%23`）

### Q7：报「ER_BAD_DB_ERROR: Unknown database 'music_box'」

**原因**：数据库 `music_box` 尚未创建。

**解决**：
```bash
mysql -u root -p -e "CREATE DATABASE music_box CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cd server
npx prisma migrate dev
# 或导入初始数据
mysql -u root -p music_box < scripts/seed_data.sql
```

### Q8：表名/字段名报「Unknown column」

**原因**：Prisma Client 与数据库 schema 不一致。

**解决**：
```bash
cd server
npx prisma migrate dev --name sync
npx prisma generate
```

### Q9：能否查询其他业务表（如 `playlists`、`crawl_logs`）？

可以。当前脚本已封装 `users`、`songs`、`stats`、`tables` 等常用命令。如需查询其他表：

**临时方案**：使用 `tables` 命令查看表结构，然后直接通过 `mysql` 客户端查询。

**扩展方案**：在 `scripts/db-tool.cjs` 中添加新命令（参考 `cmdSongs` 实现），并保持只读、参数化的安全原则。

## 9. 与现有工具的关系

| 工具 | 用途 | 与本脚本关系 |
| --- | --- | --- |
| `scripts/init_database.py` | 初始化数据库与种子数据 | 互补：先初始化，再用本脚本验证 |
| `scripts/migrate_json_to_mysql.py` | JSON → MySQL 数据迁移 | 本脚本可用于迁移后校验 |
| `server/check-db.js` | 简单数据库连接检查 | 本脚本的 `ping` 命令是更完整的替代 |
| `scripts/health.js` | 整体健康检查 | 偏向运行时检查；本脚本偏向数据访问与认证 |

## 10. 故障排查清单

1. ✅ Node.js ≥ 18：`node --version`
2. ✅ `server/node_modules` 存在：`ls server/node_modules/@prisma/client/`
3. ✅ Prisma Client 已生成：`ls server/node_modules/.prisma/client/`
4. ✅ `server/.env` 配置正确：`cat server/.env`
5. ✅ MySQL 服务运行中：`Get-Service mysql*`
6. ✅ 数据库 `music_box` 存在：`mysql -u root -p -e "SHOW DATABASES;" | grep music_box`
7. ✅ 至少有一个用户：`node scripts/db-tool.cjs users --limit 5`

如以上均正常但脚本仍异常，请加 `--verbose` 重新执行并保存输出：
```bash
node scripts/db-tool.cjs <command> --verbose 2>&1 | tee logs/db-tool-debug.log
```
