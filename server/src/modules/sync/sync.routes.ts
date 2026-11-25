import { Router } from 'express';
import { authenticate, AuthRequest, AuthResponse } from '../../middleware/auth';
import { dataSyncService } from './sync.service';

const router = Router();

/**
 * 获取增量更新
 * GET /api/sync/updates
 */
router.get('/updates', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { lastSyncTime } = req.query;
    
    const clientLastSync = lastSyncTime 
      ? new Date(lastSyncTime as string) 
      : undefined;
    
    const result = await dataSyncService.sync(clientLastSync);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '同步失败',
    });
  }
});

/**
 * 获取同步状态
 * GET /api/sync/status
 */
router.get('/status', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const status = await dataSyncService.getSyncStatus();
    return res.json({ success: true, data: status });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取状态失败',
    });
  }
});

/**
 * 获取最新歌曲
 * GET /api/sync/latest
 */
router.get('/latest', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { limit } = req.query;
    const songs = await dataSyncService.getLatestSongs(
      limit ? Number(limit) : 50
    );
    return res.json({ success: true, data: songs });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取最新歌曲失败',
    });
  }
});

/**
 * 获取热门歌曲
 * GET /api/sync/hot
 */
router.get('/hot', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { limit } = req.query;
    const songs = await dataSyncService.getHotSongs(
      limit ? Number(limit) : 50
    );
    return res.json({ success: true, data: songs });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取热门歌曲失败',
    });
  }
});

/**
 * 检查歌曲可用性
 * GET /api/sync/check/:songId
 */
router.get('/check/:songId', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { songId } = req.params;
    const result = await dataSyncService.checkSongAvailability(songId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '检查失败',
    });
  }
});

export default router;
