import { Router } from 'express';
import { DecadesController } from './decades.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const decadesController = new DecadesController();

router.get('/', (req, res) => decadesController.getDecades(req, res));

router.post('/', authenticate, authorize('super_admin', 'admin'), (req, res) => decadesController.createDecade(req, res));

router.put('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => decadesController.updateDecade(req, res));

router.delete('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => decadesController.deleteDecade(req, res));

export default router;
