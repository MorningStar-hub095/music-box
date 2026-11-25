import { Router } from 'express';
import { searchController } from './search.controller';
import { authenticate, authorize, AuthRequest, AuthResponse } from '../../middleware/auth';
import { enhancedSearchService } from './search-enhanced.service';

const router = Router();

// 搜索歌曲
router.get('/', (req, res) => searchController.searchSongs(req, res));

// 线上专属搜索（Jamendo CC 授权曲库，不查本地库）
router.get('/online', (req, res) => searchController.searchOnlineOnly(req, res));

// 搜索服务健康检查
router.get('/health', (req, res) => searchController.healthCheck(req, res));

// 获取搜索建议
router.get('/suggestions', (req, res) => searchController.getSuggestions(req, res));

// 获取热门搜索
router.get('/hot', (req, res) => searchController.getHotSearches(req, res));

// 获取分类统计
router.get('/categories', (req, res) => searchController.getCategoryStats(req, res));

// 清除缓存（管理员功能）- 需要认证和管理员权限
router.post('/clear-cache', authenticate, authorize('super_admin', 'admin'), (req, res) => searchController.clearCache(req, res));

// ==================== 播放列表相关路由 ====================

/**
 * 添加歌曲到播放列表
 * POST /api/search/playlist/add
 */
router.post('/playlist/add', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { playlistId, songId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    if (!playlistId || !songId) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const result = await enhancedSearchService.addToPlaylist(userId, playlistId, songId);
    return res.json({ success: result.success, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '添加失败',
    });
  }
});

/**
 * 从播放列表移除歌曲
 * POST /api/search/playlist/remove
 */
router.post('/playlist/remove', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { playlistId, songId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    if (!playlistId || !songId) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const result = await enhancedSearchService.removeFromPlaylist(userId, playlistId, songId);
    return res.json({ success: result.success, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '移除失败',
    });
  }
});

/**
 * 获取播放列表中的歌曲
 * GET /api/search/playlist/:playlistId
 */
router.get('/playlist/:playlistId', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { playlistId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const result = await enhancedSearchService.getPlaylistSongs(Number(playlistId), userId);
    
    if (!result) {
      return res.status(404).json({ success: false, error: '播放列表不存在' });
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取失败',
    });
  }
});

export default router;
