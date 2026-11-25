/**
 * URL 管理路由
 *
 * 路由保护策略：
 *   - 查询类接口：任何已认证用户可访问
 *   - 操作类接口（刷新/触发任务/解决预警）：需要 admin 及以上权限
 *
 * 2026-08-08 新增
 */

import { Router } from 'express';
import { UrlManagerController } from './url-manager.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { userRateLimit } from '../../middleware/userRateLimit';

const router = Router();
const controller = new UrlManagerController();

// 查询类接口（已认证用户）
router.get('/status', authenticate, (req, res) => controller.getStatus(req, res));
router.get('/metrics', authenticate, (req, res) => controller.getMetrics(req, res));
router.get('/dashboard', authenticate, (req, res) => controller.getDashboard(req, res));
router.get('/alerts', authenticate, (req, res) => controller.getAlerts(req, res));
router.get('/logs', authenticate, (req, res) => controller.getLogs(req, res));
router.get('/scheduler/status', authenticate, (req, res) => controller.getSchedulerStatus(req, res));
router.get('/check/:trackId', authenticate, (req, res) => controller.checkUrl(req, res));

// 操作类接口（admin 及以上权限）
router.post('/refresh/:trackId', authenticate, authorize('super_admin', 'admin'), (req, res) => controller.refreshUrl(req, res));
router.post('/emergency/:trackId', authenticate, authorize('super_admin', 'admin'), (req, res) => controller.emergencyRefresh(req, res));
// 批量刷新（保留给前端「刷新失效 URL」按钮，但加用户级限流防止占满刷新队列）
router.post('/refresh-batch', authenticate, userRateLimit(2, 60_000), (req, res) => controller.refreshBatch(req, res));
router.post('/alerts/:id/resolve', authenticate, authorize('super_admin', 'admin'), (req, res) => controller.resolveAlert(req, res));
router.post('/scheduler/trigger', authenticate, authorize('super_admin', 'admin'), (req, res) => controller.triggerSchedulerTask(req, res));

export default router;
