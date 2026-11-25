import { Request, Response, NextFunction } from 'express';

/**
 * 基于 IP 的内存级速率限制中间件
 */
export function createRateLimit(windowMs: number, max: number, message: string) {
  const store = new Map<string, { count: number; resetTime: number }>();
  const MAX_ENTRIES = 10000;

  // 每5分钟清理过期条目
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, val] of store) {
      if (now > val.resetTime) store.delete(key);
    }
  }, 5 * 60 * 1000);

  // 允许进程正常退出
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = store.get(ip);

    if (!entry || now > entry.resetTime) {
      // 新条目前检查容量
      if (store.size >= MAX_ENTRIES && !store.has(ip)) {
        return res.status(429).json({ success: false, error: '服务繁忙，请稍后再试' });
      }
      entry = { count: 0, resetTime: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ success: false, error: message });
    }

    next();
  };
}
