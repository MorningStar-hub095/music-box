import { Router } from 'express';
import { EmotionDnaController } from './emotion-dna.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const ctrl = new EmotionDnaController();
router.get('/', authenticate, (req, res) => ctrl.getDna(req, res));
router.post('/recompute', authenticate, (req, res) => ctrl.recompute(req, res));
export default router;
