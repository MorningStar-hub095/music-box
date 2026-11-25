import { Router } from 'express';
import { MoodsController } from './moods.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const moodsController = new MoodsController();

router.get('/', (req, res) => moodsController.getMoods(req, res));

router.post('/', authenticate, authorize('super_admin', 'admin'), (req, res) => moodsController.createMood(req, res));

router.put('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => moodsController.updateMood(req, res));

router.delete('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => moodsController.deleteMood(req, res));

export default router;
