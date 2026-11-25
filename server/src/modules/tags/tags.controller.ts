import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { TagsService } from './tags.service';

const tagsService = new TagsService();

export class TagsController {
  async getTags(req: AuthRequest, res: AuthResponse) {
    try {
      const tags = await tagsService.getTags();
      return res.json({
        success: true,
        data: tags,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取标签列表失败',
      });
    }
  }

  async createTag(req: AuthRequest, res: AuthResponse) {
    try {
      const { name, parentId } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: '请提供标签名称',
        });
      }

      const tag = await tagsService.createTag({
        name,
        parentId,
        userId: req.user?.id,
      });
      return res.status(201).json({
        success: true,
        data: tag,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '创建标签失败',
      });
    }
  }

  async updateTag(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的标签ID',
        });
      }

      const tag = await tagsService.updateTag(id, req.body);
      return res.json({
        success: true,
        data: tag,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新标签失败',
      });
    }
  }

  async deleteTag(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的标签ID',
        });
      }

      const result = await tagsService.deleteTag(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '删除标签失败',
      });
    }
  }
}
