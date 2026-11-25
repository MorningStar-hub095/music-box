import prisma from '../../lib/prisma';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export class CapsuleService {
  async seal(userId: number, body: {
    trackPath: string; songId?: string | null;
    freqSnapshot: number[]; lrcLine?: string;
    resonance: number; engagementScore: number; posMs: number;
  }) {
    const existing = await prisma.capsule.findFirst({
      where: { userId, trackPath: body.trackPath, lockedUntil: { gt: new Date() } },
      select: { id: true },
    });
    if (existing) return { skipped: true };
    const now = new Date();
    const note = this.generateNote(body.lrcLine || '', now);
    const cap = await prisma.capsule.create({
      data: {
        userId,
        trackPath: body.trackPath,
        songId: body.songId ?? null,
        snapshotJson: {
          freq: body.freqSnapshot,
          lrcLine: body.lrcLine || '',
          note,
          resonance: body.resonance,
          engagementScore: body.engagementScore,
          posMs: body.posMs,
        },
        lockedUntil: new Date(now.getTime() + NINETY_DAYS_MS),
      },
    });
    return { id: cap.id, lockedUntil: cap.lockedUntil, createdAt: cap.createdAt, note, skipped: false };
  }

  async getDue(userId: number) {
    const due = await prisma.capsule.findMany({
      where: { userId, lockedUntil: { lte: new Date() }, revealedAt: null },
      orderBy: { lockedUntil: 'asc' },
    });
    if (due.length === 0) return [];
    await prisma.capsule.updateMany({
      where: { id: { in: due.map(c => c.id) } },
      data: { revealedAt: new Date() },
    });
    return due.map(c => ({
      id: c.id, trackPath: c.trackPath, songId: c.songId,
      snapshot: c.snapshotJson as any, lockedUntil: c.lockedUntil, createdAt: c.createdAt,
    }));
  }

  private generateNote(lrcLine: string, date: Date): string {
    const dateStr = `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`;
    if (lrcLine) return `封存于 ${dateStr}，当时正听「${lrcLine}」，这刻的共鸣被留住了。`;
    return `封存于 ${dateStr}的心情快照，90 天后重逢。`;
  }
}
