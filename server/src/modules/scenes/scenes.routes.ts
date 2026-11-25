import { Router } from 'express';
import { ScenesController } from './scenes.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const scenesController = new ScenesController();

router.get('/', (req, res) => scenesController.getScenes(req, res));

router.post('/', authenticate, authorize('super_admin', 'admin'), (req, res) => scenesController.createScene(req, res));

router.put('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => scenesController.updateScene(req, res));

router.delete('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => scenesController.deleteScene(req, res));

export default router;
