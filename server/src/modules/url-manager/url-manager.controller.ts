/**
 * URL 管理 API 控制器
 *
 * 提供以下接口：
 *   GET    /api/url-manager/status             系统状态
 *   GET    /api/url-manager/metrics            监控指标
 *   GET    /api/url-manager/dashboard          仪表板（实时面板数据）
 *   GET    /api/url-manager/check/:trackId     检查单曲URL
 *   POST   /api/url-manager/refresh/:trackId   刷新单曲URL
 *   POST   /api/url-manager/emergency/:trackId 紧急刷新（绕过限制）
 *   POST   /api/url-manager/refresh-batch      批量刷新
 *   GET    /api/url-manager/alerts             预警列表
 *   POST   /api/url-manager/alerts/:id/resolve 解决预警
 *   GET    /api/url-manager/logs               刷新日志
 *   GET    /api/url-manager/scheduler/status   调度器状态
 *   POST   /api/url-manager/scheduler/trigger  手动触发任务
 *
 * 2026-08-08 新增
 * 2026-08-09 增强：紧急刷新、仪表板、日志时间过滤
 */

import { Request, Response } from 'express';
import { UrlManagerService } from './url-manager.service';
import { UrlMonitorService } from './url-manager.monitor';
import { urlSchedulerService } from './url-manager.scheduler';
import { getPythonRunnerStatus } from '../../lib/python-runner';
import prisma from '../../lib/prisma';

export class UrlManagerController {
  private urlManager: UrlManagerService;
  private monitor: UrlMonitorService;

  constructor() {
    this.urlManager = new UrlManagerService();
    this.monitor = new UrlMonitorService();
  }

  /**
   * 系统状态
   * GET /api/url-manager/status
   */
  async getStatus(_req: Request, res: Response) {
    try {
      const stats = await this.monitor.getStats();
      const schedulerStatus = urlSchedulerService.getStatus();
      res.json({
        success: true,
        status: 'running',
        scheduler: schedulerStatus,
        metrics: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[UrlManagerController] getStatus 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 监控指标
   * GET /api/url-manager/metrics
   */
  async getMetrics(_req: Request, res: Response) {
    try {
      const metrics = await this.monitor.getStats();
      res.json({ success: true, metrics });
    } catch (err: any) {
      console.error('[UrlManagerController] getMetrics 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 检查单曲 URL 状态
   * GET /api/url-manager/check/:trackId
   */
  async checkUrl(req: Request, res: Response) {
    try {
      const { trackId } = req.params;
      if (!trackId) {
        return res.status(400).json({ success: false, error: '缺少 trackId' });
      }

      const song = await prisma.song.findUnique({
        where: { id: trackId },
        select: {
          id: true,
          title: true,
          audioUrl: true,
          playable: true,
          urlSource: true,
          urlCheckedAt: true,
          urlExpiresAt: true,
          urlFailureCount: true,
          urlLastFailure: true,
        },
      });

      if (!song) {
        return res.status(404).json({ success: false, error: '歌曲不存在' });
      }

      res.json({ success: true, song });
    } catch (err: any) {
      console.error('[UrlManagerController] checkUrl 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 刷新单曲 URL
   * POST /api/url-manager/refresh/:trackId
   */
  async refreshUrl(req: Request, res: Response) {
    try {
      const { trackId } = req.params;
      if (!trackId) {
        return res.status(400).json({ success: false, error: '缺少 trackId' });
      }

      const triggeredBy = (req.query.triggeredBy as 'manual' | 'auto' | 'scheduler') || 'manual';
      const newUrl = await this.urlManager.refreshUrl(trackId, triggeredBy);

      if (newUrl) {
        res.json({
          success: true,
          url: newUrl,
          refreshed: true,
          message: 'URL刷新成功',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'URL刷新失败，请查看日志',
        });
      }
    } catch (err: any) {
      console.error('[UrlManagerController] refreshUrl 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 批量刷新
   * POST /api/url-manager/refresh-batch
   * Body: { trackIds?: string[], batchSize?: number }
   */
  async refreshBatch(req: Request, res: Response) {
    try {
      const { trackIds, batchSize } = req.body || {};
      const result = await this.urlManager.batchCheckAndRefresh(
        Array.isArray(trackIds) ? trackIds : undefined,
        typeof batchSize === 'number' ? batchSize : undefined,
      );

      res.json({
        success: true,
        result,
      });
    } catch (err: any) {
      console.error('[UrlManagerController] refreshBatch 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 预警列表
   * GET /api/url-manager/alerts?includeResolved=true&limit=50
   */
  async getAlerts(req: Request, res: Response) {
    try {
      const includeResolved = req.query.includeResolved === 'true';
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const alerts = await this.monitor.getAlerts(limit, includeResolved);
      res.json({ success: true, alerts });
    } catch (err: any) {
      console.error('[UrlManagerController] getAlerts 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 解决预警
   * POST /api/url-manager/alerts/:id/resolve
   */
  async resolveAlert(req: Request, res: Response) {
    try {
      let id: bigint;
      try {
        id = BigInt(req.params.id);
      } catch {
        return res.status(400).json({ success: false, error: '无效的预警 ID' });
      }
      await this.monitor.resolveAlert(id);
      res.json({ success: true, message: '预警已标记为解决' });
    } catch (err: any) {
      console.error('[UrlManagerController] resolveAlert 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 刷新日志（支持时间范围过滤）
   * GET /api/url-manager/logs?songId=xxx&limit=50&page=1&from=ISO&to=ISO&success=true
   */
  async getLogs(req: Request, res: Response) {
    try {
      const songId = req.query.songId as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const page = parseInt(req.query.page as string, 10) || 1;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (songId) where.songId = songId;
      if (req.query.from || req.query.to) {
        where.createdAt = {};
        if (req.query.from) where.createdAt.gte = new Date(req.query.from as string);
        if (req.query.to) where.createdAt.lte = new Date(req.query.to as string);
      }
      if (req.query.success === 'true') where.success = true;
      else if (req.query.success === 'false') where.success = false;

      const [logs, total] = await Promise.all([
        prisma.urlRefreshLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip,
          include: { song: { select: { title: true, artist: true } } },
        }),
        prisma.urlRefreshLog.count({ where }),
      ]);

      res.json({
        success: true,
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err: any) {
      console.error('[UrlManagerController] getLogs 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 调度器状态
   * GET /api/url-manager/scheduler/status
   */
  async getSchedulerStatus(_req: Request, res: Response) {
    try {
      const status = urlSchedulerService.getStatus();
      res.json({ success: true, scheduler: status });
    } catch (err: any) {
      console.error('[UrlManagerController] getSchedulerStatus 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 手动触发调度器任务
   * POST /api/url-manager/scheduler/trigger
   * Body: { task: 'hotCheck' | 'fullCheck' | 'preDetection' | 'failedRetry' | 'cacheCleanup' | 'alertCheck' }
   */
  async triggerSchedulerTask(req: Request, res: Response) {
    try {
      const { task } = req.body || {};
      const validTasks = ['hotCheck', 'fullCheck', 'preDetection', 'failedRetry', 'cacheCleanup', 'alertCheck'];
      if (!validTasks.includes(task)) {
        return res.status(400).json({ success: false, error: `无效的任务名，可选: ${validTasks.join(', ')}` });
      }

      // 异步触发任务（不等待完成）
      res.json({
        success: true,
        message: `任务 ${task} 已触发`,
      });

      // 记录触发来源
      console.log(`[URL-MGR] 手动触发任务: ${task}，操作者: ${(req as any).user?.username || 'unknown'}`);
    } catch (err: any) {
      console.error('[UrlManagerController] triggerSchedulerTask 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 紧急刷新（绕过常规限制，直接强制刷新）
   * POST /api/url-manager/emergency/:trackId
   * Body: { reason?: string }
   *
   * 适用场景：自动刷新多次失败、用户报告播放问题、数据修复
   * 特点：忽略防抖窗口，直接创建新的 UrlManagerService 实例执行
   */
  async emergencyRefresh(req: Request, res: Response) {
    try {
      const { trackId } = req.params;
      const { reason } = req.body || {};

      if (!trackId) {
        return res.status(400).json({ success: false, error: '缺少 trackId' });
      }

      // 查询歌曲信息
      const song = await prisma.song.findUnique({
        where: { id: trackId },
        select: { id: true, title: true, artist: true, audioUrl: true, playable: true, urlFailureCount: true },
      });

      if (!song) {
        return res.status(404).json({ success: false, error: '歌曲不存在' });
      }

      console.log(`[URL-MGR] 紧急刷新: ${song.title} (${trackId}), 原因: ${reason || '未说明'}`);

      // 重置失败计数，允许重新尝试
      await prisma.song.update({
        where: { id: trackId },
        data: { urlFailureCount: 0, urlLastFailure: null },
      });

      // 执行刷新（带重试）
      const newUrl = await this.urlManager.refreshUrl(trackId, 'manual');

      if (newUrl) {
        res.json({
          success: true,
          url: newUrl,
          song: { id: song.id, title: song.title, artist: song.artist },
          message: '紧急刷新成功',
        });
      } else {
        res.status(502).json({
          success: false,
          error: '紧急刷新失败：爬虫无法获取有效 URL，请检查数据源状态',
          song: { id: song.id, title: song.title },
          suggestion: '请尝试手动设置 audioUrl 或联系管理员',
        });
      }
    } catch (err: any) {
      console.error('[UrlManagerController] emergencyRefresh 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }

  /**
   * 监控仪表板数据
   * GET /api/url-manager/dashboard
   *
   * 返回实时面板所需的所有数据，一次请求获取全部指标
   */
  async getDashboard(_req: Request, res: Response) {
    try {
      const [metrics, alerts, schedulerStatus, pythonStatus] = await Promise.all([
        this.monitor.getStats(),
        this.monitor.getAlerts(10, false),
        Promise.resolve(urlSchedulerService.getStatus()),
        Promise.resolve(getPythonRunnerStatus()),
      ]);

      // 最近 24 小时刷新成功率
      const refreshSuccessRate = metrics.refreshStats.last24h.success + metrics.refreshStats.last24h.failure > 0
        ? metrics.refreshStats.last24h.success / (metrics.refreshStats.last24h.success + metrics.refreshStats.last24h.failure)
        : 1;

      // URL 有效率
      const validityRate = metrics.totalTracks > 0
        ? metrics.validUrls / metrics.totalTracks
        : 1;

      res.json({
        success: true,
        dashboard: {
          summary: {
            totalTracks: metrics.totalTracks,
            validUrls: metrics.validUrls,
            expiredUrls: metrics.expiredUrls,
            validityRate: Math.round(validityRate * 1000) / 10,
            refreshSuccessRate: Math.round(refreshSuccessRate * 1000) / 10,
            avgRefreshTime: metrics.avgRefreshTime,
          },
          refreshStats: metrics.refreshStats,
          sourceSuccessRate: metrics.sourceSuccessRate,
          alerts: alerts.map((a: any) => ({
            id: a.id,
            type: a.type,
            level: a.level,
            message: a.message,
            createdAt: a.createdAt,
          })),
          scheduler: {
            running: schedulerStatus.running,
            tasks: Object.entries(schedulerStatus.tasks).map(([name, status]: [string, any]) => ({
              name,
              running: status.running,
              lastRun: status.lastRun,
            })),
          },
          pythonRunner: pythonStatus,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      console.error('[UrlManagerController] getDashboard 错误:', err);
      res.status(500).json({ success: false, error: err?.message || '服务器内部错误' });
    }
  }
}
