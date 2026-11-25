import { Router } from 'express';
import { CapsuleController } from './capsule.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const ctrl = new CapsuleController();
router.post('/seal', authenticate, (req, res) => ctrl.seal(req, res));
router.get('/due', authenticate, (req, res) => ctrl.due(req, res));
export default router;
