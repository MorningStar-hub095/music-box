import { Router } from 'express';
import { ListeningController } from './listening.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();
const listeningController = new ListeningController();

// 批量接入聆听事件
router.post('/events', authenticate, (req, res) => listeningController.ingest(req, res));

// 获取最近聆听事件
router.get('/recent', authenticate, (req, res) => listeningController.recent(req, res));

export default router;
