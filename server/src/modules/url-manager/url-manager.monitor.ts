/**
 * URL 监控与预警系统
 *
 * 功能：
 *   1. 采集 URL 健康度指标 (有效率、刷新成功率、平均响应时间)
 *   2. 按数据源统计成功率
 *   3. 自动触发预警 (URL有效率过低、单曲连续失败、数据源异常)
 *   4. 预警记录持久化到数据库
 *
 * 2026-08-08 新增：闭环监控能力
 */

import prisma from '../../lib/prisma';
import { withRedis } from '../../lib/redis';
import { urlManagerConfig } from './url-manager.config';

export interface UrlMetrics {
  totalTracks: number;
  validUrls: number;
  expiredUrls: number;
  refreshingUrls: number;
  avgRefreshTime: number;
  sourceSuccessRate: Record<string, number>;
  refreshStats: {
    last24h: { success: number; failure: number };
    total: { success: number; failure: number };
  };
}

export interface Alert {
  id?: bigint;
  type: 'validity_rate' | 'refresh_failure' | 'source_failure';
  level: 'warning' | 'critical';
  message: string;
  data: any;
  timestamp: Date;
}

export class UrlMonitorService {
  /**
   * 获取监控指标
   */
  async getStats(): Promise<UrlMetrics> {
    const [totalTracks, validUrls, recentRefresh, refreshStats, sourceStats] = await Promise.all([
      prisma.song.count({ where: { archived: false } }),
      prisma.song.count({ where: { archived: false, playable: true } }),
      prisma.song.count({
        where: {
          archived: false,
          urlCheckedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.getRefreshStats(),
      this.getSourceStats(),
    ]);

    const expired = totalTracks - validUrls;
    const success24h = refreshStats.last24h.success;
    const failure24h = refreshStats.last24h.failure;
    const avgRefreshTime = await this.getAvgRefreshTime();

    return {
      totalTracks,
      validUrls,
      expiredUrls: expired,
      refreshingUrls: recentRefresh,
      avgRefreshTime,
      sourceSuccessRate: sourceStats,
      refreshStats,
    };
  }

  /**
   * 检查预警条件
   */
  async checkAlerts(): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const stats = await this.getStats();

    // 1. URL有效率检查
    if (stats.totalTracks > 0) {
      const validityRate = stats.validUrls / stats.totalTracks;
      if (validityRate < urlManagerConfig.alert.validityRateThreshold) {
        alerts.push({
          type: 'validity_rate',
          level: validityRate < 0.5 ? 'critical' : 'warning',
          message: `URL有效率过低: ${(validityRate * 100).toFixed(1)}% (有效${stats.validUrls}/${stats.totalTracks})`,
          data: { validityRate, validUrls: stats.validUrls, totalTracks: stats.totalTracks },
          timestamp: new Date(),
        });
      }
    }

    // 2. 数据源成功率检查
    for (const [source, rate] of Object.entries(stats.sourceSuccessRate)) {
      if (rate < urlManagerConfig.alert.sourceSuccessRateThreshold) {
        alerts.push({
          type: 'source_failure',
          level: rate < 0.3 ? 'critical' : 'warning',
          message: `数据源 ${source} 成功率过低: ${(rate * 100).toFixed(1)}%`,
          data: { source, successRate: rate },
          timestamp: new Date(),
        });
      }
    }

    // 3. 连续失败曲目检查
    const failureSongs = await prisma.song.findMany({
      where: {
        urlFailureCount: { gte: urlManagerConfig.alert.maxRefreshFailures },
        archived: false,
      },
      select: { id: true, title: true, urlFailureCount: true, urlLastFailure: true },
      take: 10,
    });

    if (failureSongs.length > 0) {
      alerts.push({
        type: 'refresh_failure',
        level: 'warning',
        message: `${failureSongs.length} 首歌曲连续刷新失败超过${urlManagerConfig.alert.maxRefreshFailures}次`,
        data: { songs: failureSongs.map((s) => ({ id: s.id, title: s.title, failures: s.urlFailureCount })) },
        timestamp: new Date(),
      });
    }

    // 持久化预警到数据库
    for (const alert of alerts) {
      await this.persistAlert(alert);
    }

    return alerts;
  }

  /**
   * 记录刷新成功
   */
  async recordRefreshSuccess(trackId: string, source: string, responseTime: number): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    await withRedis(async (client) => {
      const multi = client.multi();
      multi.hincrby(`url:stats:daily:${date}`, 'success', 1);
      multi.hincrby(`url:stats:daily:${date}`, 'total', 1);
      multi.hincrby(`url:stats:source:${source}`, 'success', 1);
      multi.hincrby(`url:stats:source:${source}`, 'total', 1);
      multi.lpush('url:stats:response_time', String(responseTime));
      multi.ltrim('url:stats:response_time', 0, 999); // 保留最近1000条
      multi.expire(`url:stats:daily:${date}`, 7 * 24 * 60 * 60); // 7天过期
      await multi.exec();
    }, undefined);

    // 清除失败计数（在 service.markValid 已处理）
  }

  /**
   * 记录刷新失败
   */
  async recordRefreshFailure(trackId: string, source: string, error: string): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    await withRedis(async (client) => {
      const multi = client.multi();
      multi.hincrby(`url:stats:daily:${date}`, 'failure', 1);
      multi.hincrby(`url:stats:daily:${date}`, 'total', 1);
      multi.hincrby(`url:stats:source:${source}`, 'failure', 1);
      multi.hincrby(`url:stats:source:${source}`, 'total', 1);
      multi.expire(`url:stats:daily:${date}`, 7 * 24 * 60 * 60);
      await multi.exec();
    }, undefined);

    console.warn(`[URL-MONITOR] 刷新失败: ${trackId} (${source}) - ${error}`);
  }

  /**
   * 获取最近预警列表
   */
  async getAlerts(limit: number = 50, includeResolved: boolean = false): Promise<any[]> {
    return prisma.urlAlert.findMany({
      where: includeResolved ? undefined : { resolved: false },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 解决预警
   */
  async resolveAlert(id: bigint): Promise<void> {
    await prisma.urlAlert.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }

  /**
   * 清理旧预警记录（30天前）
   */
  async cleanupOldAlerts(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.urlAlert.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo }, resolved: true },
    });
    return result.count;
  }

  /**
   * 获取刷新统计
   */
  private async getRefreshStats(): Promise<{ last24h: { success: number; failure: number }; total: { success: number; failure: number } }> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [last24hSuccess, last24hFailure, totalSuccess, totalFailure] = await Promise.all([
      prisma.urlRefreshLog.count({ where: { success: true, createdAt: { gte: oneDayAgo } } }),
      prisma.urlRefreshLog.count({ where: { success: false, createdAt: { gte: oneDayAgo } } }),
      prisma.urlRefreshLog.count({ where: { success: true } }),
      prisma.urlRefreshLog.count({ where: { success: false } }),
    ]);

    return {
      last24h: { success: last24hSuccess, failure: last24hFailure },
      total: { success: totalSuccess, failure: totalFailure },
    };
  }

  /**
   * 获取各数据源成功率
   */
  private async getSourceStats(): Promise<Record<string, number>> {
    const sources = ['netease', 'qq', 'kugou'];

    // 优先从 Redis 获取实时统计
    const redisStats = await withRedis(async (client) => {
      const result: Record<string, number> = {};
      for (const source of sources) {
        const data = await client.hgetall(`url:stats:source:${source}`);
        const success = parseInt(data.success || '0', 10);
        const failure = parseInt(data.failure || '0');
        const total = success + failure;
        result[source] = total > 0 ? success / total : 1; // 默认为1表示无数据时不触发预警
      }
      return result;
    }, null);

    if (redisStats) return redisStats;

    // Redis 不可用时从数据库统计
    const result: Record<string, number> = {};
    for (const source of sources) {
      const [success, total] = await Promise.all([
        prisma.urlRefreshLog.count({ where: { source, success: true } }),
        prisma.urlRefreshLog.count({ where: { source } }),
      ]);
      result[source] = total > 0 ? success / total : 1;
    }
    return result;
  }

  /**
   * 获取平均刷新响应时间
   */
  private async getAvgRefreshTime(): Promise<number> {
    // 优先从 Redis 获取
    const redisAvg = await withRedis(async (client) => {
      const times = await client.lrange('url:stats:response_time', 0, 99);
      if (times.length === 0) return null;
      const sum = times.reduce((acc, t) => acc + parseInt(t, 10), 0);
      return Math.round(sum / times.length);
    }, null);

    if (redisAvg !== null) return redisAvg;

    // 从数据库获取
    const result = await prisma.urlRefreshLog.aggregate({
      _avg: { responseTime: true },
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return Math.round(result._avg.responseTime || 0);
  }

  /**
   * 持久化预警到数据库
   */
  private async persistAlert(alert: Alert): Promise<void> {
    try {
      // 检查是否已存在相同类型的未解决预警（避免重复）
      const existing = await prisma.urlAlert.findFirst({
        where: {
          type: alert.type,
          resolved: false,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // 1小时内
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        // 已存在相同类型的未解决预警，跳过
        return;
      }

      await prisma.urlAlert.create({
        data: {
          type: alert.type,
          level: alert.level,
          message: alert.message,
          data: alert.data,
        },
      });

      console.warn(`[URL-MONITOR] 新预警: [${alert.level}] ${alert.message}`);
    } catch (err) {
      console.error('[URL-MONITOR] 持久化预警失败:', err instanceof Error ? err.message : err);
    }
  }
}

export const urlMonitorService = new UrlMonitorService();
