import { z } from 'zod';

// 歌曲基础信息验证
export const songBaseSchema = z.object({
  title: z.string()
    .min(1, '歌曲标题不能为空')
    .max(200, '歌曲标题不能超过200个字符')
    .trim(),
  artist: z.string()
    .min(1, '艺术家名称不能为空')
    .max(200, '艺术家名称不能超过200个字符')
    .trim(),
  album: z.string()
    .max(200, '专辑名称不能超过200个字符')
    .trim()
    .optional()
    .nullable(),
  albumCover: z.string()
    .url('专辑封面URL格式无效')
    .max(500, 'URL长度不能超过500个字符')
    .optional()
    .nullable(),
  audioUrl: z.string()
    .url('音频URL格式无效')
    .max(500, 'URL长度不能超过500个字符'),
  audioUrlMp3: z.string()
    .url('MP3音频URL格式无效')
    .max(500, 'URL长度不能超过500个字符')
    .optional()
    .nullable(),
  lyricContent: z.string()
    .max(100000, '歌词内容过长')
    .optional()
    .nullable(),
  coverColor: z.string()
    .regex(/^#[0-9A-Fa-f]{6}$/, '封面颜色格式无效，应为#RRGGBB')
    .optional()
    .nullable(),
  platform: z.enum(['netease', 'qq', 'kugou', 'local', 'other'], {
    message: '无效的平台类型',
  }).optional().nullable(),
  playable: z.boolean().default(true),
});

// 创建歌曲验证
export const createSongSchema = songBaseSchema.extend({
  id: z.string()
    .min(1, '歌曲ID不能为空')
    .max(50, '歌曲ID长度不能超过50个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '歌曲ID只能包含字母、数字、下划线和连字符'),
  genres: z.array(z.number().int().positive()).optional(),
  languages: z.array(z.number().int().positive()).optional(),
  scenes: z.array(z.number().int().positive()).optional(),
  moods: z.array(z.number().int().positive()).optional(),
  decades: z.array(z.number().int().positive()).optional(),
  tags: z.array(z.number().int().positive()).optional(),
});

// 更新歌曲验证
export const updateSongSchema = songBaseSchema.partial().extend({
  genres: z.array(z.number().int().positive()).optional(),
  languages: z.array(z.number().int().positive()).optional(),
  scenes: z.array(z.number().int().positive()).optional(),
  moods: z.array(z.number().int().positive()).optional(),
  decades: z.array(z.number().int().positive()).optional(),
  tags: z.array(z.number().int().positive()).optional(),
});

// 歌曲筛选验证
export const songFiltersSchema = z.object({
  genres: z.string().optional(),
  languages: z.string().optional(),
  scenes: z.string().optional(),
  moods: z.string().optional(),
  decades: z.string().optional(),
  tags: z.string().optional(),
  platform: z.string().optional(),
  search: z.string().max(200, '搜索关键词过长').optional(),
  sort: z.enum(['hot_score', 'created_at', 'title', 'artist']).default('hot_score'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
