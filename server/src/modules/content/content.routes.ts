import { Router } from 'express';
import { authenticate, authorize, AuthRequest, AuthResponse } from '../../middleware/auth';
import * as contentService from './content.service';

const router = Router();

/**
 * 获取内容统计信息
 * GET /api/content/stats
 */
router.get('/stats', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const stats = await contentService.getContentStats();
    return res.json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取统计失败',
    });
  }
});

/**
 * 获取动态播放列表
 * GET /api/content/playlist
 */
router.get('/playlist', async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { type, limit, platform, genre } = req.query;
    
    const validTypes = ['hot', 'new', 'random', 'similar'] as const;
    type PlaylistType = typeof validTypes[number];
    
    const result = await contentService.getDynamicPlaylist({
      type: validTypes.includes(type as PlaylistType) ? (type as PlaylistType) : 'hot',
      limit: limit ? Number(limit) : 20,
      platform: platform as string,
      genre: genre as string,
    });
    
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取播放列表失败',
    });
  }
});

/**
 * 更新热度分数
 * POST /api/content/update-hot-scores
 */
router.post('/update-hot-scores', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const result = await contentService.updateHotScores();
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '更新热度失败',
    });
  }
});

/**
 * 获取内容更新建议
 * GET /api/content/suggestions
 */
router.get('/suggestions', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const result = await contentService.getContentSuggestions();
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取建议失败',
    });
  }
});

export default router;
