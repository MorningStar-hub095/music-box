import { Router } from 'express';
import { auditController } from './audit.controller';
import { authenticate, authorize, AuthRequest, AuthResponse } from '../../middleware/auth';

const router = Router();

// 获取实体操作历史
router.get('/history/:targetType/:targetId', authenticate, authorize('admin', 'super_admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { targetType, targetId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    const data = await auditController.getHistory(targetType, targetId, limit);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[AUDIT-ROUTE] 获取操作历史失败:', error);
    return res.status(500).json({
      success: false,
      error: '操作失败，请稍后重试',
      timestamp: new Date().toISOString(),
    });
  }
});

// 获取用户操作历史
router.get('/user/:userId', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const userId = parseInt(req.params.userId);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    const data = await auditController.getUserHistory(userId, limit);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[AUDIT-ROUTE] 获取用户操作历史失败:', error);
    return res.status(500).json({
      success: false,
      error: '操作失败，请稍后重试',
      timestamp: new Date().toISOString(),
    });
  }
});

// 获取最近操作记录
router.get('/recent', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    const data = await auditController.getRecent(limit);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[AUDIT-ROUTE] 获取最近操作记录失败:', error);
    return res.status(500).json({
      success: false,
      error: '操作失败，请稍后重试',
      timestamp: new Date().toISOString(),
    });
  }
});

// 获取操作统计
router.get('/stats', authenticate, authorize('admin', 'super_admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 30;

    const data = await auditController.getStats(days);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[AUDIT-ROUTE] 获取操作统计失败:', error);
    return res.status(500).json({
      success: false,
      error: '操作失败，请稍后重试',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
