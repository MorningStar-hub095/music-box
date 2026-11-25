import prisma from '../../lib/prisma';

export type DnaVector = {
  subBass: number; bass: number; lowMid: number; mid: number;
  highMid: number; presence: number; brilliance: number; air: number;
};

const KEYS: (keyof DnaVector)[] = [
  'subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air',
];

const EVENT_LOOKBACK_DAYS = 180; // 6 个月时间窗
const EVENT_LIMIT = 5000; // 单用户最多 5000 条事件，避免全表内存聚合

// 修复 (2026-08-09): 新增最低事件阈值
// 原代码 events.length === 0 时返回全零向量并持久化，导致用户看到塌缩的雷达图
// 现增加 MIN_EVENTS_THRESHOLD，不足时不持久化，并在响应中标记 insufficient
const MIN_EVENTS_THRESHOLD = 5;

export interface EmotionDnaResult {
  vector: DnaVector;
  eventCount: number;
  updatedAt: string | null;
  insufficient?: boolean; // 修复: 标记数据不足，前端据此展示空状态
}

export class EmotionDnaService {
  /** 从近 6 个月的聆听事件计算 DNA：行为加权均值，skip 取负权 */
  async computeForUser(userId: number): Promise<{ vector: DnaVector; eventCount: number; insufficient: boolean }> {
    const since = new Date(Date.now() - EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const events = await prisma.listeningEvent.findMany({
      where: {
        userId,
        eventType: { in: ['complete', 'play', 'skip', 'favorite'] },
        occurredAt: { gt: since },
      },
      orderBy: { occurredAt: 'desc' },
      take: EVENT_LIMIT,
      select: {
        eventType: true, engagementScore: true,
        featSubBass: true, featBass: true, featLowMid: true, featMid: true,
        featHighMid: true, featPresence: true, featBrilliance: true, featAir: true,
      },
    });

    const acc: DnaVector = { subBass:0,bass:0,lowMid:0,mid:0,highMid:0,presence:0,brilliance:0,air:0 };

    // 修复: 事件数不足阈值时返回 insufficient 标记，不进行计算
    if (events.length < MIN_EVENTS_THRESHOLD) {
      return { vector: acc, eventCount: events.length, insufficient: true };
    }

    let totalW = 0;
    for (const e of events) {
      const baseW = e.engagementScore || 0.3;
      const sign = e.eventType === 'skip' ? -1 : 1;
      const w = sign * baseW;
      totalW += Math.abs(w);
      acc.subBass += e.featSubBass * w;
      acc.bass += e.featBass * w;
      acc.lowMid += e.featLowMid * w;
      acc.mid += e.featMid * w;
      acc.highMid += e.featHighMid * w;
      acc.presence += e.featPresence * w;
      acc.brilliance += e.featBrilliance * w;
      acc.air += e.featAir * w;
    }
    if (totalW > 0) {
      for (const k of KEYS) acc[k] = acc[k] / totalW;
    }
    for (const k of KEYS) acc[k] = Math.max(0, Math.min(1, acc[k]));
    return { vector: acc, eventCount: events.length, insufficient: false };
  }

  /**
   * 计算并持久化到 user.emotionDna
   * 修复: 事件不足阈值时不持久化全零向量，避免误导用户
   */
  async recomputeAndPersist(userId: number): Promise<{ vector: DnaVector; eventCount: number; insufficient: boolean }> {
    const { vector, eventCount, insufficient } = await this.computeForUser(userId);

    // 修复: insufficient 时不更新 emotionDna，保留之前的有效数据（若有）
    // 仅当数据充足时才持久化
    if (!insufficient) {
      await prisma.user.update({
        where: { id: userId },
        data: { emotionDna: { vector, eventCount, updatedAt: new Date().toISOString() } as any },
      });
    }

    return { vector, eventCount, insufficient };
  }

  /**
   * 读取已持久化的 DNA（若无则现场计算，不持久化）
   * 修复: 返回 insufficient 标记供前端判断
   */
  async getForUser(userId: number): Promise<EmotionDnaResult> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { emotionDna: true } });
    if (user?.emotionDna) {
      const persisted = user.emotionDna as any;
      // 修复: 检查已持久化的数据是否为全零向量（旧数据可能是在无阈值时写入的）
      const isAllZero = KEYS.every((k) => (persisted.vector?.[k] ?? 0) === 0);
      if (isAllZero) {
        // 旧的全零数据，重新计算以获取最新的 insufficient 状态
        const { vector, eventCount, insufficient } = await this.computeForUser(userId);
        return { vector, eventCount, updatedAt: persisted.updatedAt || null, insufficient };
      }
      return { ...persisted, insufficient: false };
    }
    const { vector, eventCount, insufficient } = await this.computeForUser(userId);
    return { vector, eventCount, updatedAt: null, insufficient };
  }
}
