import { Request, Response } from 'express';
import { SocialDnaService } from './social-dna.service';

const svc = new SocialDnaService();

export class SocialDnaController {
  async getMe(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const result = await svc.getMe(userId);
    return res.json({
      success: true,
      data: {
        ...result,
        insufficientMessage: result.insufficient
          ? `聆听数据不足（当前 ${result.eventCount} 条，至少需要 5 条），多听几首歌让系统了解你的音乐偏好`
          : null,
      },
    });
  }

  async match(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const limit = Number(req.body?.limit) || 10;
    const result = await svc.match(userId, limit);
    return res.json({ success: true, data: result });
  }

  // 修复 (2026-08-09): 新增 recompute 端点，允许用户手动重算社交DNA
  // 原代码无此端点，社交DNA一旦生成永不刷新
  async recompute(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const result = await svc.computeAndStore(userId);
    return res.json({
      success: true,
      data: {
        ...result,
        insufficientMessage: result.insufficient
          ? `聆听数据不足（当前 ${result.eventCount} 条，至少需要 5 条），多听几首歌让系统了解你的音乐偏好`
          : null,
      },
    });
  }
}
