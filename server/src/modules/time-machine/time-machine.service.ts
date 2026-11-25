import prisma from '../../lib/prisma';

export class TimeMachineService {
  async query(userId: number, at: Date) {
    const events = await prisma.listeningEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, occurredAt: true, eventType: true, engagementScore: true, heightsSeries: true,
        featSubBass:true,featBass:true,featLowMid:true,featMid:true,featHighMid:true,featPresence:true,featBrilliance:true,featAir:true },
    });
    if (events.length === 0) return { nearest: null, context: [] };
    let nearest = events[0]; let best = Math.abs(events[0].occurredAt.getTime() - at.getTime());
    for (const e of events) {
      const d = Math.abs(e.occurredAt.getTime() - at.getTime());
      if (d < best) { best = d; nearest = e; }
    }
    const idx = events.indexOf(nearest);
    const start = Math.max(0, idx - 2);
    const context = events.slice(start, start + 5).filter(e => e.id !== nearest.id).slice(0, 4);
    return { nearest: this.shape(nearest), context: context.map(e => this.shape(e)) };
  }
  private shape(e: any) {
    return {
      id: e.id, datetime: e.occurredAt, eventType: e.eventType, engagementScore: e.engagementScore,
      heights: e.heightsSeries || { frames: [] },
      bands: { subBass:e.featSubBass,bass:e.featBass,lowMid:e.featLowMid,mid:e.featMid,highMid:e.featHighMid,presence:e.featPresence,brilliance:e.featBrilliance,air:e.featAir },
    };
  }
}
