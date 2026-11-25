import { request } from 'http';
import { request as httpsRequest } from 'https';
import prisma from '../../lib/prisma';
import { auditService } from '../../services/audit.service';
// 手动添加歌曲：加密生成唯一 ID、解析工具脚本路径、调用 Python 搜索脚本
import crypto from 'crypto';
import path from 'path';
import { runPython } from '../../lib/python-runner';

interface SongFilters {
  genres?: string;
  languages?: string;
  scenes?: string;
  moods?: string;
  decades?: string;
  tags?: string;
  platform?: string;
  search?: string;
  sort?: string;
  order?: string;
  page?: number;
  limit?: number;
  includeArchived?: boolean;
}

interface SongData {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl: string;
  audioUrlMp3?: string;
  lyricContent?: string;
  coverColor?: string;
  platform?: string;
  dataSource?: string;
  sourceUrl?: string;
  genres?: number[];
  languages?: number[];
  scenes?: number[];
  moods?: number[];
  decades?: number[];
  tags?: number[];
}

const songInclude = {
  genres: { include: { genre: true } },
  languages: { include: { language: true } },
  scenes: { include: { scene: true } },
  moods: { include: { mood: true } },
  decades: { include: { decade: true } },
  tags: { include: { tag: true } },
};

/**
 * 验证音频 URL 是否真实可达
 * 使用 GET Range 请求（前1KB），超时 8 秒
 * 网易云CDN对HEAD请求可能返回403，但GET Range正常返回206
 */
export async function checkAudioUrlPlayable(url: string): Promise<boolean> {
  if (!url) return false;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    try {
      const isHttps = url.startsWith('https://');
      const options: any = {
        method: 'GET',
        timeout: 8000,
        headers: { 'Range': 'bytes=0-1023' },
      };
      const handler = (res: any) => {
        // 200 (OK) 或 206 (Partial Content) 均视为可达
        settle(res.statusCode === 200 || res.statusCode === 206);
        // 立即销毁连接，不下载完整响应
        res.destroy();
      };
      const req = isHttps
        ? httpsRequest(url, options, handler)
        : request(url, options, handler);

      req.on('error', () => settle(false));
      req.on('timeout', () => {
        req.destroy();
        settle(false);
      });
      req.end();
    } catch {
      settle(false);
    }
  });
}

export class SongsService {
  async getSongs(filters: SongFilters) {
    const {
      genres,
      languages,
      scenes,
      moods,
      decades,
      tags,
      platform,
      search,
      sort = 'hot_score',
      order = 'desc',
      page = 1,
      limit = 20,
      includeArchived = false,
    } = filters;

    const where: any = {};

    // 默认排除已归档的歌曲
    if (!includeArchived) {
      where.archived = false;
    }

    if (genres) {
      const genreIds = genres.split(',').map(Number);
      where.genres = { some: { genreId: { in: genreIds } } };
    }

    if (languages) {
      const languageIds = languages.split(',').map(Number);
      where.languages = { some: { languageId: { in: languageIds } } };
    }

    if (scenes) {
      const sceneIds = scenes.split(',').map(Number);
      where.scenes = { some: { sceneId: { in: sceneIds } } };
    }

    if (moods) {
      const moodIds = moods.split(',').map(Number);
      where.moods = { some: { moodId: { in: moodIds } } };
    }

    if (decades) {
      const decadeIds = decades.split(',').map(Number);
      where.decades = { some: { decadeId: { in: decadeIds } } };
    }

    if (tags) {
      const tagIds = tags.split(',').map(Number);
      where.tags = { some: { tagId: { in: tagIds } } };
    }

    if (platform) {
      where.platform = platform;
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { artist: { contains: search } },
        { album: { contains: search } },
        { lyricContent: { contains: search } },
      ];
    }

    const sortFieldMap: Record<string, string> = {
      hot_score: 'hotScore',
      created_at: 'createdAt',
      title: 'title',
      artist: 'artist',
    };

    const orderBy = {
      [sortFieldMap[sort] || 'hotScore']: order === 'asc' ? 'asc' : 'desc',
    };

    const skip = (page - 1) * limit;

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        include: songInclude,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.song.count({ where }),
    ]);

    return {
      songs,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async getSongById(id: string) {
    const song = await prisma.song.findUnique({
      where: { id },
      include: songInclude,
    });

    if (!song) {
      throw new Error('歌曲不存在');
    }

    return song;
  }

  /**
   * 手动添加歌曲：按「歌名+歌手」自动搜索可播放 URL，或使用手动指定的 URL。
   * 复用 checkAudioUrlPlayable 验证 URL、search_song_url.py 自动搜索。
   */
  async addManualSong(title: string, artist: string = '', audioUrl?: string, userId?: number) {
    // 1. 去重：按 title + artist（忽略大小写）查找已存在歌曲
    const existing = await prisma.song.findFirst({
      where: {
        title: { equals: title, mode: 'insensitive' },
        ...(artist ? { artist: { equals: artist, mode: 'insensitive' } } : {}),
        archived: false,
      },
    });
    if (existing) {
      return existing;
    }

    // 2. 获取 URL
    let finalUrl: string;
    let platform = 'manual';
    if (audioUrl) {
      // 手动指定 URL：验证可播放
      const valid = await checkAudioUrlPlayable(audioUrl);
      if (!valid) {
        throw new Error('音频URL不可播放，请检查链接');
      }
      finalUrl = audioUrl;
    } else {
      // 自动搜索：按歌名+歌手在网易云搜索
      const scriptPath = path.resolve(process.cwd(), '..', 'tools', 'search_song_url.py');
      const { stdout } = await runPython([scriptPath, title, artist], { timeout: 30000 });
      let result: any;
      try {
        result = JSON.parse(stdout);
      } catch {
        throw new Error('搜索脚本返回异常');
      }
      if (!result.success || !result.url) {
        throw new Error(result.error || '未找到可播放版本');
      }
      finalUrl = result.url;
      platform = 'netease';
    }

    // 3. 创建歌曲（自动生成唯一 ID）
    const id = `manual:${crypto.randomUUID()}`;
    const song = await this.createSong({
      id,
      title,
      artist: artist || '未知歌手',
      audioUrl: finalUrl,
      platform,
      dataSource: 'manual',
      sourceUrl: finalUrl,
    } as any, userId);

    return song;
  }

  async createSong(data: SongData, userId?: number, ipAddress?: string) {
    const { genres, languages, scenes, moods, decades, tags, ...songData } = data;

    const existingSong = await prisma.song.findUnique({ where: { id: data.id } });
    if (existingSong) {
      throw new Error('歌曲ID已存在');
    }

    const song = await prisma.song.create({
      data: {
        ...songData,
        dataSource: (songData.dataSource as any) || 'manual',
        importedBy: userId,
        importedAt: new Date(),
        genres: genres?.length
          ? { create: genres.map((genreId) => ({ genreId })) }
          : undefined,
        languages: languages?.length
          ? { create: languages.map((languageId) => ({ languageId })) }
          : undefined,
        scenes: scenes?.length
          ? { create: scenes.map((sceneId) => ({ sceneId })) }
          : undefined,
        moods: moods?.length
          ? { create: moods.map((moodId) => ({ moodId })) }
          : undefined,
        decades: decades?.length
          ? { create: decades.map((decadeId) => ({ decadeId })) }
          : undefined,
        tags: tags?.length
          ? { create: tags.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: songInclude,
    });

    // 记录审计日志
    await auditService.log({
      userId,
      action: 'create',
      targetType: 'song',
      targetId: song.id,
      newValues: songData,
      ipAddress,
    });

    return song;
  }

  async updateSong(id: string, data: Partial<SongData>, userId?: number, ipAddress?: string) {
    const existingSong = await prisma.song.findUnique({ where: { id } });
    if (!existingSong) {
      throw new Error('歌曲不存在');
    }

    const { genres, languages, scenes, moods, decades, tags, dataSource, ...songData } = data;

    // 计算变更
    const changes = auditService.calculateChanges(existingSong as any, { ...songData, dataSource });

    const song = await prisma.song.update({
      where: { id },
      data: {
        ...songData,
        ...(dataSource ? { dataSource: dataSource as any } : {}),
        lastEditedBy: userId,
        genres: genres !== undefined
          ? { deleteMany: {}, create: genres.map((genreId) => ({ genreId })) }
          : undefined,
        languages: languages !== undefined
          ? { deleteMany: {}, create: languages.map((languageId) => ({ languageId })) }
          : undefined,
        scenes: scenes !== undefined
          ? { deleteMany: {}, create: scenes.map((sceneId) => ({ sceneId })) }
          : undefined,
        moods: moods !== undefined
          ? { deleteMany: {}, create: moods.map((moodId) => ({ moodId })) }
          : undefined,
        decades: decades !== undefined
          ? { deleteMany: {}, create: decades.map((decadeId) => ({ decadeId })) }
          : undefined,
        tags: tags !== undefined
          ? { deleteMany: {}, create: tags.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: songInclude,
    });

    // 记录审计日志
    if (changes.changedFields.length > 0) {
      await auditService.log({
        userId,
        action: 'update',
        targetType: 'song',
        targetId: id,
        oldValues: changes.oldValues,
        newValues: changes.newValues,
        changedFields: changes.changedFields,
        ipAddress,
      });
    }

    return song;
  }

  async deleteSong(id: string) {
    const existingSong = await prisma.song.findUnique({ where: { id } });
    if (!existingSong) {
      throw new Error('歌曲不存在');
    }

    await prisma.song.delete({ where: { id } });
    return { message: '歌曲已删除' };
  }

  async batchUpdateSongs(songIds: string[], data: Partial<SongData>) {
    const { genres, languages, scenes, moods, decades, tags, dataSource, ...songData } = data;

    const results = await Promise.all(
      songIds.map(async (id) => {
        try {
          const song = await prisma.song.update({
            where: { id },
            data: {
              ...songData,
              ...(dataSource ? { dataSource: dataSource as any } : {}),
              genres: genres !== undefined
                ? { deleteMany: {}, create: genres.map((genreId) => ({ genreId })) }
                : undefined,
              languages: languages !== undefined
                ? { deleteMany: {}, create: languages.map((languageId) => ({ languageId })) }
                : undefined,
              scenes: scenes !== undefined
                ? { deleteMany: {}, create: scenes.map((sceneId) => ({ sceneId })) }
                : undefined,
              moods: moods !== undefined
                ? { deleteMany: {}, create: moods.map((moodId) => ({ moodId })) }
                : undefined,
              decades: decades !== undefined
                ? { deleteMany: {}, create: decades.map((decadeId) => ({ decadeId })) }
                : undefined,
              tags: tags !== undefined
                ? { deleteMany: {}, create: tags.map((tagId) => ({ tagId })) }
                : undefined,
            },
            include: songInclude,
          });
          return { id, success: true, song };
        } catch (error) {
          return { id, success: false, error: error instanceof Error ? error.message : '更新失败' };
        }
      })
    );

    return results;
  }

  async batchDeleteSongs(songIds: string[]) {
    const results = await Promise.all(
      songIds.map(async (id) => {
        try {
          await prisma.song.delete({ where: { id } });
          return { id, success: true };
        } catch (error) {
          return { id, success: false, error: error instanceof Error ? error.message : '删除失败' };
        }
      })
    );

    return results;
  }

  async checkUrlStatus(id: string) {
    const song = await prisma.song.findUnique({ where: { id } });
    if (!song) {
      throw new Error('歌曲不存在');
    }

    // 真实验证 URL 可达性（HTTP HEAD 请求）
    const isPlayable = await checkAudioUrlPlayable(song.audioUrl);

    await prisma.song.update({
      where: { id },
      data: {
        playable: isPlayable,
        urlCheckedAt: new Date(),
      },
    });

    return {
      id: song.id,
      playable: isPlayable,
      audioUrl: song.audioUrl,
      audioUrlMp3: song.audioUrlMp3,
      urlCheckedAt: new Date(),
    };
  }

  async refreshUrl(id: string) {
    const song = await prisma.song.findUnique({ where: { id } });
    if (!song) {
      throw new Error('歌曲不存在');
    }

    const updatedSong = await prisma.song.update({
      where: { id },
      data: { urlCheckedAt: new Date() },
    });

    return {
      id: updatedSong.id,
      audioUrl: updatedSong.audioUrl,
      audioUrlMp3: updatedSong.audioUrlMp3,
      urlCheckedAt: updatedSong.urlCheckedAt,
      message: 'URL已刷新',
    };
  }

  /**
   * 真正刷新歌曲 URL：先检查当前 URL 是否可用，不可用则通过爬虫重新获取。
   * 供前端播放失败时调用（公开接口，无需认证）。
   */
  async refreshTrackUrl(id: string): Promise<{ url: string; refreshed: boolean }> {
    const song = await prisma.song.findUnique({ where: { id } });
    if (!song) throw new Error('歌曲不存在');

    // 1. 先检查当前 URL 是否仍然可用
    const isPlayable = await checkAudioUrlPlayable(song.audioUrl);
    if (isPlayable) {
      await prisma.song.update({
        where: { id },
        data: { playable: true, urlCheckedAt: new Date() },
      });
      return { url: song.audioUrl, refreshed: false };
    }

    // 2. 当前 URL 已失效，尝试通过 Python 爬虫重新获取
    const platform = (song.platform || 'netease').toLowerCase();
    if (platform === 'netease') {
      try {
        const path = require('path');
        const { runPython } = require('../../lib/python-runner');
        const scriptPath = path.resolve(__dirname, '../../../../tools/refresh_song_url.py');

        const { stdout } = await runPython([scriptPath, id], {
          timeout: 30000,
          encoding: 'utf8',
        });
        const result = JSON.parse(stdout.trim());
        if (result.success && result.url) {
          // 验证新 URL 确实可用
          const newPlayable = await checkAudioUrlPlayable(result.url);
          await prisma.song.update({
            where: { id },
            data: {
              audioUrl: result.url,
              playable: newPlayable,
              urlCheckedAt: new Date(),
            },
          });
          return { url: result.url, refreshed: true };
        }
      } catch (err) {
        console.error(`[refreshTrackUrl] 爬虫刷新失败 (${id}):`, err);
      }
    }

    // 3. 刷新失败，标记为不可播放（本地已缓存的歌曲仍可播放，播放走本地文件）
    const { isCached } = require('../audio-cache/audio-cache.service');
    await prisma.song.update({
      where: { id },
      data: { playable: isCached(id), urlCheckedAt: new Date() },
    });
    throw new Error('无法获取新的播放地址');
  }
}
