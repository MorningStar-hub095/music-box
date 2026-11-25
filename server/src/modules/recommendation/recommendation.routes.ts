import { Router } from 'express';
import { RecommendationController } from './recommendation.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const ctrl = new RecommendationController();

// 每日推荐
router.get('/daily', authenticate, (req, res) => ctrl.daily(req, res));

// 推荐反馈
router.post('/feedback', authenticate, (req, res) => ctrl.feedback(req, res));

// 相似歌曲推荐（不需要登录）
router.get('/similar/:songId', (req, res) => ctrl.similarSongs(req, res));

// 用户画像（需要登录）
router.get('/profile', authenticate, (req, res) => ctrl.userProfile(req, res));

// 行为洞察（需要登录）
router.get('/behavior', authenticate, (req, res) => ctrl.behaviorInsight(req, res));

// 更新推荐配置（管理员：全局权重影响所有用户的推荐结果，仅 admin/super_admin 可改）
router.put('/config', authenticate, authorize('admin', 'super_admin'), (req, res) => ctrl.updateConfig(req, res));

// 推荐质量评估
router.get('/quality', authenticate, (req, res) => ctrl.qualityReport(req, res));

export default router;
