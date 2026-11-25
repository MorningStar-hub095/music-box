import { Request, Response } from 'express';
import { EmotionDnaService } from './emotion-dna.service';

const svc = new EmotionDnaService();

export class EmotionDnaController {
  async getDna(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const dna = await svc.getForUser(userId);
    const vector = dna.vector || {};

    // 修复: 数据不足时返回 insufficient 标记和提示信息
    const interpretation = Object.entries(vector).slice(0, 8).map(([k, v]: [string, any]) => ({
      band: k, value: v, label: v > 0.6 ? '强偏好' : v > 0.3 ? '中等' : '弱',
    }));
    return res.json({
      success: true,
      data: {
        ...dna,
        interpretation,
        // 修复: 新增 insufficient 字段和提示，前端据此展示空状态
        insufficient: dna.insufficient || false,
        insufficientMessage: dna.insufficient
          ? `聆听数据不足（当前 ${dna.eventCount} 条，至少需要 5 条），多听几首歌让系统了解你的音乐偏好`
          : null,
      },
    });
  }

  async recompute(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const result = await svc.recomputeAndPersist(userId);
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
