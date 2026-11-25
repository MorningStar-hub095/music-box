import { z } from 'zod';

// 分页参数验证
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// 排序参数验证
export const sortSchema = z.object({
  sort: z.enum(['hot_score', 'created_at', 'title', 'artist']).default('hot_score'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ID参数验证
export const idParamSchema = z.object({
  id: z.string().min(1, 'ID不能为空'),
});

// 批量操作验证
export const batchIdsSchema = z.object({
  songIds: z.array(z.string().min(1)).min(1, '至少选择一个项目'),
});
