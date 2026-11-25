/**
 * 内存缓存（替代 Redis）
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
const hashStore = new Map<string, Map<string, string>>();
const listStore = new Map<string, string[]>();

// 内存缓存容量上限与哈希过期时间表：防止长期运行内存无限增长导致 OOM 崩溃
const MAX_STORE_ENTRIES = 20000;   // 通用缓存键上限
const MAX_HASH_KEYS = 2000;        // 哈希表数量上限
const MAX_HASH_FIELDS = 5000;      // 单个哈希表的字段上限
const MAX_LIST_ENTRIES = 5000;     // 单个列表长度上限
const hashExpiry = new Map<string, number>(); // 哈希键的过期时间（如 url:hot:today）

// 超出容量时按插入顺序淘汰最旧条目（近似 LRU）
function evictIfNeeded(map: Map<unknown, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// 定期清理过期条目（每60秒）；.unref() 避免阻止进程优雅退出
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiry && entry.expiry <= now) {
      store.delete(key);
    }
  }
  // 清理过期的哈希表（如 url:hot:today 的每日热度统计）
  for (const [key, exp] of hashExpiry) {
    if (exp <= now) {
      hashStore.delete(key);
      hashExpiry.delete(key);
    }
  }
}, 60000).unref();

function getHash(key: string): Map<string, string> {
  if (!hashStore.has(key)) hashStore.set(key, new Map());
  return hashStore.get(key)!;
}

// Multi 事务模拟
class MemoryMulti {
  private ops: (() => void)[] = [];

  hincrby(key: string, field: string, increment: number): this {
    this.ops.push(() => {
      const hash = getHash(key);
      const current = parseInt(hash.get(field) || '0', 10);
      hash.set(field, String(current + increment));
    });
    return this;
  }

  expire(key: string, seconds: number): this {
    this.ops.push(() => {
      // 修复 (2026-08-27): 原 expire 只处理通用 store，未处理 hashStore，
      // 导致 url:hot:today 等哈希键通过 multi 设置过期时被忽略、永不重置，
      // 每日热度统计会持续累积且被近似 LRU 错误淘汰。
      // 现同时为哈希键登记过期时间，使下方 hashExpiry 清理机制能正确回收。
      const entry = store.get(key);
      if (entry) entry.expiry = Date.now() + seconds * 1000;
      // 为哈希键（如 url:hot:today 每日热度统计）登记过期时间
      if (hashStore.has(key)) {
        hashExpiry.set(key, Date.now() + seconds * 1000);
      }
    });
    return this;
  }

  del(key: string): this {
    this.ops.push(() => { store.delete(key); hashStore.delete(key); listStore.delete(key); });
    return this;
  }

  lpush(key: string, ...values: string[]): this {
    this.ops.push(() => {
      if (!listStore.has(key)) listStore.set(key, []);
      const list = listStore.get(key)!;
      list.unshift(...values);
      while (list.length > MAX_LIST_ENTRIES) list.pop();
      evictIfNeeded(listStore, MAX_HASH_KEYS);
    });
    return this;
  }

  ltrim(key: string, start: number, stop: number): this {
    this.ops.push(() => {
      const list = listStore.get(key);
      if (list) listStore.set(key, list.slice(start, stop + 1));
    });
    return this;
  }

  async exec(): Promise<any[]> {
    for (const op of this.ops) op();
    const results = this.ops.map(() => [null, 1] as [null, number]);
    this.ops = [];
    return results;
  }
}

// 内存缓存客户端，模拟 ioredis 接口
const redis = {
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

  async set(key: string, value: string, ...args: any[]): Promise<string | null> {
    // 支持 redis.set(key, value, 'PX', ttlMs, 'NX')
    let px: number | undefined;
    let nx = false;
    for (let i = 0; i < args.length; i += 2) {
      const flag = String(args[i]).toUpperCase();
      if (flag === 'PX') px = Number(args[i + 1]);
      if (flag === 'EX') px = Number(args[i + 1]) * 1000;
      if (flag === 'NX') { nx = true; i--; }
    }
    if (nx && store.has(key)) {
      const entry = store.get(key);
      if (entry && (!entry.expiry || entry.expiry > Date.now())) return null;
    }
    store.set(key, { value, expiry: px ? Date.now() + px : null });
    evictIfNeeded(store, MAX_STORE_ENTRIES);
    return 'OK';
  },

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
    evictIfNeeded(store, MAX_STORE_ENTRIES);
  },

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) { store.delete(key); hashStore.delete(key); }
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

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = getHash(key);
    const result: Record<string, string> = {};
    for (const [field, value] of hash) {
      result[field] = value;
    }
    return result;
  },

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const hash = getHash(key);
    const current = parseInt(hash.get(field) || '0', 10);
    const newVal = current + increment;
    hash.set(field, String(newVal));
    evictIfNeeded(hash, MAX_HASH_FIELDS);
    evictIfNeeded(hashStore, MAX_HASH_KEYS);
    return newVal;
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = listStore.get(key) || [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  },

  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!listStore.has(key)) listStore.set(key, []);
    const list = listStore.get(key)!;
    list.unshift(...values);
    while (list.length > MAX_LIST_ENTRIES) list.pop();
    evictIfNeeded(listStore, MAX_HASH_KEYS);
    return list.length;
  },

  multi(): MemoryMulti {
    return new MemoryMulti();
  },

  async connect(): Promise<void> {},
};

export default redis;

/**
 * 判断缓存是否可用（始终返回 true）
 */
export function isRedisAvailable(): boolean {
  return true;
}

/**
 * 获取缓存客户端实例（兼容旧接口）
 */
export async function getRedis() {
  return redis;
}

/**
 * 执行带降级处理的缓存操作
 */
export async function withRedis<T>(
  fn: (client: typeof redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn(redis);
  } catch (err) {
    console.warn('[CACHE] 操作失败，降级处理:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

// 缓存工具函数
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

// 暴露缓存大小用于健康检查
export function getCacheSize(): number {
  return store.size;
}
