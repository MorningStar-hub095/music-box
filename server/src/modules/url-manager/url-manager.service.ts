/**
 * URL 管理核心服务
 *
 * 功能：
 *   1. 多级缓存获取 URL (Redis → DB → 刷新)
 *   2. 多源并发获取新 URL (网易云/QQ/酷狗)
 *   3. 智能失效预测
 *   4. 批量检查与刷新
 *   5. 刷新日志记录
 *
 * 2026-08-08 新增：统一管理音频URL生命周期
 */

import path from 'path';
import prisma from '../../lib/prisma';
import { withRedis } from '../../lib/redis';
import { runPython } from '../../lib/python-runner';
import { checkAudioUrlPlayable } from '../songs/songs.service';
import { urlManagerConfig } from './url-manager.config';
import { UrlMonitorService } from './url-manager.monitor';
import { fetchMusicUrlFromMultipleSources, parseTrackId } from './music-api.service';

const execScriptPath = path.resolve(__dirname, '../../../../tools/refresh_song_url.py');
const searchScriptPath = path.resolve(__dirname, '../../../../tools/search_song_url.py');

export interface UrlResult {
  url: string;
  source: string;
  refreshed: boolean;
  cached: boolean;
}

export interface BatchResult {
  total: number;
  valid: number;
  refreshed: number;
  failed: number;
  skipped: number;
  details: BatchDetail[];
}

export interface BatchDetail {
  id: string;
  title: string;
  status: 'valid' | 'refreshed' | 'failed' | 'skipped';
  url?: string;
  source?: string;
  error?: string;
}

/**
 * 指数退避重试封装
 * 在首次失败后按指数退避策略重试，带抖动防止惊群效应
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  opts?: { maxRetries?: number; baseDelay?: number; maxDelay?: number; jitterRange?: number; totalTimeout?: number },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? urlManagerConfig.retry.maxRetries;
  const baseDelay = opts?.baseDelay ?? urlManagerConfig.retry.baseDelay;
  const maxDelay = opts?.maxDelay ?? urlManagerConfig.retry.maxDelay;
  const jitterRange = opts?.jitterRange ?? urlManagerConfig.retry.jitterRange;
  const totalTimeout = opts?.totalTimeout ?? urlManagerConfig.retry.totalTimeout;
  const startTime = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // 超过总耗时上限：放弃重试，直接抛出
      if (Date.now() - startTime >= totalTimeout) {
        console.warn(`[URL-MGR] ${context} 超过总超时(${totalTimeout}ms)，停止重试`);
        throw lastError;
      }
      if (attempt < maxRetries) {
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt))
          + Math.random() * jitterRange;
        console.warn(
          `[URL-MGR] ${context} 第${attempt + 1}次失败，${Math.round(delay)}ms 后重试:`,
          err instanceof Error ? err.message : err,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export class UrlManagerService {
  private monitor: UrlMonitorService;

  constructor() {
    this.monitor = new UrlMonitorService();
  }

  /**
   * 尝试获取分布式刷新锁（Redis SET NX PX）
   * @returns true 表示获取成功，false 表示已被其他实例持有
   */
  private async acquireRefreshLock(trackId: string): Promise<boolean> {
    return withRedis(async (redis) => {
      const key = `url:refreshing:${trackId}`;
      const result = await redis.set(key, '1', 'PX', 120000, 'NX');
      return result === 'OK';
    }, true);
  }

  /**
   * 释放分布式刷新锁
   */
  private async releaseRefreshLock(trackId: string): Promise<void> {
    await withRedis(async (redis) => {
      await redis.del(`url:refreshing:${trackId}`);
    }, undefined as unknown as void);
  }

  /**
   * 等待分布式刷新锁释放（轮询）
   */
  private async waitForRefreshLock(trackId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const locked = await withRedis(async (redis) => {
        return await redis.exists(`url:refreshing:${trackId}`);
      }, 0);
      if (!locked) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /**
   * 获取歌曲 URL（多级缓存）
   *
   * 优先级：
   *   1. Redis 缓存 (TTL 30min)
   *   2. 数据库 URL + 在线验证
   *   3. 触发刷新获取新 URL
   */
  async getUrl(trackId: string, triggeredBy: 'manual' | 'auto' | 'scheduler' = 'auto'): Promise<string | null> {
    // 1. Redis 缓存
    const cachedUrl = await this.getCachedUrl(trackId);
    if (cachedUrl) {
      // 缓存命中：记录访问
      await this.recordHot(trackId);
      return cachedUrl;
    }

    // 2. 查询数据库
    const song = await prisma.song.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        audioUrl: true,
        urlSource: true,
        urlExpiresAt: true,
        playable: true,
        urlCheckedAt: true,
        platform: true,
      },
    });

    if (!song) {
      console.warn(`[URL-MGR] 歌曲 ${trackId} 不存在`);
      return null;
    }

    if (song.audioUrl) {
      // 如果 DB 中已标记过期，跳过 HEAD 检查直接刷新（节省 5 秒）
      const isExpiredByDB = song.urlExpiresAt && song.urlExpiresAt.getTime() < Date.now();

      if (isExpiredByDB) {
        console.log(`[URL-MGR] ${trackId} URL 已过期(${song.urlExpiresAt?.toISOString()})，跳过 HEAD 检查直接刷新`);
        const newUrl = await this.refreshUrl(trackId, triggeredBy);
        return newUrl;
      }

      // 检查是否需要提前刷新（预计过期时间内）
      if (this.shouldRefreshSoon(song.urlExpiresAt, song.urlCheckedAt)) {
        // 提前刷新，但不阻塞当前请求
        this.refreshUrl(trackId, 'scheduler').catch((err) => {
          console.warn(`[URL-MGR] 预刷新失败 ${trackId}:`, err instanceof Error ? err.message : err);
        });
      }

      // 验证当前 URL 仍可用
      const isValid = await checkAudioUrlPlayable(song.audioUrl);
      if (isValid) {
        await this.cacheUrl(trackId, song.audioUrl, song.urlSource || 'db');
        await this.markValid(trackId);
        await this.recordHot(trackId);
        return song.audioUrl;
      }
    }

    // 3. URL 已失效，触发刷新
    const newUrl = await this.refreshUrl(trackId, triggeredBy);
    return newUrl;
  }

  /**
   * 刷新单首歌曲 URL（带并发防抖 + 指数退避重试）
   *
   * 防抖机制：同一首歌不会被并发刷新，后来的请求复用正在进行的刷新结果。
   * 重试机制：首次失败后按指数退避重试（默认 2 次，总执行 3 次）。
   *
   * 多源获取策略：
   *   1. 当前平台 (netease) - 主源
   *   2. 若主源失败，记录失败，标记不可播放
   */
  async refreshUrl(trackId: string, triggeredBy: 'manual' | 'auto' | 'scheduler' = 'manual'): Promise<string | null> {
    // 分布式防抖：如果同一首歌正在被任何实例刷新，等待其完成
    const locked = await this.acquireRefreshLock(trackId);
    if (!locked) {
      console.log(`[URL-MGR] ${trackId} 正在刷新中（其他实例），等待结果...`);
      await this.waitForRefreshLock(trackId, 30000);
      const song = await prisma.song.findUnique({ where: { id: trackId }, select: { audioUrl: true, playable: true } });
      return song?.audioUrl || null;
    }

    try {
      return await this.doRefreshWithRetry(trackId, triggeredBy);
    } finally {
      await this.releaseRefreshLock(trackId);
    }
  }

  /**
   * 实际执行刷新（含指数退避重试）
   */
  private async doRefreshWithRetry(trackId: string, triggeredBy: string): Promise<string | null> {
    const startTime = Date.now();
    const song = await prisma.song.findUnique({
      where: { id: trackId },
      select: { id: true, title: true, artist: true, audioUrl: true, platform: true, urlSource: true },
    });

    if (!song) {
      await this.logRefresh(trackId, null, null, 'unknown', false, '歌曲不存在', Date.now() - startTime, 0, triggeredBy);
      return null;
    }

    const oldUrl = song.audioUrl;
    const platform = (song.platform || 'netease').toLowerCase();
    console.log(`[URL-MGR] 开始刷新: ${song.title} (${trackId}), 平台: ${platform}, 触发: ${triggeredBy}`);

    // 带重试的 URL 获取
    let newUrl: string | null = null;
    let source = platform;
    let lastError: string | undefined;

    try {
      // 第一优先：Python 网易云爬虫（最稳定），失败本地捕获后继续降级
      if (platform === 'netease') {
        try {
          const r = await withRetry(
            async () => {
              const res = await this.refreshFromNetease(trackId);
              if (!res.success || !res.url) throw new Error(res.error || '爬虫未返回URL');
              return res.url;
            },
            `刷新 ${song.title}`,
          );
          newUrl = r;
          source = 'netease';
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.warn(`[URL-MGR] Python 网易云刷新失败，继续降级: ${song.title}`, lastError);
        }
      }

      // 第二降级：跨源搜索（按标题+歌手在网易云搜索，适用于 qq/酷狗歌曲或网易云 VIP）
      if (!newUrl && song.title) {
        const alt = await this.refreshByNeteaseSearch(song.title, song.artist);
        if (alt) {
          newUrl = alt.url;
          source = 'netease-search';
          lastError = undefined;
        }
      }

      // 第三降级：多源 TS API（netease → qq → kugou），失败本地捕获避免中断
      if (!newUrl) {
        try {
          const { songId } = parseTrackId(trackId);
          const result = await withRetry(
            async () => {
              const r = await fetchMusicUrlFromMultipleSources(songId, ['netease', 'qq', 'kugou']);
              if (!r) throw new Error('多源获取均未返回有效URL');
              return r;
            },
            `多源刷新 ${song.title}`,
          );
          newUrl = result.url;
          source = result.source;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.warn(`[URL-MGR] 多源刷新失败: ${song.title}`, lastError);
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    const responseTime = Date.now() - startTime;

    if (newUrl) {
      // 验证新 URL 可用性（手动刷新同样验证，确保返回的 URL 真正可播放，避免状态与实际可用性不一致）
      const isValid = await checkAudioUrlPlayable(newUrl);
      if (!isValid) {
        lastError = '新 URL 验证失败';
        await this.logRefresh(trackId, oldUrl, newUrl, source, false, lastError, responseTime, 0, triggeredBy);
        await this.markFailure(trackId, source, lastError);
        await this.monitor.recordRefreshFailure(trackId, source, lastError);
        return null;
      }

      // 获取文件大小（用于日志）
      const fileSize = await this.getUrlSize(newUrl);

      // 计算自适应过期时间
      const expiresAt = await this.predictExpiryAdaptive(source, trackId);

      // 更新数据库
      await prisma.song.update({
        where: { id: trackId },
        data: {
          audioUrl: newUrl,
          playable: true,
          urlSource: source,
          urlCheckedAt: new Date(),
          urlExpiresAt: expiresAt,
          urlRefreshCount: { increment: 1 },
          urlFailureCount: 0,
          urlLastFailure: null,
        },
      });

      // 更新 Redis 缓存
      await this.cacheUrl(trackId, newUrl, source);

      // 记录日志
      await this.logRefresh(trackId, oldUrl, newUrl, source, true, undefined, responseTime, fileSize, triggeredBy);

      // 记录统计
      await this.monitor.recordRefreshSuccess(trackId, source, responseTime);

      console.log(`[URL-MGR] 刷新成功: ${song.title} -> ${source} (${responseTime}ms, ${Math.round(fileSize / 1024)}KB)`);
      return newUrl;
    } else {
      // 刷新失败（已耗尽重试次数）
      await this.logRefresh(trackId, oldUrl, null, source, false, lastError || '未知错误', responseTime, 0, triggeredBy);
      await this.markFailure(trackId, source, lastError || '未知错误');
      await this.monitor.recordRefreshFailure(trackId, source, lastError || '未知错误');

      console.error(`[URL-MGR] 刷新失败: ${song.title} - ${lastError} (已重试${urlManagerConfig.retry.maxRetries}次)`);
      return null;
    }
  }

  /**
   * 批量检查并刷新 URL
   *
   * @param trackIds  歌曲ID列表，为空时自动选择需要检查的歌曲
   * @param batchSize 单批数量
   */
  async batchCheckAndRefresh(trackIds?: string[], batchSize = 50): Promise<BatchResult> {
    let songs: { id: string; title: string; audioUrl: string | null; playable: boolean; urlCheckedAt: Date | null; urlExpiresAt: Date | null }[];

    if (trackIds && trackIds.length > 0) {
      songs = await prisma.song.findMany({
        where: { id: { in: trackIds }, archived: false },
        select: { id: true, title: true, audioUrl: true, playable: true, urlCheckedAt: true, urlExpiresAt: true },
      });
    } else {
      // 自动选择需要检查的歌曲：
      //   1) playable=true 且 (24h未检查 OR 预计已过期 OR 从未检查)
      //   2) playable=false 且距离上次失败超过 failedSongRetryInterval 的（自动重试失效歌曲）
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const retryCutoff = new Date(Date.now() - urlManagerConfig.failedSongRetryInterval);

      songs = await prisma.song.findMany({
        where: {
          archived: false,
          OR: [
            // 需要检查的正常歌曲
            {
              playable: true,
              OR: [
                { urlCheckedAt: null },
                { urlCheckedAt: { lt: oneDayAgo } },
                { urlExpiresAt: { lt: new Date() } },
              ],
            },
            // 可以重试的失效歌曲
            {
              playable: false,
              OR: [
                { urlLastFailure: null },
                { urlLastFailure: { lt: retryCutoff } },
              ],
            },
          ],
        },
        orderBy: [
          { playable: 'desc' }, // 优先检查正常歌曲
          { hotScore: 'desc' },
        ],
        take: batchSize,
        select: { id: true, title: true, audioUrl: true, playable: true, urlCheckedAt: true, urlExpiresAt: true },
      });
    }

    console.log(`[URL-MGR] 批量检查开始: ${songs.length} 首`);

    const result: BatchResult = {
      total: songs.length,
      valid: 0,
      refreshed: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    // 引入本地缓存检查，跳过已有本地缓存的歌曲（无需检查URL有效性）
    const { isCached } = require('../audio-cache/audio-cache.service');

    // 分批并行处理（使用配置中的 chunkSize）
    const CHUNK = urlManagerConfig.chunkSize;
    for (let i = 0; i < songs.length; i += CHUNK) {
      const chunk = songs.slice(i, i + CHUNK);
      const chunkResults = await Promise.all(
        chunk.map(async (song) => {
          const detail: BatchDetail = {
            id: song.id,
            title: song.title,
            status: 'skipped',
          };

          // 已有本地缓存的歌曲直接标记为有效，跳过URL检查
          if (isCached(song.id)) {
            if (!song.playable) {
              await this.markValid(song.id);
            }
            detail.status = 'valid';
            detail.url = 'local-cache';
            result.valid++;
            result.skipped++;
            return detail;
          }

          if (!song.audioUrl) {
            // 无 URL，直接尝试刷新
            const newUrl = await this.refreshUrl(song.id, 'scheduler');
            if (newUrl) {
              detail.status = 'refreshed';
              detail.url = newUrl;
              result.refreshed++;
            } else {
              detail.status = 'failed';
              detail.error = '无 audioUrl 且刷新失败';
              result.failed++;
            }
            return detail;
          }

          // 检查当前 URL
          const isValid = await checkAudioUrlPlayable(song.audioUrl);
          if (isValid) {
            await this.markValid(song.id);
            detail.status = 'valid';
            detail.url = song.audioUrl;
            result.valid++;
            return detail;
          }

          // 失效，尝试刷新
          const newUrl = await this.refreshUrl(song.id, 'scheduler');
          if (newUrl) {
            detail.status = 'refreshed';
            detail.url = newUrl;
            result.refreshed++;
          } else {
            detail.status = 'failed';
            detail.error = '刷新失败';
            result.failed++;
          }
          return detail;
        }),
      );

      result.details.push(...chunkResults);

      // 批次间小延迟，避免请求过密
      if (i + CHUNK < songs.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    console.log(`[URL-MGR] 批量检查完成: 有效${result.valid}, 刷新${result.refreshed}, 失败${result.failed}`);
    return result;
  }

  /**
   * 预检测即将过期的 URL 并主动刷新
   * 找出在 preDetectionWindowMs 内即将过期的歌曲，提前刷新
   */
  async preDetectionRefresh(): Promise<{ scanned: number; refreshed: number }> {
    const windowEnd = new Date(Date.now() + urlManagerConfig.preDetectionWindowMs);
    const now = new Date();

    const songsToRefresh = await prisma.song.findMany({
      where: {
        archived: false,
        playable: true,
        urlExpiresAt: {
          gte: now,
          lte: windowEnd,
        },
      },
      orderBy: { urlExpiresAt: 'asc' },
      take: 20,
      select: { id: true, title: true, urlExpiresAt: true },
    });

    if (songsToRefresh.length === 0) {
      return { scanned: 0, refreshed: 0 };
    }

    console.log(`[URL-MGR] 预检测: ${songsToRefresh.length} 首歌曲即将过期，提前刷新`);

    let refreshed = 0;
    for (const song of songsToRefresh) {
      try {
        const newUrl = await this.refreshUrl(song.id, 'scheduler');
        if (newUrl) refreshed++;
      } catch (err) {
        console.warn(`[URL-MGR] 预检测刷新失败 ${song.title}:`, err instanceof Error ? err.message : err);
      }
    }

    return { scanned: songsToRefresh.length, refreshed };
  }

  /**
   * 通过网易云爬虫刷新 URL
   * 修复: 原使用 execFileAsync 直接调用，未设置 windowsHide 导致 Windows 弹窗
   * 现改用 runPython 统一执行器（内置 windowsHide + 并发限制）
   */
  private async refreshFromNetease(trackId: string): Promise<{ success: boolean; url: string | null; error?: string }> {
    try {
      const { stdout } = await runPython([execScriptPath, trackId], {
        timeout: urlManagerConfig.refreshTimeout,
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '../../../..'),
      });

      const result = JSON.parse(stdout.trim());
      if (result.success && result.url) {
        return { success: true, url: result.url };
      }
      return { success: false, url: null, error: result.error || '爬虫未返回URL' };
    } catch (err) {
      return {
        success: false,
        url: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 跨源降级：按标题+歌手在网易云搜索替代来源
   * 用于 qq/酷狗歌曲或网易云 VIP 歌曲无法通过原生 ID 获取 URL 时。
   */
  private async refreshByNeteaseSearch(title: string, artist: string | null): Promise<{ url: string; songId?: string } | null> {
    if (!title) return null;
    try {
      const { stdout } = await runPython([searchScriptPath, title, artist || ''], {
        timeout: urlManagerConfig.refreshTimeout,
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '../../../..'),
      });
      const result = JSON.parse(stdout.trim());
      if (result.success && result.url) {
        return { url: result.url, songId: result.songId };
      }
      return null;
    } catch (err) {
      console.warn(`[URL-MGR] 跨源搜索失败: ${title} - ${artist || ''}`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * 预测 URL 过期时间（静态回退值）
   * 网易云 URL 通常有效期为 30 分钟 - 2 小时，保守取 1 小时
   */
  private predictExpiry(source: string): Date {
    const ttlMap: Record<string, number> = {
      netease: 60 * 60 * 1000,      // 1小时
      qq: 2 * 60 * 60 * 1000,       // 2小时
      kugou: 2 * 60 * 60 * 1000,    // 2小时
    };
    const ttl = ttlMap[source] || 60 * 60 * 1000;
    return new Date(Date.now() + ttl);
  }

  /**
   * 自适应预测 URL 过期时间
   *
   * 基于历史刷新记录中的成功间隔，计算实际平均有效期。
   * 取历史有效期的保守系数（默认 70%），确保提前刷新。
   * 当历史数据不足时回退到静态 TTL。
   */
  private async predictExpiryAdaptive(source: string, trackId?: string): Promise<Date> {
    try {
      // 查询该数据源最近的成功刷新记录
      const recentLogs = await prisma.urlRefreshLog.findMany({
        where: {
          source,
          success: true,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: urlManagerConfig.adaptiveTtlSampleSize,
        select: { createdAt: true, songId: true },
      });

      if (recentLogs.length < 5) {
        // 历史数据不足，使用静态 TTL
        return this.predictExpiry(source);
      }

      // 计算同一首歌连续两次刷新的时间间隔
      const intervals: number[] = [];
      const bySong = new Map<string, Date[]>();
      for (const log of recentLogs) {
        const key = log.songId;
        if (!bySong.has(key)) bySong.set(key, []);
        bySong.get(key)!.push(log.createdAt);
      }
      for (const dates of bySong.values()) {
        dates.sort((a, b) => a.getTime() - b.getTime());
        for (let i = 1; i < dates.length; i++) {
          intervals.push(dates[i].getTime() - dates[i - 1].getTime());
        }
      }

      if (intervals.length < 3) {
        return this.predictExpiry(source);
      }

      // 取中位数（比均值更稳健，不受极端值影响）
      intervals.sort((a, b) => a - b);
      const median = intervals[Math.floor(intervals.length / 2)];

      // 保守系数：取历史有效期的 70%，确保提前刷新
      const adaptiveTtl = Math.max(
        10 * 60 * 1000, // 最少 10 分钟
        median * urlManagerConfig.adaptiveTtlFactor,
      );

      console.log(`[URL-MGR] 自适应TTL: ${source} 基于${intervals.length}个间隔样本, 中位数=${Math.round(median / 60000)}min, 保守TTL=${Math.round(adaptiveTtl / 60000)}min`);
      return new Date(Date.now() + adaptiveTtl);
    } catch (err) {
      // 任何异常回退到静态预测
      console.warn('[URL-MGR] 自适应TTL计算失败，回退到静态值:', err instanceof Error ? err.message : err);
      return this.predictExpiry(source);
    }
  }

  /**
   * 判断是否需要提前刷新
   * 当 URL 预计在配置窗口内过期，或最后检查时间超过 6 小时
   */
  private shouldRefreshSoon(urlExpiresAt: Date | null, urlCheckedAt: Date | null): boolean {
    const now = Date.now();
    const soonWindow = urlManagerConfig.preDetectionWindowMs;

    if (urlExpiresAt) {
      return urlExpiresAt.getTime() - now < soonWindow;
    }

    if (urlCheckedAt) {
      return now - urlCheckedAt.getTime() > 6 * 60 * 60 * 1000;
    }

    return false;
  }

  /**
   * Redis 缓存操作
   */
  private async getCachedUrl(trackId: string): Promise<string | null> {
    return withRedis(async (client) => {
      const data = await client.get(`url:cache:${trackId}`);
      if (!data) return null;
      try {
        const parsed = JSON.parse(data);
        if (parsed.expiresAt > Date.now()) {
          return parsed.url as string;
        }
        // 缓存已过期
        await client.del(`url:cache:${trackId}`);
        return null;
      } catch {
        return null;
      }
    }, null);
  }

  private async cacheUrl(trackId: string, url: string, source: string): Promise<void> {
    const data = {
      url,
      source,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + urlManagerConfig.cacheTtl,
    };
    await withRedis(async (client) => {
      await client.set(
        `url:cache:${trackId}`,
        JSON.stringify(data),
        'EX',
        Math.floor(urlManagerConfig.cacheTtl / 1000),
      );
    }, undefined);
  }

  /**
   * 记录热门曲目访问
   */
  private async recordHot(trackId: string): Promise<void> {
    await withRedis(async (client) => {
      const key = `url:hot:${trackId}`;
      const multi = client.multi();
      multi.hincrby('url:hot:today', trackId, 1);
      multi.expire('url:hot:today', 25 * 60 * 60); // 25小时过期
      await multi.exec();
    }, undefined);
  }

  /**
   * 标记 URL 有效
   */
  private async markValid(trackId: string): Promise<void> {
    await prisma.song.update({
      where: { id: trackId },
      data: {
        playable: true,
        urlCheckedAt: new Date(),
        urlFailureCount: 0,
        urlLastFailure: null,
      },
    });
  }

  /**
   * 标记 URL 失效 - 连续失败2次才标记不可播放，避免网络抖动误判
   * 本地已缓存的歌曲始终可播放（播放走本地文件），不因 URL 失效标记为不可播放
   */
  private async markFailure(trackId: string, source: string, error: string): Promise<void> {
    // 先查询当前失败次数
    const song = await prisma.song.findUnique({
      where: { id: trackId },
      select: { urlFailureCount: true },
    });
    const currentFailures = (song?.urlFailureCount || 0) + 1;
    let shouldMarkUnplayable = currentFailures >= 2; // 连续2次失败才标记

    // 本地已缓存则始终可播放，跳过不可播放标记
    if (shouldMarkUnplayable) {
      const { isCached } = require('../audio-cache/audio-cache.service');
      if (isCached(trackId)) {
        shouldMarkUnplayable = false;
      }
    }

    await prisma.song.update({
      where: { id: trackId },
      data: {
        ...(shouldMarkUnplayable ? { playable: false } : {}),
        urlCheckedAt: new Date(),
        urlFailureCount: { increment: 1 },
        urlLastFailure: new Date(),
      },
    });
  }

  /**
   * 记录刷新日志到数据库
   */
  private async logRefresh(
    trackId: string,
    oldUrl: string | null,
    newUrl: string | null,
    source: string,
    success: boolean,
    error: string | undefined,
    responseTime: number,
    fileSize: number,
    triggeredBy: string,
  ): Promise<void> {
    try {
      await prisma.urlRefreshLog.create({
        data: {
          songId: trackId,
          oldUrl: oldUrl || undefined,
          newUrl: newUrl || undefined,
          source,
          success,
          error: error || undefined,
          responseTime,
          fileSize,
          triggeredBy,
        },
      });
    } catch (err) {
      console.error('[URL-MGR] 记录日志失败:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * 获取 URL 文件大小
   */
  private async getUrlSize(url: string): Promise<number> {
    try {
      const isHttps = url.startsWith('https://');
      const lib = isHttps ? await import('https') : await import('http');
      return new Promise<number>((resolve) => {
        const req = lib.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
          const len = parseInt(res.headers['content-length'] || '0', 10);
          resolve(len || 0);
        });
        req.on('error', () => resolve(0));
        req.on('timeout', () => { req.destroy(); resolve(0); });
        req.end();
      });
    } catch {
      return 0;
    }
  }

  /**
   * 获取热门曲目列表
   */
  async getHotTracks(limit: number = 50): Promise<string[]> {
    return withRedis(async (client) => {
      const data = await client.hgetall('url:hot:today');
      return Object.entries(data)
        .map(([id, count]) => ({ id, count: parseInt(count, 10) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map((item) => item.id);
    }, []);
  }
}

export const urlManagerService = new UrlManagerService();
