import { Router } from 'express';
import { authenticate, authorize, AuthRequest, AuthResponse } from '../../middleware/auth';
import * as crawlerService from './crawler.service';
import * as archiveService from '../songs/archive.service';

const router = Router();

// ==================== 爬虫管理 ====================

/**
 * 执行爬取任务
 * POST /api/crawler/crawl
 */
router.post('/crawl', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { platform, keyword, targetCount, batchSize, crawlSource, taskType } = req.body;

    if (!platform) {
      return res.status(400).json({ success: false, error: '请指定平台' });
    }

    // 根据 taskType 选择不同的爬取函数
    const result = taskType === 'hot100'
      ? await crawlerService.crawlHot100Songs({
          platform,
          targetCount: targetCount || 100,
          batchSize: batchSize || 10,
          crawlSource: crawlSource || 'manual',
        })
      : await crawlerService.crawlSongs({
          platform,
          keyword,
          targetCount: targetCount || 50,
          batchSize: batchSize || 10,
          crawlSource: crawlSource || 'manual',
        });

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '爬取失败',
    });
  }
});

/**
 * 获取爬虫统计信息
 * GET /api/crawler/stats
 */
router.get('/stats', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const stats = await crawlerService.getCrawlStats();
    return res.json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取统计失败',
    });
  }
});

/**
 * 获取爬虫任务列表
 * GET /api/crawler/logs
 */
router.get('/logs', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { page, pageSize, status, platform } = req.query;
    const result = await crawlerService.getCrawlLogs({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      status: status as any,
      platform: platform as string,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取日志失败',
    });
  }
});

/**
 * 获取推荐爬取策略
 * GET /api/crawler/strategy
 */
router.get('/strategy', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const strategy = await crawlerService.getRecommendedStrategy();
    return res.json({ success: true, data: strategy });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取策略失败',
    });
  }
});

/**
 * 执行定时爬取任务
 * POST /api/crawler/scheduled
 */
router.post('/scheduled', authenticate, authorize('super_admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const result = await crawlerService.executeScheduledCrawl();
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '定时爬取失败',
    });
  }
});

// ==================== 归档管理 ====================

/**
 * 归档单首歌曲
 * POST /api/crawler/archive/:songId
 */
router.post('/archive/:songId', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { songId } = req.params;
    const { reason } = req.body;
    const result = await archiveService.archiveSong(songId, reason, req.user?.id);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : '归档失败',
    });
  }
});

/**
 * 批量归档歌曲
 * POST /api/crawler/archive-batch
 */
router.post('/archive-batch', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { songIds, reason } = req.body;
    if (!songIds || !Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ success: false, error: '请提供要归档的歌曲ID列表' });
    }
    const result = await archiveService.batchArchiveSongs(songIds, reason);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : '批量归档失败',
    });
  }
});

/**
 * 自动归档
 * POST /api/crawler/auto-archive
 */
router.post('/auto-archive', authenticate, authorize('super_admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { criteria, reason } = req.body;
    const result = await archiveService.autoArchive({
      criteria,
      reason,
      archivedBy: req.user?.id,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : '自动归档失败',
    });
  }
});

/**
 * 恢复已归档歌曲
 * POST /api/crawler/restore/:songId
 */
router.post('/restore/:songId', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { songId } = req.params;
    const result = await archiveService.restoreSong(songId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : '恢复失败',
    });
  }
});

/**
 * 获取归档歌曲列表
 * GET /api/crawler/archived
 */
router.get('/archived', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { page, pageSize, keyword, reason } = req.query;
    const result = await archiveService.getArchivedSongs({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      keyword: keyword as string,
      reason: reason as string,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取归档列表失败',
    });
  }
});

/**
 * 获取归档统计
 * GET /api/crawler/archive-stats
 */
router.get('/archive-stats', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const stats = await archiveService.getArchiveStats();
    return res.json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取归档统计失败',
    });
  }
});

export default router;
