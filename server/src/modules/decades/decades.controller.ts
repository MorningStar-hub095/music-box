import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { DecadesService } from './decades.service';

const decadesService = new DecadesService();

export class DecadesController {
  async getDecades(req: AuthRequest, res: AuthResponse) {
    try {
      const decades = await decadesService.getDecades();
      return res.json({
        success: true,
        data: decades,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取年代列表失败',
      });
    }
  }

  async createDecade(req: AuthRequest, res: AuthResponse) {
    try {
      const { name, startYear, endYear } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: '请提供年代名称',
        });
      }

      const decade = await decadesService.createDecade({ name, startYear, endYear });
      return res.status(201).json({
        success: true,
        data: decade,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '创建年代失败',
      });
    }
  }

  async updateDecade(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的年代ID',
        });
      }

      const decade = await decadesService.updateDecade(id, req.body);
      return res.json({
        success: true,
        data: decade,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新年代失败',
      });
    }
  }

  async deleteDecade(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的年代ID',
        });
      }

      const result = await decadesService.deleteDecade(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '删除年代失败',
      });
    }
  }
}
