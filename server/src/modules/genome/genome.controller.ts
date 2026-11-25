import { Request, Response } from 'express';
import { GenomeService } from './genome.service';

const svc = new GenomeService();

export class GenomeController {
  async getMap(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const data = await svc.getMap(userId);
      return res.json({ success: true, data });
    } catch (error) {
      console.error('[genome/map] error', error);
      return res.status(500).json({ success: false, error: '获取基因图谱失败' });
    }
  }

  async getCluster(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = await svc.getCluster(id);
      return res.json({ success: true, data });
    } catch (error) {
      console.error('[genome/cluster] error', error);
      return res.status(500).json({ success: false, error: '获取邻域失败' });
    }
  }

  /** 触发 PCA 重算（管理员/调试用，亦由 scheduler 每日调用） */
  async recompute(_req: Request, res: Response) {
    try {
      const result = await svc.computeAndPersistCoords();
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error('[genome/recompute] error', error);
      return res.status(500).json({ success: false, error: '重算基因图谱失败' });
    }
  }
}
