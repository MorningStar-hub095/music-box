import { Request, Response } from 'express';
import { RecommendationService } from './recommendation.service';
import prisma from '../../lib/prisma';

const svc = new RecommendationService();

export class RecommendationController {
  async daily(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let recs = await prisma.dailyRecommendation.findMany({
      where: { userId, generatedAt: { gte: today } },
      orderBy: { rank: 'asc' },
      include: { song: { include: { features: true } } },
    });
    if (recs.length === 0) {
      await svc.generateForUser(userId);
      recs = await prisma.dailyRecommendation.findMany({
        where: { userId, generatedAt: { gte: today } },
        orderBy: { rank: 'asc' },
        include: { song: { include: { features: true } } },
      });
    }
    return res.json({
      success: true,
      data: { songs: recs.map(r => r.song), generatedAt: recs[0]?.generatedAt },
    });
  }

  async feedback(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const { songId, feedback, weight } = req.body;
    const w = weight ?? (feedback === 'dislike' ? 2 : feedback === 'favorite' ? 3 : 1);
    await prisma.recommendationFeedback.create({
      data: { userId, songId, feedback, weight: w },
    });
    if (feedback === 'dislike') {
      await prisma.dailyRecommendation.deleteMany({ where: { userId, songId } });
      setImmediate(() => {
        svc.generateForUser(userId).catch(err => {
          console.error('[recommendation/feedback] async recompute error:', err);
        });
      });
    }
    return res.json({ success: true });
  }

  /** 获取相似歌曲推荐 */
  async similarSongs(req: Request, res: Response) {
    try {
      const { songId } = req.params;
      const limit = parseInt(req.query.limit as string) || 5;
      const songs = await svc.getSimilarSongs(songId, limit);
      return res.json({ success: true, data: songs });
    } catch (err: any) {
      console.error('[recommendation/similar] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /** 获取用户画像 */
  async userProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const profile = await svc.getUserProfile(userId);
      return res.json({ success: true, data: profile });
    } catch (err: any) {
      console.error('[recommendation/profile] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /** 获取行为洞察 */
  async behaviorInsight(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const insight = await svc.getBehaviorInsight(userId);
      return res.json({ success: true, data: insight });
    } catch (err: any) {
      console.error('[recommendation/behavior] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /** 更新推荐配置 */
  async updateConfig(req: Request, res: Response) {
    try {
      svc.updateConfig(req.body);
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[recommendation/config] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /** 获取推荐质量评估报告 */
  async qualityReport(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const report = await svc.getQualityReport(userId);
      return res.json({ success: true, data: report });
    } catch (err: any) {
      console.error('[recommendation/quality] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}
