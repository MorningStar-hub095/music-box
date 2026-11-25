import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : 
                   req.params;
      
      const validated = schema.parse(data);
      
      // 将验证后的数据赋值回去
      if (source === 'body') req.body = validated;
      else if (source === 'query') req.query = validated as any;
      else req.params = validated as any;
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          success: false,
          error: '数据验证失败',
          details: errors,
        });
      }
      next(error);
    }
  };
};
