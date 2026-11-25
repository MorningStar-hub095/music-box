import prisma from '../../lib/prisma';
import { EventEmitter } from 'events';

// ==================== 类型定义 ====================

export interface SyncEvent {
  type: 'song_added' | 'song_updated' | 'song_archived' | 'playlist_updated';
  data: any;
  timestamp: Date;
}

export interface SyncStatus {
  lastSyncTime: Date | null;
  pendingChanges: number;
  isSyncing: boolean;
}

// ==================== 事件发射器 ====================

class SyncEventEmitter extends EventEmitter {}
export const syncEvents = new SyncEventEmitter();

// ==================== 数据同步服务 ====================

export class DataSyncService {
  private lastSyncTime: Date | null = null;
  private isSyncing = false;
  private pendingChanges: SyncEvent[] = [];

  constructor() {
    this.setupEventListeners();
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners() {
    // 监听歌曲添加事件
    syncEvents.on('song_added', (data) => {
      console.log('[Sync] 新歌曲添加:', data.title);
      this.pendingChanges.push({
        type: 'song_added',
        data,
        timestamp: new Date(),
      });
    });

    // 监听歌曲更新事件
    syncEvents.on('song_updated', (data) => {
      console.log('[Sync] 歌曲更新:', data.title);
      this.pendingChanges.push({
        type: 'song_updated',
        data,
        timestamp: new Date(),
      });
    });

    // 监听歌曲归档事件
    syncEvents.on('song_archived', (data) => {
      console.log('[Sync] 歌曲归档:', data.title);
      this.pendingChanges.push({
        type: 'song_archived',
        data,
        timestamp: new Date(),
      });
    });

    // 监听播放列表更新事件
    syncEvents.on('playlist_updated', (data) => {
      console.log('[Sync] 播放列表更新:', data.name);
      this.pendingChanges.push({
        type: 'playlist_updated',
        data,
        timestamp: new Date(),
      });
    });
  }

  /**
   * 触发歌曲添加事件
   */
  async notifySongAdded(song: any) {
    syncEvents.emit('song_added', song);
  }

  /**
   * 触发歌曲更新事件
   */
  async notifySongUpdated(song: any) {
    syncEvents.emit('song_updated', song);
  }

  /**
   * 触发歌曲归档事件
   */
  async notifySongArchived(song: any) {
    syncEvents.emit('song_archived', song);
  }

  /**
   * 触发播放列表更新事件
   */
  async notifyPlaylistUpdated(playlist: any) {
    syncEvents.emit('playlist_updated', playlist);
  }

  /**
   * 获取增量更新
   */
  async getIncrementalUpdates(lastSyncTime: Date) {
    const [newSongs, updatedSongs, archivedSongs] = await Promise.all([
      // 获取新增歌曲
      prisma.song.findMany({
        where: {
          createdAt: { gt: lastSyncTime },
          archived: false,
        },
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          albumCover: true,
          audioUrl: true,
          playable: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      // 获取更新的歌曲
      prisma.song.findMany({
        where: {
          updatedAt: { gt: lastSyncTime },
          createdAt: { lte: lastSyncTime },
          archived: false,
        },
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          albumCover: true,
          audioUrl: true,
          playable: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),

      // 获取归档的歌曲
      prisma.song.findMany({
        where: {
          archivedAt: { gt: lastSyncTime },
          archived: true,
        },
        select: {
          id: true,
          title: true,
          artist: true,
          archivedAt: true,
        },
        orderBy: { archivedAt: 'desc' },
      }),
    ]);

    return {
      newSongs,
      updatedSongs,
      archivedSongs,
      syncTime: new Date(),
    };
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus(): Promise<SyncStatus> {
    return {
      lastSyncTime: this.lastSyncTime,
      pendingChanges: this.pendingChanges.length,
      isSyncing: this.isSyncing,
    };
  }

  /**
   * 执行同步
   */
  async sync(clientLastSyncTime?: Date) {
    if (this.isSyncing) {
      return {
        success: false,
        message: '同步正在进行中',
      };
    }

    this.isSyncing = true;

    try {
      const lastSync = clientLastSyncTime || this.lastSyncTime || new Date(0);
      const updates = await this.getIncrementalUpdates(lastSync);

      this.lastSyncTime = new Date();
      this.pendingChanges = [];

      return {
        success: true,
        data: updates,
      };
    } catch (error) {
      console.error('[Sync] 同步失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '同步失败',
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 获取最新歌曲列表
   */
  async getLatestSongs(limit = 50) {
    return prisma.song.findMany({
      where: {
        archived: false,
        playable: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        albumCover: true,
        audioUrl: true,
        playCount: true,
        hotScore: true,
        createdAt: true,
      },
    });
  }

  /**
   * 获取热门歌曲
   */
  async getHotSongs(limit = 50) {
    return prisma.song.findMany({
      where: {
        archived: false,
        playable: true,
      },
      orderBy: { hotScore: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        albumCover: true,
        audioUrl: true,
        playCount: true,
        hotScore: true,
      },
    });
  }

  /**
   * 检查歌曲URL可用性
   */
  async checkSongAvailability(songId: string) {
    const song = await prisma.song.findUnique({
      where: { id: songId },
      select: {
        id: true,
        title: true,
        audioUrl: true,
        playable: true,
        urlCheckedAt: true,
      },
    });

    if (!song) {
      return { available: false, error: '歌曲不存在' };
    }

    // 检查是否需要重新验证
    const needsRecheck = !song.urlCheckedAt ||
      (Date.now() - song.urlCheckedAt.getTime()) > 24 * 60 * 60 * 1000;

    if (needsRecheck) {
      // 这里可以添加实际的URL检查逻辑
      // 目前直接返回状态
      await prisma.song.update({
        where: { id: songId },
        data: { urlCheckedAt: new Date() },
      });
    }

    return {
      available: song.playable,
      song,
      lastChecked: song.urlCheckedAt,
    };
  }
}

// 导出单例
export const dataSyncService = new DataSyncService();
