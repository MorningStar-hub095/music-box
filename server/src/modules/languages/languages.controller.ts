import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { LanguagesService } from './languages.service';

const languagesService = new LanguagesService();

export class LanguagesController {
  async getLanguages(req: AuthRequest, res: AuthResponse) {
    try {
      const languages = await languagesService.getLanguages();
      return res.json({
        success: true,
        data: languages,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取语言列表失败',
      });
    }
  }

  async createLanguage(req: AuthRequest, res: AuthResponse) {
    try {
      const { name, code } = req.body;
      if (!name || !code) {
        return res.status(400).json({
          success: false,
          error: '请提供语言名称和代码',
        });
      }

      const language = await languagesService.createLanguage({ name, code });
      return res.status(201).json({
        success: true,
        data: language,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '创建语言失败',
      });
    }
  }

  async updateLanguage(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的语言ID',
        });
      }

      const language = await languagesService.updateLanguage(id, req.body);
      return res.json({
        success: true,
        data: language,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新语言失败',
      });
    }
  }

  async deleteLanguage(req: AuthRequest, res: AuthResponse) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: '无效的语言ID',
        });
      }

      const result = await languagesService.deleteLanguage(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '删除语言失败',
      });
    }
  }
}
