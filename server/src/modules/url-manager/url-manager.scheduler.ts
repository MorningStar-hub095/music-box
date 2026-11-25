/**
 * URL 管理调度器
 *
 * 定时任务：
 *   1. 每小时检查热门歌曲 URL (访问频率 > 10次/天)
 *   2. 每6小时全量检查并刷新失效 URL
 *   3. 每天凌晨3点清理过期缓存和旧预警
 *   4. 每5分钟检查预警条件
 *
 * 2026-08-08 新增：闭环自动化管理
 */

import { UrlManagerService } from './url-manager.service';
import { UrlMonitorService } from './url-manager.monitor';
import { urlManagerConfig } from './url-manager.config';
import { withRedis } from '../../lib/redis';
import prisma from '../../lib/prisma';

export class UrlSchedulerService {
  private urlManager: UrlManagerService;
  private monitor: UrlMonitorService;
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  // 任务状态跟踪（避免重叠执行）
  private taskStatus: Record<string, { running: boolean; lastRun: Date | null; lastResult: any }> = {
    hotCheck: { running: false, lastRun: null, lastResult: null },
    fullCheck: { running: false, lastRun: null, lastResult: null },
    preDetection: { running: false, lastRun: null, lastResult: null },
    failedRetry: { running: false, lastRun: null, lastResult: null },
    cacheCleanup: { running: false, lastRun: null, lastResult: null },
    alertCheck: { running: false, lastRun: null, lastResult: null },
    audioPreDownload: { running: false, lastRun: null, lastResult: null },
    audioWarmup: { running: false, lastRun: null, lastResult: null },
  };

  constructor(urlManager?: UrlManagerService, monitor?: UrlMonitorService) {
    this.urlManager = urlManager || new UrlManagerService();
    this.monitor = monitor || new UrlMonitorService();
  }

  /**
   * 启动所有定时任务
   */
  start(): void {
    if (this.running) {
      console.warn('[URL-SCHEDULER] 调度器已在运行');
      return;
    }
    this.running = true;
    const cfg = urlManagerConfig.schedule;
    console.log('[URL-SCHEDULER] 启动定时任务调度器');

    // 1. 热门歌曲检查
    this.timers.push(setInterval(
      () => this.runTask('hotCheck', () => this.checkHotTracks()),
      cfg.hotCheckInterval,
    ).unref());

    // 2. 全量检查
    this.timers.push(setInterval(
      () => this.runTask('fullCheck', () => this.fullCheck()),
      cfg.fullCheckInterval,
    ).unref());

    // 3. 预检测即将过期的 URL
    this.timers.push(setInterval(
      () => this.runTask('preDetection', () => this.preDetection()),
      cfg.preDetectionInterval,
    ).unref());

    // 4. 已失效歌曲重试
    this.timers.push(setInterval(
      () => this.runTask('failedRetry', () => this.retryFailedSongs()),
      cfg.failedRetryInterval,
    ).unref());

    // 5. 缓存清理
    this.timers.push(setInterval(
      () => this.runTask('cacheCleanup', () => this.cleanupCache()),
      cfg.cacheCleanupInterval,
    ).unref());

    // 6. 预警检查
    this.timers.push(setInterval(
      () => this.runTask('alertCheck', () => this.checkAlerts()),
      cfg.alertCheckInterval,
    ).unref());

    // 7. 音频本地缓存预下载（每15分钟下载15首热门歌曲到本地，加速缓存覆盖）
    this.timers.push(setInterval(
      () => this.runTask('audioPreDownload', () => this.audioPreDownload()),
      15 * 60 * 1000,
    ).unref());

    // 启动后延迟执行：预警检查(10s)、预检测(30s)、热门检查(60s)、音频预下载(90s)
    setTimeout(() => this.runTask('alertCheck', () => this.checkAlerts()), 10 * 1000).unref();
    setTimeout(() => this.runTask('preDetection', () => this.preDetection()), 30 * 1000).unref();
    setTimeout(() => this.runTask('hotCheck', () => this.checkHotTracks()), 60 * 1000).unref();
    setTimeout(() => this.runTask('audioPreDownload', () => this.audioPreDownload()), 90 * 1000).unref();
    // 启动批量预下载：延迟300秒后下载50首热门歌曲，降低启动瞬时压力
    setTimeout(() => this.runTask('audioWarmup', () => this.audioWarmup()), 300 * 1000).unref();

    console.log('[URL-SCHEDULER] 定时任务已注册:');
    console.log(`  - 热门检查: 每${cfg.hotCheckInterval / 60000}分钟`);
    console.log(`  - 全量检查: 每${cfg.fullCheckInterval / 3600000}小时`);
    console.log(`  - 预检测: 每${cfg.preDetectionInterval / 60000}分钟`);
    console.log(`  - 失效重试: 每${cfg.failedRetryInterval / 3600000}小时`);
    console.log(`  - 缓存清理: 每${cfg.cacheCleanupInterval / 3600000}小时`);
    console.log(`  - 预警检查: 每${cfg.alertCheckInterval / 60000}分钟`);
    console.log('  - 音频预下载: 每30分钟');
  }

  /**
   * 停止所有定时任务
   */
  stop(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.running = false;
    console.log('[URL-SCHEDULER] 调度器已停止');
  }

  /**
   * 运行任务（带重叠保护和错误处理）
   */
  private async runTask(name: string, task: () => Promise<any>): Promise<void> {
    const status = this.taskStatus[name];
    if (status.running) {
      console.warn(`[URL-SCHEDULER] 任务 ${name} 正在运行，跳过本次执行`);
      return;
    }

    status.running = true;
    const startTime = Date.now();
    console.log(`[URL-SCHEDULER] 开始执行: ${name}`);

    try {
      const result = await task();
      status.lastResult = result;
      const duration = Date.now() - startTime;
      console.log(`[URL-SCHEDULER] 任务完成: ${name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[URL-SCHEDULER] 任务失败: ${name} (${duration}ms):`, err instanceof Error ? err.message : err);
      status.lastResult = { error: err instanceof Error ? err.message : String(err) };
    } finally {
      status.running = false;
      status.lastRun = new Date();
    }
  }

  /**
   * 检查热门歌曲 URL
   */
  private async checkHotTracks(): Promise<{ checked: number; refreshed: number }> {
    const hotTrackIds = await this.urlManager.getHotTracks(30);
    if (hotTrackIds.length === 0) {
      console.log('[URL-SCHEDULER] 无热门曲目，跳过');
      return { checked: 0, refreshed: 0 };
    }

    console.log(`[URL-SCHEDULER] 检查 ${hotTrackIds.length} 首热门歌曲`);
    const result = await this.urlManager.batchCheckAndRefresh(hotTrackIds, 30);
    return { checked: result.total, refreshed: result.refreshed };
  }

  /**
   * 全量检查并刷新失效 URL
   */
  private async fullCheck(): Promise<any> {
    console.log('[URL-SCHEDULER] 开始全量URL检查...');
    const result = await this.urlManager.batchCheckAndRefresh(undefined, urlManagerConfig.batchSize);

    // 输出汇总
    console.log(`[URL-SCHEDULER] 全量检查完成:`);
    console.log(`  总数: ${result.total}`);
    console.log(`  有效: ${result.valid}`);
    console.log(`  刷新: ${result.refreshed}`);
    console.log(`  失败: ${result.failed}`);

    // 触发预警检查
    await this.checkAlerts();

    return result;
  }

  /**
   * 清理缓存和旧记录
   *
   * 修复: 原实现在 for 循环中对 multi() pipeline 使用 await client.get(key)，
   * 但 multi().get() 返回的是 pipeline 对象而非 Promise，导致 data 始终为 pipeline 对象。
   * 现改为：先批量读取所有 key 的值，再对过期的 key 批量删除。
   */
  private async cleanupCache(): Promise<{ redisKeys: number; alerts: number }> {
    let redisKeys = 0;
    let alerts = 0;

    // 1. 清理 Redis 过期 URL 缓存
    redisKeys = await withRedis(async (client) => {
      const keys = await client.keys('url:cache:*');
      if (keys.length === 0) return 0;

      // 先批量获取所有值（在 multi 之外使用 await）
      const values = await Promise.all(keys.map((key) => client.get(key)));
      const expiredKeys: string[] = [];

      for (let i = 0; i < keys.length; i++) {
        const data = values[i];
        if (!data) {
          expiredKeys.push(keys[i]);
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.expiresAt < Date.now()) {
            expiredKeys.push(keys[i]);
          }
        } catch {
          expiredKeys.push(keys[i]);
        }
      }

      if (expiredKeys.length === 0) return 0;

      // 批量删除过期 key
      const pipeline = client.multi();
      for (const key of expiredKeys) {
        pipeline.del(key);
      }
      const results = await pipeline.exec();
      return results ? results.filter((r) => r[1] === 1).length : 0;
    }, 0);

    // 2. 清理 30 天前的已解决预警
    alerts = await this.monitor.cleanupOldAlerts();

    console.log(`[URL-SCHEDULER] 缓存清理完成: Redis键${redisKeys}, 预警记录${alerts}`);
    return { redisKeys, alerts };
  }

  /**
   * 预检测即将过期的 URL
   */
  private async preDetection(): Promise<{ scanned: number; refreshed: number }> {
    const result = await this.urlManager.preDetectionRefresh();
    console.log(`[URL-SCHEDULER] 预检测完成: 扫描${result.scanned}, 刷新${result.refreshed}`);
    return result;
  }

  /**
   * 重试已失效的歌曲
   * 对 playable=false 且距离上次失败超过阈值的歌曲重新尝试刷新
   */
  private async retryFailedSongs(): Promise<{ total: number; refreshed: number; stillFailed: number }> {
    const retryCutoff = new Date(Date.now() - urlManagerConfig.failedSongRetryInterval);

    const failedSongs = await prisma.song.findMany({
      where: {
        archived: false,
        playable: false,
        OR: [
          { urlLastFailure: null },
          { urlLastFailure: { lt: retryCutoff } },
        ],
      },
      orderBy: { hotScore: 'desc' },
      take: 50, // 从20增到50，加速失效歌曲恢复
      select: { id: true, title: true },
    });

    if (failedSongs.length === 0) {
      return { total: 0, refreshed: 0, stillFailed: 0 };
    }

    console.log(`[URL-SCHEDULER] 重试失效歌曲: ${failedSongs.length} 首`);

    let refreshed = 0;
    for (const song of failedSongs) {
      try {
        const newUrl = await this.urlManager.refreshUrl(song.id, 'scheduler');
        if (newUrl) refreshed++;
      } catch (err) {
        console.warn(`[URL-SCHEDULER] 重试失败 ${song.title}:`, err instanceof Error ? err.message : err);
      }
    }

    return { total: failedSongs.length, refreshed, stillFailed: failedSongs.length - refreshed };
  }

  /**
   * 音频本地缓存预下载：下载热门歌曲到本地，永久解决URL失效问题
   */
  private async audioPreDownload(): Promise<{ downloaded: number }> {
    const { preDownloadPopular, getCacheStats } = require('../audio-cache/audio-cache.service');
    const stats = getCacheStats();
    console.log(`[AUDIO-PRE-DOWNLOAD] 当前缓存: ${stats.totalFiles}首, ${stats.totalSizeMB}MB`);
    const downloaded = await preDownloadPopular(15); // 从5增到15
    const newStats = getCacheStats();
    return { downloaded };
  }

  /**
   * 启动时批量预下载：下载50首热门歌曲，加速首次缓存覆盖
   */
  private async audioWarmup(): Promise<{ downloaded: number }> {
    const { preDownloadPopular, getCacheStats } = require('../audio-cache/audio-cache.service');
    const stats = getCacheStats();
    console.log(`[AUDIO-WARMUP] 启动预热开始，当前缓存: ${stats.totalFiles}首, ${stats.totalSizeMB}MB`);
    const downloaded = await preDownloadPopular(50);
    const newStats = getCacheStats();
    console.log(`[AUDIO-WARMUP] 启动预热完成: 下载${downloaded}首，总缓存${newStats.totalFiles}首, ${newStats.totalSizeMB}MB`);
    return { downloaded };
  }

  /**
   * 检查预警并发送通知
   */
  private async checkAlerts(): Promise<{ alertCount: number }> {
    const alerts = await this.monitor.checkAlerts();
    if (alerts.length > 0) {
      console.warn(`[URL-SCHEDULER] 发现 ${alerts.length} 条预警`);
      for (const alert of alerts) {
        console.warn(`  [${alert.level}] ${alert.type}: ${alert.message}`);
      }
      // TODO: 发送通知（邮件/钉钉等），可在配置中启用
    }
    return { alertCount: alerts.length };
  }

  /**
   * 获取调度器状态
   */
  getStatus(): {
    running: boolean;
    tasks: Record<string, { running: boolean; lastRun: Date | null; lastResult: any }>;
  } {
    return {
      running: this.running,
      tasks: this.taskStatus,
    };
  }
}

export const urlSchedulerService = new UrlSchedulerService();
