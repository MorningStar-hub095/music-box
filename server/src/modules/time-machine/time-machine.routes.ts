import { Router } from 'express';
import { TimeMachineController } from './time-machine.controller';
import { authenticate } from '../../middleware/auth';
const router = Router();
const ctrl = new TimeMachineController();
router.get('/', authenticate, (req, res) => ctrl.query(req, res));
export default router;
