import { Router } from 'express';
import { TagsController } from './tags.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const tagsController = new TagsController();

router.get('/', (req, res) => tagsController.getTags(req, res));

router.post('/', authenticate, authorize('super_admin', 'admin', 'editor'), (req, res) => tagsController.createTag(req, res));

router.put('/:id', authenticate, authorize('super_admin', 'admin', 'editor'), (req, res) => tagsController.updateTag(req, res));

router.delete('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => tagsController.deleteTag(req, res));

export default router;
