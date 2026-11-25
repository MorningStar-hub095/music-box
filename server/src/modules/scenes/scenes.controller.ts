import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { ScenesService } from './scenes.service';

const scenesService = new ScenesService();

export class ScenesController {
  async getScenes(req: AuthRequest, res: AuthResponse) {
    try {
      const scenes = await scenesService.getScenes();
      return res.json({
        success: true,
        data: scenes,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取场景列表失败',
      });
    }
  }

  async createScene(req: AuthRequest, res: AuthResponse) {
    try {
      const { name, icon } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: '请提供场景名称',
        });
      }

      const scene = await scenesService.createScene({ name, icon });
      return res.status(201).json({
        success: true,
        data: scene,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '创建场景失败',
      });
    }
  }

  async updateScene(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的场景ID',
        });
      }

      const scene = await scenesService.updateScene(id, req.body);
      return res.json({
        success: true,
        data: scene,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新场景失败',
      });
    }
  }

  async deleteScene(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的场景ID',
        });
      }

      const result = await scenesService.deleteScene(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '删除场景失败',
      });
    }
  }
}
