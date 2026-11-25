import { Request, Response } from 'express';
import { CapsuleService } from './capsule.service';

const svc = new CapsuleService();

export class CapsuleController {
  async seal(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const result = await svc.seal(userId, req.body);
    return res.status(result.skipped ? 200 : 201).json({ success: true, data: result });
  }
  async due(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const due = await svc.getDue(userId);
    return res.json({ success: true, data: due });
  }
}
