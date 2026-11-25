import { Router, Request, Response } from 'express';
import { statsController } from './stats.controller';

const router = Router();

// 获取总览统计
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const data = await statsController.getOverview();
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[STATS-ROUTE] 获取总览统计失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取统计数据失败',
      timestamp: new Date().toISOString(),
    });
  }
});

// 获取歌曲统计
router.get('/songs', async (req: Request, res: Response) => {
  try {
    const data = await statsController.getSongStats();
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[STATS-ROUTE] 获取歌曲统计失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取歌曲统计失败',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
