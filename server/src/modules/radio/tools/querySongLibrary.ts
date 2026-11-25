/**
 * LangChain Agent Tools - 曲库搜索
 */

// @ts-ignore - langchain types resolved at runtime
import { DynamicStructuredTool } from '@langchain/core/tools';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

export function createQuerySongLibraryTool(prisma: PrismaClient) {
  return new DynamicStructuredTool({
    name: 'querySongLibrary',
    description: '从音乐曲库中搜索歌曲。支持按风格(genre)、情绪(mood)、场景(scene)、艺术家(artist)、歌名(title)搜索。返回匹配的歌曲列表，每首歌附带风格/情绪/场景标签，按热度(hotScore)降序排列，便于判断匹配度。',
    schema: z.object({
      genre: z.string().optional().describe('音乐风格，如：流行、摇滚、民谣、电子、古典'),
      mood: z.string().optional().describe('情绪标签，如：欢快、悲伤、激昂、平静'),
      scene: z.string().optional().describe('场景标签，如：工作、运动、放松、约会'),
      artist: z.string().optional().describe('艺术家名称（模糊匹配）'),
      title: z.string().optional().describe('歌曲名称（模糊匹配）'),
      limit: z.number().optional().default(10).describe('返回数量，默认10'),
    }),
    func: async ({ genre, mood, scene, artist, title, limit }) => {
      try {
        const where: any = { playable: true, archived: false };

        if (artist) where.artist = { contains: artist };
        if (title) where.title = { contains: title };

        if (genre) {
          where.genres = { some: { genre: { name: { contains: genre } } } };
        }
        if (mood) {
          where.moods = { some: { mood: { name: { contains: mood } } } };
        }
        if (scene) {
          where.scenes = { some: { scene: { name: { contains: scene } } } };
        }

        const songs = await prisma.song.findMany({
          where,
          take: limit,
          orderBy: { hotScore: 'desc' },
          select: {
            id: true,
            title: true,
            artist: true,
            album: true,
            duration: true,
            hotScore: true,
            genres: { select: { genre: { select: { name: true } } } },
            moods: { select: { mood: { select: { name: true } } } },
            scenes: { select: { scene: { select: { name: true } } } },
          },
        });

        const result = songs.map(s => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          album: s.album,
          duration: s.duration,
          hotScore: s.hotScore,
          genres: s.genres.map(g => g.genre.name),
          moods: s.moods.map(m => m.mood.name),
          scenes: s.scenes.map(sc => sc.scene.name),
        }));

        return JSON.stringify(result);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  });
}
