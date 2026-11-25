import { Request, Response } from 'express';
import { TimeMachineService } from './time-machine.service';
const svc = new TimeMachineService();
export class TimeMachineController {
  async query(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const at = new Date(String(req.query.at));
    const result = await svc.query(userId, at);
    return res.json({ success: true, data: result });
  }
}
