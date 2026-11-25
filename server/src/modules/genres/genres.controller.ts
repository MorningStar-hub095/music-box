import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { GenresService } from './genres.service';

const genresService = new GenresService();

export class GenresController {
  async getGenres(req: AuthRequest, res: AuthResponse) {
    try {
      const genres = await genresService.getGenres();
      return res.json({
        success: true,
        data: genres,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取流派列表失败',
      });
    }
  }

  async createGenre(req: AuthRequest, res: AuthResponse) {
    try {
      const { name, parentId, sortOrder } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: '请提供流派名称',
        });
      }

      const genre = await genresService.createGenre({ name, parentId, sortOrder });
      return res.status(201).json({
        success: true,
        data: genre,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '创建流派失败',
      });
    }
  }

  async updateGenre(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的流派ID',
        });
      }

      const genre = await genresService.updateGenre(id, req.body);
      return res.json({
        success: true,
        data: genre,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新流派失败',
      });
    }
  }

  async deleteGenre(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的流派ID',
        });
      }

      const result = await genresService.deleteGenre(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '删除流派失败',
      });
    }
  }
}
