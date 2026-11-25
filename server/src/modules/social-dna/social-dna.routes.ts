import { Router } from 'express';
import { SocialDnaController } from './social-dna.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const ctrl = new SocialDnaController();
router.get('/me', authenticate, (req, res) => ctrl.getMe(req, res));
router.post('/match', authenticate, (req, res) => ctrl.match(req, res));
// 修复 (2026-08-09): 新增 recompute 端点，允许用户手动重算社交DNA
router.post('/recompute', authenticate, (req, res) => ctrl.recompute(req, res));
export default router;
