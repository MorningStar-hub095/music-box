import { Router } from 'express';
import { GenomeController } from './genome.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const ctrl = new GenomeController();

router.get('/map', authenticate, (req, res) => ctrl.getMap(req, res));
router.get('/cluster/:id', authenticate, (req, res) => ctrl.getCluster(req, res));
router.post('/recompute', authenticate, (req, res) => ctrl.recompute(req, res));

export default router;
