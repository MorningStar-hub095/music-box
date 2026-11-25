import { Router } from 'express';
import { LanguagesController } from './languages.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const languagesController = new LanguagesController();

router.get('/', (req, res) => languagesController.getLanguages(req, res));

router.post('/', authenticate, authorize('super_admin', 'admin'), (req, res) => languagesController.createLanguage(req, res));

router.put('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => languagesController.updateLanguage(req, res));

router.delete('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => languagesController.deleteLanguage(req, res));

export default router;
