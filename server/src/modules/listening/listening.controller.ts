import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export class ListeningController {
  async ingest(req: Request, res: Response) {
    const { events } = req.body as { events: any[] };
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: 'events 必填' });
    }
    const userId = (req as any).user?.id ?? null;

    // 第一遍：构造事件数据，暂时用请求中提供的特征值（可能全为 0）
    const data = events.map((e) => ({
      userId,
      songId: e.songId ?? null,
      trackPath: e.trackPath ?? null,
      trackTitle: e.trackTitle ?? null,
      trackArtist: e.trackArtist ?? null,
      eventType: e.eventType,
      positionMs: e.positionMs ?? null,
      durationMs: e.durationMs ?? null,
      featSubBass: e.featSubBass ?? 0,
      featBass: e.featBass ?? 0,
      featLowMid: e.featLowMid ?? 0,
      featMid: e.featMid ?? 0,
      featHighMid: e.featHighMid ?? 0,
      featPresence: e.featPresence ?? 0,
      featBrilliance: e.featBrilliance ?? 0,
      featAir: e.featAir ?? 0,
      featBeat: e.featBeat ?? 0,
      featBeatStrength: e.featBeatStrength ?? 0,
      engagementScore: e.engagementScore ?? 0,
      occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
    }));

    // 修复 (2026-08-09): 自动从 SongFeature 表填充音频特征
    // 原代码仅使用前端传入的 feat* 字段，但前端 Track 类型不包含特征数据，
    // 导致所有事件的 feat* 均为 0，情绪 DNA 计算结果无意义。
    // 现在对于有 songId 但特征为全零的事件，批量查询 SongFeature 并回填。
    const songIdsNeedingFeatures = new Set<string>();
    for (const d of data) {
      if (!d.songId) continue;
      // 检查是否所有特征均为 0（说明前端未提供）
      const allZero = d.featSubBass === 0 && d.featBass === 0 && d.featLowMid === 0 &&
        d.featMid === 0 && d.featHighMid === 0 && d.featPresence === 0 &&
        d.featBrilliance === 0 && d.featAir === 0;
      if (allZero) {
        songIdsNeedingFeatures.add(d.songId);
      }
    }

    if (songIdsNeedingFeatures.size > 0) {
      try {
        const features = await prisma.songFeature.findMany({
          where: { songId: { in: Array.from(songIdsNeedingFeatures) } },
        });
        // 构建 songId → 特征 映射
        const featMap = new Map(features.map((f) => [f.songId, f]));
        // 回填特征到事件数据
        for (const d of data) {
          if (!d.songId) continue;
          const f = featMap.get(d.songId);
          if (!f) continue;
          // 仅在前端未提供特征时回填（即全零时）
          d.featSubBass = f.subBass;
          d.featBass = f.bass;
          d.featLowMid = f.lowMid;
          d.featMid = f.mid;
          d.featHighMid = f.highMid;
          d.featPresence = f.presence;
          d.featBrilliance = f.brilliance;
          d.featAir = f.air;
          d.featBeat = f.bpm;
        }
      } catch (err) {
        // 特征查询失败不阻塞事件写入，记日志后继续
        console.warn('[LISTENING] SongFeature 查询失败，特征将保持为 0:', err instanceof Error ? err.message : err);
      }
    }

    const result = await prisma.listeningEvent.createMany({ data });
    return res.status(201).json({ success: true, data: { accepted: result.count } });
  }

  async recent(req: Request, res: Response) {
    const userId = (req as any).user?.id;
    const limit = Number(req.query.limit ?? 50);
    const events = await prisma.listeningEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return res.json({ success: true, data: events });
  }
}
