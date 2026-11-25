import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { MoodsService } from './moods.service';

const moodsService = new MoodsService();

export class MoodsController {
  async getMoods(req: AuthRequest, res: AuthResponse) {
    try {
      const moods = await moodsService.getMoods();
      return res.json({
        success: true,
        data: moods,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取情绪列表失败',
      });
    }
  }

  async createMood(req: AuthRequest, res: AuthResponse) {
    try {
      const { name, icon } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: '请提供情绪名称',
        });
      }

      const mood = await moodsService.createMood({ name, icon });
      return res.status(201).json({
        success: true,
        data: mood,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '创建情绪失败',
      });
    }
  }

  async updateMood(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的情绪ID',
        });
      }

      const mood = await moodsService.updateMood(id, req.body);
      return res.json({
        success: true,
        data: mood,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新情绪失败',
      });
    }
  }

  async deleteMood(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的情绪ID',
        });
      }

      const result = await moodsService.deleteMood(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '删除情绪失败',
      });
    }
  }
}
