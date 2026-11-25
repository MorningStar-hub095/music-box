import { Request, Response, NextFunction } from 'express';

/**
 * 简单的输入净化中间件
 * 对字符串类型的 body 字段进行 trim 处理
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
      }
    }
  }
  next();
}
