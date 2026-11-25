import { Router } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, authorize } from '../../middleware/auth';
import { config } from '../../config';
import {
  getCacheStats,
  preDownloadPopular,
  getDownloadProgress,
  resetDownloadProgress,
  getCachedPlayableCount,
  enforceDiskCacheLimitNow,
} from './audio-cache.service';

/**
 * 缓存管理路由（从 index.ts 拆出，2026-10-26）
 * 注意：本路由在全局限流器之前挂载（管理操作不受限流影响），
 * 但必须鉴权：查询类需登录，触发下载需 admin 权限（2026-11-03 安全修复）
 * 挂载点：app.use('/api/cache', cacheAdminRoutes)
 */
const router = Router();

// 查询缓存状态（任何登录用户可见；桌面端经 X-Api-Key 注入的用户同样可查）
router.get('/status', authenticate, async (_req, res) => {
  try {
    const stats = getCacheStats();
    const total = await prisma.song.count({ where: { archived: false } });
    const playable = await prisma.song.count({ where: { archived: false, playable: true } });

    // 正向查询：遍历可播放歌曲，检查缓存文件是否存在
    const cachedPlayable = await getCachedPlayableCount();

    res.json({
      cachedFiles: stats.totalFiles,
      cachedPlayable,
      cachedSizeMB: stats.totalSizeMB,
      maxSizeMB: stats.maxSizeMB,
      evictions: stats.evictions,
      totalSongs: total,
      playableSongs: playable,
      coveragePercent: playable > 0 ? Math.min(Math.round(cachedPlayable / playable * 100), 100) : 0,
      orphanedFiles: stats.totalFiles - cachedPlayable,
    });
  } catch (err: any) {
    console.error('[CACHE-STATUS] 错误:', err);
    res.status(500).json({ error: err?.message });
  }
});

// 手动触发磁盘缓存上限检查/LRU 淘汰（仅管理员）
router.post('/evict', authenticate, authorize('super_admin', 'admin'), async (_req, res) => {
  try {
    await enforceDiskCacheLimitNow();
    const stats = getCacheStats();
    res.json({ success: true, cachedFiles: stats.totalFiles, cachedSizeMB: stats.totalSizeMB, evictions: stats.evictions });
  } catch (err: any) {
    console.error('[CACHE-EVICT] 错误:', err);
    res.status(500).json({ error: err?.message });
  }
});

// 手动触发批量下载（仅管理员：会占用磁盘/带宽/Python 执行器）
router.post('/download', authenticate, authorize('super_admin', 'admin'), async (req, res) => {
  // 演示模式禁止批量预下载（其对象是爬取的第三方版权音频）
  if (config.demoMode) {
    return res.status(403).json({ error: '演示模式下音频缓存下载已停用（版权合规）', demoMode: true });
  }
  try {
    const limit = Math.min(parseInt(req.body?.limit as string) || 20, 100);
    // 检查是否正在下载
    const currentProgress = getDownloadProgress();
    if (currentProgress.active) {
      // 安全阀：如果 active 超过5分钟无更新，真正重置状态（防止进程崩溃后状态卡死）
      const elapsed = Date.now() - currentProgress.startedAt;
      if (elapsed > 5 * 60 * 1000) {
        console.warn(`[CACHE-DOWNLOAD] 下载任务已超时(${Math.round(elapsed/1000)}s)，强制重置状态`);
        resetDownloadProgress();
      } else {
        return res.status(409).json({ success: false, error: '下载任务进行中，请稍后再试', progress: currentProgress });
      }
    }
    // 异步执行，立即返回
    preDownloadPopular(limit).catch(err => console.error('[CACHE-DOWNLOAD] 后台错误:', err));
    res.json({ success: true, message: `已开始下载最多${limit}首歌曲` });
  } catch (err: any) {
    console.error('[CACHE-DOWNLOAD] 错误:', err);
    res.status(500).json({ error: err?.message });
  }
});

// 查询下载进度（任何登录用户可见）
router.get('/progress', authenticate, (_req, res) => {
  if (config.demoMode) {
    return res.status(403).json({ error: '演示模式下无下载任务', demoMode: true });
  }
  try {
    const progress = getDownloadProgress();
    res.json(progress);
  } catch (err: any) {
    console.error('[CACHE-PROGRESS] 错误:', err);
    res.status(500).json({ error: err?.message });
  }
});

export default router;
