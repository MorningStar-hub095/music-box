# Music Box 安装指南

## 前置要求

| 软件 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 18.x | 运行 API 服务和前端构建 |
| MySQL | >= 8.0 | 主数据库 |
| Redis | >= 7.x | 缓存和会话存储 |
| Git | 最新版 | 源代码管理 |

## 快速开始

```bash
# 1. 克隆仓库
git clone <repository-url>
cd music-box

# 2. 一键安装
npm run setup

# 3. 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，设置数据库连接等

# 4. 启动所有服务
npm run start
```

`npm run setup` 会自动执行以下操作：
- 安装所有子项目依赖（server、web、admin、browse）
- 生成 Prisma Client
- 执行数据库迁移
- 检查 MySQL 和 Redis 连接

## 手动安装

如果一键安装失败，可按以下步骤手动操作：

### 1. 安装服务端依赖

```bash
cd server
npm install
```

### 2. 配置数据库

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env，修改数据库连接
# DATABASE_URL="mysql://用户名:密码@localhost:3306/music_box"

# 生成 Prisma Client
npx prisma generate

# 执行数据库迁移
npx prisma migrate deploy

# 可选：导入种子数据
mysql -u root -p music_box < scripts/seed_data.sql
```

### 3. 安装前端依赖

```bash
# Web 主站
cd ../web
npm install

# Admin 管理后台
cd admin
npm install

# Browse 浏览页
cd ../browse
npm install
```

### 4. 启动服务

```bash
# 回到项目根目录
cd ../..

# 启动所有服务
npm run start

# 或仅启动 API
npm run start:api
```

## 服务地址

| 服务 | 地址 | 说明 |
|------|------|------|
| API 服务 | http://localhost:3000 | 后端 REST API |
| Web 前端 | http://localhost:5173 | 音乐播放器主页 |
| Admin 后台 | http://localhost:5174 | 管理后台 |
| Browse 浏览 | http://localhost:5175 | 歌曲浏览页 |
| 健康检查 | http://localhost:3000/health | API 状态 |

## 常用命令

```bash
npm run start        # 启动所有服务
npm run start:dev    # 开发模式启动
npm run start:api    # 仅启动 API
npm run stop         # 停止所有服务
npm run health       # 健康检查
npm run health:watch # 持续监控健康状态
npm run build:all    # 构建所有前端项目
```

## 故障排查

常见问题请参考 [troubleshooting.md](./troubleshooting.md)。
