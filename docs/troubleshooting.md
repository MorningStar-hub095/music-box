# Music Box 故障排查指南

## 错误码参考

| 错误码 | 描述 | 解决方案 |
|--------|------|----------|
| E001 | MySQL 连接失败 | 检查 MySQL 是否运行，确认 DATABASE_URL 配置正确 |
| E002 | Redis 连接失败 | 检查 Redis 是否运行，确认 REDIS_URL 配置正确 |
| E003 | Prisma Client 未生成 | 运行 `npx prisma generate` |
| E004 | 数据库迁移失败 | 运行 `npx prisma migrate deploy` 检查错误详情 |
| E005 | 端口被占用 | 更改端口配置或关闭占用端口的进程 |
| E006 | JWT 密钥不安全 | 在 .env 中设置长度 >= 32 字符的 JWT_SECRET |
| E007 | 依赖安装失败 | 删除 node_modules 后重新运行 npm install |
| E008 | 前端构建失败 | 检查 TypeScript 错误，运行 `npm run build` 查看详情 |
| E009 | Docker 构建失败 | 检查 Dockerfile 和构建日志 |
| E010 | 服务启动超时 | 检查数据库和 Redis 连接，增大 STARTUP_TIMEOUT |

## 常见问题

### 1. 数据库连接失败

**现象：** API 启动时报 `E001: MySQL connection refused` 或 `Can't connect to MySQL server`

**解决方案：**

```bash
# 检查 MySQL 是否运行
# Linux/Mac
systemctl status mysql
# Windows
net start | findstr mysql

# 测试连接
mysql -u root -p -h localhost -P 3306

# 检查 DATABASE_URL 格式
# 正确格式：mysql://用户名:密码@主机:端口/数据库名
# 示例：mysql://root:password@localhost:3306/music_box

# Docker 环境下确认容器运行
docker compose ps
docker compose logs mysql
```

### 2. 端口被占用

**现象：** 报 `E005: listen EADDRINUSE` 或 `Port 3000 is already in use`

**解决方案：**

```bash
# Windows 查找占用端口的进程
netstat -ano | findstr :3000

# 终止占用进程 (替换 PID)
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3000
kill -9 <PID>

# 或者修改端口
# 编辑 server/.env
PORT=3001
```

### 3. Prisma 相关问题

**现象：** `E003: Prisma Client has not been generated` 或表不存在

**解决方案：**

```bash
cd server

# 重新生成 Prisma Client
npx prisma generate

# 检查迁移状态
npx prisma migrate status

# 应用待执行的迁移
npx prisma migrate deploy

# 如果迁移锁冲突（开发环境）
npx prisma migrate reset  # ⚠️ 会清空数据库
```

### 4. Redis 连接问题

**现象：** `E002: Redis connection error` 或缓存功能异常

**解决方案：**

```bash
# 检查 Redis 是否运行
redis-cli ping
# 期望返回: PONG

# Windows 服务管理
net start | findstr redis

# Docker 环境
docker compose logs redis

# 检查 REDIS_URL 配置
# 默认：redis://localhost:6379
# 带密码：redis://:password@localhost:6379

# 如果 Redis 不可用，API 会降级运行（缓存功能失效，但核心功能正常）
```

### 5. npm install 安装失败

**现象：** `E007: npm ERR! code ERESOLVE` 或依赖冲突

**解决方案：**

```bash
# 清除缓存
npm cache clean --force

# 删除依赖目录重新安装
rm -rf node_modules package-lock.json
npm install

# 如仍有冲突，使用 --legacy-peer-deps
npm install --legacy-peer-deps
```

### 6. 前端构建失败

**现象：** `E008: TypeScript error` 或 vite build 报错

**解决方案：**

```bash
# 检查 TypeScript 错误
cd web
npx tsc --noEmit

# 确保依赖完整
npm ci

# 检查 Node.js 版本
node --version  # 需要 >= 18
```

### 7. Docker 构建失败

**现象：** `E009: Docker build error`

**解决方案：**

```bash
# 检查 Docker 是否运行
docker info

# 清除构建缓存重试
docker builder prune -f
docker compose build --no-cache

# 检查磁盘空间
docker system df
docker system prune  # 清理无用资源
```

### 8. CORS 跨域错误

**现象：** 浏览器控制台报 `CORS policy` 错误

**解决方案：**

```bash
# 编辑 server/.env，添加前端地址到白名单
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:5174,http://localhost"
```

### 9. 服务启动超时

**现象：** `E010: Service startup timeout`

**解决方案：**

```bash
# 检查各服务是否正常
npm run health

# 手动分别启动排查
npm run start:api    # 先启动 API
# 新终端
cd web && npm run dev  # 再启动前端

# 增大超时时间（编辑 .env.development）
STARTUP_TIMEOUT=60000
```

## 获取帮助

如果以上方案均无法解决问题：

1. 运行 `npm run health:json` 收集诊断信息
2. 查看详细日志：`npm run start:dev`（开发模式输出更多日志）
3. 检查 [GitHub Issues](../../issues) 是否有类似问题
