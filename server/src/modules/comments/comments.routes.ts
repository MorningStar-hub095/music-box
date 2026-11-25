import { Router } from 'express';
import { CommentsController } from './comments.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { sanitizeInput } from '../../middleware/sanitize';
import { createRateLimit } from '../../middleware/rateLimit';

const router = Router();
const controller = new CommentsController();

router.use(sanitizeInput);

const createLimiter = createRateLimit(60 * 1000, 10, '评论发布过于频繁，请稍后再试');
const reportLimiter = createRateLimit(60 * 1000, 5, '举报操作过于频繁，请稍后再试');

// 公开接口（不需要登录）
router.get('/song/:songId', controller.getSongComments.bind(controller));
router.get('/lyric/:songId', controller.getLyricComments.bind(controller));

// 需要登录的接口
router.post('/', authenticate, createLimiter, controller.create.bind(controller));
router.delete('/:id', authenticate, controller.deleteComment.bind(controller));
router.post('/:id/like', authenticate, controller.toggleLike.bind(controller));
router.get('/:id/liked', authenticate, controller.isLiked.bind(controller));
router.post('/:id/report', authenticate, reportLimiter, controller.report.bind(controller));

// 管理员接口
router.get('/admin/reports', authenticate, authorize('admin', 'super_admin'), controller.getReports.bind(controller));
router.put('/admin/:id/status', authenticate, authorize('admin', 'super_admin'), controller.updateStatus.bind(controller));

export default router;
