/**
 * LangChain Agent Tools - 外部搜索
 */

// @ts-ignore - langchain types resolved at runtime
import { DynamicStructuredTool } from '@langchain/core/tools';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { runPython } from '../../../lib/python-runner';
import { MUSIC_CRAWLER_SCRIPT } from '../../../config';

const CRAWLER_SCRIPT = MUSIC_CRAWLER_SCRIPT;
const SEARCH_TIMEOUT = 12000; // 12 秒超时，避免拖垮 AI 电台响应

export function createSearchExternalTool(prisma: PrismaClient) {
  return new DynamicStructuredTool({
    name: 'searchExternal',
    description: '从外部音乐平台（网易云等）搜索发现新歌。当曲库中没有匹配用户需求的歌曲时使用。搜索到的歌曲会自动写入曲库并返回可用的歌曲ID列表，供 generatePlaylist 使用。',
    schema: z.object({
      query: z.string().describe('搜索关键词，如：周杰伦 晴天、轻松的钢琴曲'),
    }),
    func: async ({ query }) => {
      try {
        // 1. 先检查曲库中是否有类似歌曲
        const existing = await prisma.song.findMany({
          where: {
            OR: [
              { title: { contains: query } },
              { artist: { contains: query } },
            ],
            playable: true,
          },
          take: 5,
          select: { id: true, title: true, artist: true },
        });

        if (existing.length > 0) {
          return JSON.stringify({
            source: 'library',
            message: '在曲库中找到了匹配的歌曲',
            songs: existing,
          });
        }

        // 2. 曲库没有，调用 Python 爬虫搜索外部平台（网易云等）
        let crawledSongs: any[] = [];
        try {
          const result = await runPython([
            CRAWLER_SCRIPT,
            'search',
            query,
            '--limit',
            '5',
          ], { timeout: SEARCH_TIMEOUT });
          const parsed = JSON.parse(result.stdout);
          crawledSongs = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          console.warn(`[Radio.searchExternal] 外部搜索失败 (${query}):`, e instanceof Error ? e.message : e);
        }

        if (crawledSongs.length === 0) {
          return JSON.stringify({
            source: 'external',
            message: `外部平台也未找到"${query}"的相关歌曲`,
          });
        }

        // 3. 轻量入库（去重 + upsert，不调用分类，保证响应速度）
        const saved: any[] = [];
        for (const s of crawledSongs) {
          try {
            const id = await upsertSong(prisma, s);
            saved.push({ id, title: s.title, artist: s.artist });
          } catch (e) {
            console.warn(`[Radio.searchExternal] 入库失败 (${s.title}):`, e instanceof Error ? e.message : e);
          }
        }

        return JSON.stringify({
          source: 'external',
          message: `从外部平台搜索到 ${saved.length} 首新歌并已加入曲库`,
          songs: saved,
        });
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    },
  });
}

/**
 * 轻量入库：按 title + artist 去重，存在则更新播放链接，不存在则新建。
 * 不调用 auto_classifier 分类，保证 AI 电台快速响应；标签可由后续定时任务补打。
 */
async function upsertSong(prisma: PrismaClient, songData: any): Promise<string> {
  const existing = await prisma.song.findFirst({
    where: { title: songData.title, artist: songData.artist },
    select: { id: true },
  });

  if (existing) {
    await prisma.song.update({
      where: { id: existing.id },
      data: {
        audioUrl: songData.audioUrl,
        album: songData.album,
        albumCover: songData.albumCover,
        playable: songData.playable ?? true,
        duration: songData.duration || null,
      },
    });
    return existing.id;
  }

  const fallbackId = `ext:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const newSong = await prisma.song.create({
    data: {
      id: songData.id || fallbackId,
      title: songData.title,
      artist: songData.artist,
      album: songData.album,
      albumCover: songData.albumCover,
      audioUrl: songData.audioUrl,
      lyricContent: songData.lyricContent,
      coverColor: songData.coverColor,
      duration: songData.duration || null,
      platform: songData.platform || 'external',
      playable: songData.playable ?? true,
      dataSource: 'crawler',
    },
  });
  return newSong.id;
}
