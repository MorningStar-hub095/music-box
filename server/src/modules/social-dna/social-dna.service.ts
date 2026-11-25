import prisma from '../../lib/prisma';
import { cache } from '../../lib/redis';
import { EmotionDnaService, DnaVector } from '../emotion-dna/emotion-dna.service';

const emotionSvc = new EmotionDnaService();

const EMO_KEYS: (keyof DnaVector)[] = [
  'subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air',
];

const SOCIAL_VECTORS_CACHE_KEY = 'social:dna:vectors';
const SOCIAL_VECTORS_CACHE_TTL = 300; // 5 分钟

// 修复 (2026-08-09): 新增最低事件阈值
// 原代码无阈值，0 条事件也会生成全零向量并持久化，导致匹配结果无意义
const MIN_EVENTS_THRESHOLD = 5;

function avg(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

type SocialVectorRow = { userId: number; vector: number[] };

export interface SocialDnaResult {
  vector: number[];
  cipherSvg: string;
  eventCount: number;
  insufficient: boolean; // 修复: 标记数据不足
  updatedAt: string | null;
}

export class SocialDnaService {
  /**
   * 计算 12 维向量：emotionDNA(8) + genomeCentroid(4)
   * 修复: 增加事件阈值判断，不足时不持久化
   */
  async computeAndStore(userId: number): Promise<SocialDnaResult> {
    const emo = await emotionSvc.computeForUser(userId);
    const v8 = EMO_KEYS.map((k) => emo.vector[k] ?? 0);

    // ListeningEvent 无 song 关系，先取 songIds 再查特征
    const events = await prisma.listeningEvent.findMany({
      where: { userId },
      select: { songId: true },
    });
    const songIds = Array.from(new Set(events.map((e) => e.songId).filter(Boolean))) as string[];
    const feats = songIds.length
      ? await prisma.songFeature.findMany({ where: { songId: { in: songIds } } })
      : [];
    const g = feats.length
      ? {
          x: avg(feats.map((f) => f.genomeX ?? 0)),
          y: avg(feats.map((f) => f.genomeY ?? 0)),
          bpm: avg(feats.map((f) => f.bpm ?? 0)) / 200,
          energy: avg(feats.map((f) => f.energy ?? 0)),
        }
      : { x: 0, y: 0, bpm: 0, energy: 0 };

    const vector = [...v8, g.x, g.y, g.bpm, g.energy];
    const cipherSvg = this.generateSvg(vector);

    // 修复: 事件不足阈值时不持久化全零向量，避免匹配结果无意义
    const insufficient = emo.insufficient || events.length < MIN_EVENTS_THRESHOLD;

    if (!insufficient) {
      await prisma.socialDna.upsert({
        where: { userId },
        create: { userId, vectorJson: { vector }, cipherSvg },
        update: { vectorJson: { vector }, cipherSvg },
      });
      // 失效全站向量缓存（向量已变更）
      await cache.del(SOCIAL_VECTORS_CACHE_KEY);
    } else {
      console.log(`[SOCIAL-DNA] 用户 ${userId} 聆听事件不足 (${events.length}/${MIN_EVENTS_THRESHOLD})，跳过持久化`);
    }

    return {
      vector,
      cipherSvg,
      eventCount: events.length,
      insufficient,
      updatedAt: insufficient ? null : new Date().toISOString(),
    };
  }

  /**
   * 读取已持久化的社交 DNA
   * 修复: 若已有记录但事件不足，返回 insufficient 标记
   * 修复: 若无记录，不再无条件现场计算（原 getMe 会立即 computeAndStore）
   */
  async getMe(userId: number): Promise<SocialDnaResult> {
    const sd = await prisma.socialDna.findUnique({ where: { userId } });

    if (sd) {
      const v = sd.vectorJson as any;
      const vector = v.vector || v;

      // 修复: 检查是否为全零向量（旧数据可能是在无阈值时写入的）
      const isAllZero = vector.every((x: number) => x === 0);
      if (isAllZero) {
        // 旧的无效数据，重新计算
        return await this.computeAndStore(userId);
      }

      // 有效数据，但需检查当前事件数是否仍充足
      const eventCount = await prisma.listeningEvent.count({ where: { userId } });
      return {
        vector,
        cipherSvg: sd.cipherSvg,
        eventCount,
        insufficient: false,
        updatedAt: sd.updatedAt.toISOString(),
      };
    }

    // 无记录，首次计算
    return await this.computeAndStore(userId);
  }

  /**
   * 余弦补集匹配：1 - cosine，返回 Top-N 互补用户（不含自己，不泄露曲目）
   * 修复: 若自己向量为全零，不参与匹配（避免所有用户都判为最大互补）
   */
  async match(userId: number, limit: number): Promise<{ userId: number; complement: number }[]> {
    const me = await prisma.socialDna.findUnique({ where: { userId } });
    if (!me) return [];
    const myV = ((me.vectorJson as any).vector) as number[];

    // 修复: 全零向量不参与匹配
    const myIsZero = myV.every((x) => x === 0);
    if (myIsZero) return [];

    // 全站向量列表优先读 Redis 缓存
    const cached = await cache.get<SocialVectorRow[]>(SOCIAL_VECTORS_CACHE_KEY);
    let rows: SocialVectorRow[];
    if (!cached) {
      // 缓存未命中：查全表
      const all = await prisma.socialDna.findMany();
      rows = all
        .map((o) => ({
          userId: o.userId,
          vector: ((o.vectorJson as any).vector) as number[],
        }))
        // 修复: 过滤掉全零向量用户（无有效数据）
        .filter((r) => !r.vector.every((x) => x === 0));
      await cache.set(SOCIAL_VECTORS_CACHE_KEY, rows, SOCIAL_VECTORS_CACHE_TTL);
    } else {
      rows = cached;
    }
    // 过滤掉自己
    rows = rows.filter((r) => r.userId !== userId);

    return rows
      .map((o) => ({ userId: o.userId, complement: 1 - cosine(myV, o.vector) }))
      .sort((a, b) => b.complement - a.complement)
      .slice(0, limit);
  }

  /** 12 辐 SVG 暗号：每维归一化到 [0,1] 作为半径 */
  private generateSvg(v: number[]): string {
    const cx = 100, cy = 100, R = 80;
    let pts = '';
    for (let i = 0; i < 12; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 12;
      const r = R * clamp01((v[i] + 1) / 2);
      pts += `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)} `;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><polygon points="${pts.trim()}" fill="rgba(23,195,178,0.3)" stroke="#17C3B2" stroke-width="2"/></svg>`;
  }
}
