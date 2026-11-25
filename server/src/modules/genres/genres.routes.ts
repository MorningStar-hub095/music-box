import { Router } from 'express';
import { GenresController } from './genres.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();
const genresController = new GenresController();

router.get('/', (req, res) => genresController.getGenres(req, res));

router.post('/', authenticate, authorize('super_admin', 'admin'), (req, res) => genresController.createGenre(req, res));

router.put('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => genresController.updateGenre(req, res));

router.delete('/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => genresController.deleteGenre(req, res));

export default router;
