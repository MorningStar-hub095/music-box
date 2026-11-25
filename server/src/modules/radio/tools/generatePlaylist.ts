/**
 * LangChain Agent Tools - 生成播放列表
 */

// @ts-ignore - langchain types resolved at runtime
import { DynamicStructuredTool } from '@langchain/core/tools';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

export function createGeneratePlaylistTool(prisma: PrismaClient, userId: number) {
  return new DynamicStructuredTool({
    name: 'generatePlaylist',
    description: '生成推荐播放列表。接收歌曲ID列表和主题/情绪关键词，验证歌曲可播放，按主题匹配度排序并做多样性重排，返回与回答主题一致的播放列表。这是推荐流程的最终步骤。',
    schema: z.object({
      songIds: z.array(z.string()).describe('歌曲ID列表，按推荐优先级排序'),
      reason: z.string().describe('推荐理由，简要说明为什么推荐这些歌曲'),
      theme: z.string().optional().describe('歌单主题/情绪/风格关键词（如：轻松、夜晚、欢快、摇滚），用于确保推荐歌曲与回答主题一致'),
    }),
    func: async ({ songIds, reason, theme }) => {
      try {
        if (!songIds || songIds.length === 0) {
          return JSON.stringify({ error: '没有提供歌曲ID' });
        }

        const songs = await prisma.song.findMany({
          where: {
            id: { in: songIds },
            playable: true,
          },
          select: {
            id: true,
            title: true,
            artist: true,
            duration: true,
            hotScore: true,
            genres: { select: { genre: { select: { name: true } } } },
            moods: { select: { mood: { select: { name: true } } } },
            scenes: { select: { scene: { select: { name: true } } } },
          },
        });

        if (songs.length === 0) {
          return JSON.stringify({ error: '没有找到可播放的歌曲' });
        }

        // 提取标签并计算与主题的匹配度
        const enriched = songs.map(s => {
          const tags = [
            ...s.genres.map(g => g.genre.name),
            ...s.moods.map(m => m.mood.name),
            ...s.scenes.map(sc => sc.scene.name),
          ];
          const themeMatch = calcThemeMatch(tags, theme);
          // 综合分（0-1）：有主题时主题匹配主导，否则热度主导
          const hotNorm = Math.min(1, (s.hotScore || 0) / 100);
          const score = theme ? themeMatch * 0.85 + hotNorm * 0.15 : hotNorm;
          return { ...s, tags, themeMatch, score };
        });

        // 按综合分降序（主题匹配的靠前）
        enriched.sort((a, b) => b.score - a.score);

        // MMR 多样性重排：主题相关度与风格多样性之间平衡（λ=0.7）
        const diverse = mmrDiverse(enriched, 0.7);

        // 返回给前端的结构保持简洁（不含内部标签）
        const result = diverse.map(s => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          duration: s.duration,
        }));

        return JSON.stringify({
          success: true,
          reason,
          theme: theme || null,
          songs: result,
          total: result.length,
        });
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  });
}

/** 计算歌曲标签与主题关键词的匹配度（0-1） */
function calcThemeMatch(tags: string[], theme?: string): number {
  if (!theme) return 0;
  const keywords = theme.split(/[,，、\s/]+/).filter(Boolean);
  if (keywords.length === 0) return 0;
  let hit = 0;
  for (const kw of keywords) {
    const low = kw.toLowerCase();
    if (tags.some(t => t.toLowerCase().includes(low) || low.includes(t.toLowerCase()))) {
      hit++;
    }
  }
  return hit / keywords.length;
}

/** 集合 Jaccard 相似度 */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const x of a) if (setB.has(x)) inter++;
  const union = a.length + b.length - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * MMR 多样性重排：MMR = λ·score − (1−λ)·maxSimilarity
 * score 为主题匹配度（有主题时）或热度（无主题时），用于保证推荐与回答主题一致且风格不扎堆。
 */
function mmrDiverse(songs: any[], lambda: number): any[] {
  if (songs.length <= 1) return songs;

  const remaining = [...songs];
  const selected: any[] = [];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccard(cand.tags, sel.tags);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
