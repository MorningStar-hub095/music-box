import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { SongsService } from './songs.service';
// 手动触发热榜爬取
import { refreshHot100 } from '../playlists/hot100.service';

const songsService = new SongsService();

export class SongsController {
  async getSongs(req: AuthRequest, res: AuthResponse) {
    try {
      const filters = {
        genres: req.query.genres as string | undefined,
        languages: req.query.languages as string | undefined,
        scenes: req.query.scenes as string | undefined,
        moods: req.query.moods as string | undefined,
        decades: req.query.decades as string | undefined,
        tags: req.query.tags as string | undefined,
        platform: req.query.platform as string | undefined,
        search: req.query.search as string | undefined,
        sort: req.query.sort as string | undefined,
        order: req.query.order as string | undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      };

      const result = await songsService.getSongs(filters);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  async getSongById(req: AuthRequest, res: AuthResponse) {
    try {
      const { id } = req.params;
      const song = await songsService.getSongById(id);
      return res.json({
        success: true,
        data: song,
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  async createSong(req: AuthRequest, res: AuthResponse) {
    try {
      const songData = req.body;
      if (!songData.id || !songData.title || !songData.artist || !songData.audioUrl) {
        return res.status(400).json({
          success: false,
          error: '请提供歌曲ID、标题、艺术家和音频URL',
        });
      }

      const userId = req.user?.id;
      const ipAddress = req.ip || req.socket.remoteAddress;
      const song = await songsService.createSong(songData, userId, ipAddress);
      return res.status(201).json({
        success: true,
        data: song,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  /** 手动添加歌曲：自动搜或手动 URL */
  async addManualSong(req: AuthRequest, res: AuthResponse) {
    try {
      const { title, artist, audioUrl } = req.body || {};
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, error: '请提供歌曲标题' });
      }
      const userId = req.user?.id;
      const song = await songsService.addManualSong(
        title.trim(),
        (artist || '').trim(),
        audioUrl || undefined,
        userId,
      );
      return res.status(201).json({ success: true, data: song });
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error?.message || '添加失败' });
    }
  }

  /** 手动触发热榜爬取（同步等待完成，返回新增数量） */
  async refreshHot100(_req: AuthRequest, res: AuthResponse) {
    try {
      const result = await refreshHot100();
      return res.json({
        success: true,
        data: {
          count: result.count,
          addedCount: result.addedCount,
          message: `已添加 ${result.addedCount} 首热榜歌曲`,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || '操作失败' });
    }
  }

  async updateSong(req: AuthRequest, res: AuthResponse) {
    try {
      const { id } = req.params;
      const songData = req.body;
      const userId = req.user?.id;
      const ipAddress = req.ip || req.socket.remoteAddress;
      const song = await songsService.updateSong(id, songData, userId, ipAddress);
      return res.json({
        success: true,
        data: song,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  async deleteSong(req: AuthRequest, res: AuthResponse) {
    try {
      const { id } = req.params;
      const result = await songsService.deleteSong(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  async batchUpdateSongs(req: AuthRequest, res: AuthResponse) {
    try {
      const { songIds, ...data } = req.body;
      if (!songIds || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: '请提供要更新的歌曲ID列表',
        });
      }

      const results = await songsService.batchUpdateSongs(songIds, data);
      return res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  async batchDeleteSongs(req: AuthRequest, res: AuthResponse) {
    try {
      const { songIds } = req.body;
      if (!songIds || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: '请提供要删除的歌曲ID列表',
        });
      }

      const results = await songsService.batchDeleteSongs(songIds);
      return res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  async checkUrlStatus(req: AuthRequest, res: AuthResponse) {
    try {
      const { id } = req.params;
      const result = await songsService.checkUrlStatus(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }

  /** 公开接口：前端播放失败时按 ID 获取最新音频 URL（无需认证）。
   *  会先检查当前 URL 是否可用，不可用则通过爬虫重新获取。 */
  async refreshTrack(req: AuthRequest, res: AuthResponse) {
    try {
      const id = req.query.id as string;
      if (!id) {
        return res.status(400).json({ success: false, error: '缺少歌曲 ID' });
      }
      const result = await songsService.refreshTrackUrl(id);
      return res.json({
        success: true,
        new_url: result.url,
        refreshed: result.refreshed,
      });
    } catch (err: any) {
      if (err?.code === 'P2025' || String(err?.message).includes('Record to update not found')) {
        return res.status(404).json({ success: false, error: '歌曲不存在' });
      }
      if (String(err?.message).includes('歌曲不存在')) {
        return res.status(404).json({ success: false, error: '歌曲不存在' });
      }
      console.error('[refreshTrack] 错误:', err);
      return res.status(500).json({ success: false, error: err?.message || '刷新失败' });
    }
  }

  async refreshUrl(req: AuthRequest, res: AuthResponse) {
    try {
      const { id } = req.params;
      const result = await songsService.refreshUrl(id);
      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: '操作失败，请稍后重试',
      });
    }
  }
}
