import { AuthRequest, AuthResponse, NextFunction } from './auth';

/**
 * 简单的用户级限流中间件（内存实现，单实例足够）
 * 用于保护会触发昂贵副作用（Python 子进程、爬虫、批量任务）的接口，
 * 防止普通/访客账号高频调用耗尽共享资源。
 * @param max 窗口内最大调用次数
 * @param windowMs 窗口时长（毫秒）
 */
export function userRateLimit(max: number, windowMs: number) {
  const hits = new Map<number, number[]>()

  // 定期清理过期记录，避免 Map 无限增长
  setInterval(() => {
    const now = Date.now();
    for (const [userId, stamps] of hits) {
      const alive = stamps.filter((t) => now - t < windowMs);
      if (alive.length === 0) hits.delete(userId);
      else hits.set(userId, alive);
    }
  }, windowMs).unref();

  return (req: AuthRequest, res: AuthResponse, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) return next(); // 未登录场景由 authenticate 层负责

    const now = Date.now();
    const stamps = (hits.get(userId) || []).filter((t) => now - t < windowMs);
    if (stamps.length >= max) {
      return res.status(429).json({
        success: false,
        error: `操作过于频繁，请 ${Math.ceil(windowMs / 1000)} 秒后再试`,
      });
    }
    stamps.push(now);
    hits.set(userId, stamps);
    next();
  };
}
