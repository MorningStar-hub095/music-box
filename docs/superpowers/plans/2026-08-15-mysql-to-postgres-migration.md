# MySQL → PostgreSQL + Redis → 内存缓存迁移计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Music Box 从 MySQL 迁移到 PostgreSQL（本地验证），并将 Redis 缓存替换为 Node.js 内存缓存，为后续迁移到 Supabase 云做准备。

**Architecture:** 修改 Prisma schema 的 provider 为 `postgresql`，修复 MySQL 特有类型映射，用内存 Map 替代 Redis 缓存层，编写数据迁移脚本导出 MySQL 数据并导入 PostgreSQL。

**Tech Stack:** Prisma, PostgreSQL, Node.js (Map + TTL 缓存)

---

## 文件结构

### 修改的文件
- `server/prisma/schema.prisma` — provider 改为 postgresql，修复类型
- `server/.env` — DATABASE_URL 改为 PostgreSQL 格式
- `server/src/lib/redis.ts` — 替换为内存缓存实现
- `server/src/index.ts` — 移除 Redis 连接初始化
- `server/package.json` — 移除 ioredis 依赖

### 新建的文件
- `server/tools/migrate-data.cjs` — 数据迁移脚本（MySQL → PostgreSQL）

---

## Task 1: 修改 Prisma Schema

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 修改 provider**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 2: 修复 MySQL 特有类型**

将所有 `@db.VarChar(n)` 改为 `@db.VarChar(n)`（PostgreSQL 也支持），`@db.Text` 保持不变。需要移除的 MySQL 特有类型：
- `@db.TinyInt` → `Int`（已无此用法）
- `@db.Json` → `Json`（Prisma 原生支持）

实际检查发现所有 `@db.VarChar` 和 `@db.Text` 在 PostgreSQL 中都兼容，**无需修改类型**。

- [ ] **Step 3: 验证 schema 语法**

```bash
cd d:\music_box\server
npx prisma validate
```

Expected: `Valid prisma schema`

---

## Task 2: 配置 PostgreSQL 连接

**Files:**
- Modify: `server/.env`

- [ ] **Step 1: 修改 DATABASE_URL**

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/music_box"
```

- [ ] **Step 2: 创建 PostgreSQL 数据库**

```bash
psql -U postgres -c "CREATE DATABASE music_box;"
```

Expected: `CREATE DATABASE`

- [ ] **Step 3: 推送 schema 到 PostgreSQL**

```bash
cd d:\music_box\server
npx prisma db push
```

Expected: `Your database is now in sync with your Prisma schema`

- [ ] **Step 4: 生成 Prisma Client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client`

---

## Task 3: 替换 Redis 为内存缓存

**Files:**
- Modify: `server/src/lib/redis.ts`

- [ ] **Step 1: 重写 redis.ts 为内存缓存**

```typescript
/**
 * 内存缓存替代 Redis
 *
 * 用于：
 *   - 通用缓存 (cache.get/set/del)
 *   - URL 管理服务缓存层
 *   - 搜索/推荐/基因等模块缓存
 *
 * 2026-08-15 迁移：从 Redis (ioredis) 替换为 Node.js 内存 Map
 */

interface CacheEntry {
  value: string;
  expiry: number | null;
}

const store = new Map<string, CacheEntry>();

// 定期清理过期条目（每60秒）
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiry && entry.expiry <= now) {
      store.delete(key);
    }
  }
}, 60000);

export default {
  status: 'ready' as string,
  async get(key: string): Promise<string | null> {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiry && entry.expiry <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },
  async set(key: string, value: string): Promise<void> {
    store.set(key, { value, expiry: null });
  },
  async setex(key: string, ttl: number, value: string): Promise<void> {
    store.set(key, { value, expiry: Date.now() + ttl * 1000 });
  },
  async del(...keys: string[]): Promise<void> {
    for (const key of keys) store.delete(key);
  },
  async exists(key: string): Promise<number> {
    const entry = store.get(key);
    if (!entry) return 0;
    if (entry.expiry && entry.expiry <= Date.now()) {
      store.delete(key);
      return 0;
    }
    return 1;
  },
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const result: string[] = [];
    for (const key of store.keys()) {
      if (regex.test(key)) result.push(key);
    }
    return result;
  },
  async connect(): Promise<void> {},
};

export function isRedisAvailable(): boolean {
  return true; // 内存缓存始终可用
}

export async function getRedis() {
  return {
    status: 'ready',
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiry && entry.expiry <= Date.now()) { store.delete(key); return null; }
      return entry.value;
    },
    async set(key: string, value: string) { store.set(key, { value, expiry: null }); },
    async setex(key: string, ttl: number, value: string) { store.set(key, { value, expiry: Date.now() + ttl * 1000 }); },
    async del(...keys: string[]) { for (const k of keys) store.delete(k); },
    async exists(key: string) { return store.has(key) ? 1 : 0; },
  };
}

export async function withRedis<T>(
  fn: (client: any) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn(await getRedis());
  } catch (err) {
    console.warn('[CACHE] 操作失败，降级处理:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('[CACHE] Get error:', error);
      return null;
    }
  },

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await redis.setex(key, ttl, serialized);
      } else {
        await redis.set(key, serialized);
      }
    } catch (error) {
      console.error('[CACHE] Set error:', error);
    }
  },

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      console.error('[CACHE] Delete error:', error);
    }
  },

  async clearPattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error('[CACHE] Clear pattern error:', error);
    }
  },
};

// 暴露内存缓存大小用于健康检查
export function getCacheSize(): number {
  return store.size;
}
```

---

## Task 4: 更新 index.ts 移除 Redis 初始化

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: 移除 Redis 连接代码**

检查 `server/src/index.ts` 中是否有 Redis 连接初始化代码，如有则移除。当前代码中 Redis 使用 `lazyConnect`，import 时不会自动连接，只需确认无显式 `redis.connect()` 调用。

- [ ] **Step 2: 验证服务器启动**

```bash
cd d:\music_box\server
npx tsc
node dist/index.js &
sleep 3
curl http://localhost:49200/api/health
```

Expected: 服务器正常启动，无 Redis 连接错误

---

## Task 5: 移除 ioredis 依赖

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: 卸载 ioredis**

```bash
cd d:\music_box\server
npm uninstall ioredis
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

---

## Task 6: 数据迁移脚本

**Files:**
- Create: `server/tools/migrate-data.cjs`

- [ ] **Step 1: 创建迁移脚本**

```javascript
const { PrismaClient: MySQLPrisma } = require('@prisma/client');
const { PrismaClient: PGPrisma } = require('@prisma/client');

async function main() {
  // 源：MySQL
  const mysql = new MySQLPrisma({
    datasources: { db: { url: process.env.MYSQL_URL || 'mysql://root:Jmx20040813%2B@localhost:3306/music_box' } }
  });

  // 目标：PostgreSQL（使用默认 DATABASE_URL）
  const pg = new PGPrisma();

  console.log('=== Music Box Data Migration: MySQL → PostgreSQL ===\n');

  const tables = [
    { name: 'user', find: () => mysql.user.findMany() },
    { name: 'song', find: () => mysql.song.findMany() },
    { name: 'playlist', find: () => mysql.playlist.findMany() },
    { name: 'playlistSong', find: () => mysql.playlistSong.findMany() },
    { name: 'playHistory', find: () => mysql.playHistory.findMany() },
    { name: 'userPreference', find: () => mysql.userPreference.findMany() },
    { name: 'searchHistory', find: () => mysql.searchHistory.findMany() },
    { name: 'capsule', find: () => mysql.capsule.findMany() },
    { name: 'capsuleSong', find: () => mysql.capsuleSong.findMany() },
    { name: 'socialDna', find: () => mysql.socialDna.findMany() },
    { name: 'songInteraction', find: () => mysql.songInteraction.findMany() },
    { name: 'comment', find: () => mysql.comment.findMany() },
    { name: 'commentLike', find: () => mysql.commentLike.findMany() },
    { name: 'commentReport', find: () => mysql.commentReport.findMany() },
    { name: 'audioErrorLog', find: () => mysql.audioErrorLog.findMany() },
  ];

  let totalMigrated = 0;

  for (const table of tables) {
    try {
      const rows = await table.find();
      if (rows.length === 0) {
        console.log(`  ${table.name}: 0 rows (skip)`);
        continue;
      }

      // BigInt 序列化处理
      const processed = rows.map(row => {
        const clean = {};
        for (const [key, val] of Object.entries(row)) {
          clean[key] = typeof val === 'bigint' ? val.toString() : val;
        }
        return clean;
      });

      await pg[table.name].createMany({ data: processed });
      console.log(`  ${table.name}: ${rows.length} rows migrated`);
      totalMigrated += rows.length;
    } catch (err) {
      console.error(`  ${table.name}: ERROR - ${err.message}`);
    }
  }

  console.log(`\n=== Migration complete: ${totalMigrated} total rows ===`);

  await mysql.$disconnect();
  await pg.$disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: 运行迁移（确保 MySQL 和 PostgreSQL 都在运行）**

```bash
cd d:\music_box\server
node tools/migrate-data.cjs
```

Expected:
```
=== Music Box Data Migration: MySQL → PostgreSQL ===
  user: 46 rows migrated
  song: 1178 rows migrated
  socialDna: 8 rows migrated
  audioErrorLog: 68 rows migrated
  comment: 10 rows migrated
  commentLike: 1 rows migrated
  commentReport: 7 rows migrated
  ...
=== Migration complete: 1318 total rows ===
```

---

## Task 7: 验证与测试

- [ ] **Step 1: 编译后端**

```bash
cd d:\music_box\server
npx prisma generate
npx tsc
```

Expected: No errors

- [ ] **Step 2: 启动服务器**

```bash
node dist/index.js
```

Expected: 服务器正常启动，无 Redis/MySQL 错误

- [ ] **Step 3: API 验证**

```bash
# 健康检查
curl http://localhost:49200/api/health

# 登录验证
curl -X POST http://localhost:49200/api/auth/guest -H "Content-Type: application/json" -d '{}'

# 歌曲列表
curl http://localhost:49200/api/songs

# 评论列表
curl http://localhost:49200/api/comments/song/netease:28059417
```

Expected: 所有 API 正常返回数据，数据已从 MySQL 迁移到 PostgreSQL

- [ ] **Step 4: 构建前端**

```bash
cd d:\music_box\web
npm run build
```

Expected: Build successful

- [ ] **Step 5: 完整功能验证**

打开浏览器访问 http://localhost:49200，验证：
- 登录功能正常
- 歌曲列表正常显示
- 播放功能正常
- 评论功能正常
- 缓存面板正常

---

## 回滚方案

如果迁移失败，可快速回滚：

1. 恢复 `.env` 中的 `DATABASE_URL` 为 MySQL 连接字符串
2. 恢复 `schema.prisma` 中的 `provider = "mysql"`
3. 恢复 `redis.ts` 为原始 Redis 实现
4. 重新编译：`npx prisma generate && npx tsc`
