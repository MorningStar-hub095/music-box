import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 6, username: 'tm_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._r: string[]) => (_q: any, _s: any, next: any) => next(),
}));

const db = new PrismaClient();
const UID = 6;
const T0 = new Date('2025-07-21T10:00:00Z');

beforeAll(async () => {
  await db.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, username: 'tm_test', email: 'tm@e.com', passwordHash: 'x' } });
  await db.listeningEvent.deleteMany({ where: { userId: UID } });
  await db.listeningEvent.createMany({
    data: [
      { userId: UID, eventType: 'complete', engagementScore: 0.8, occurredAt: T0,
        featSubBass:0.5,featBass:0.5,featLowMid:0.5,featMid:0.5,featHighMid:0.5,featPresence:0.5,featBrilliance:0.5,featAir:0.5,
        heightsSeries: { frames: [[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8],[0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9]] } as any },
      { userId: UID, eventType: 'complete', engagementScore: 0.8, occurredAt: new Date(T0.getTime()+3600000),
        featSubBass:0.6,featBass:0.6,featLowMid:0.6,featMid:0.6,featHighMid:0.6,featPresence:0.6,featBrilliance:0.6,featAir:0.6,
        heightsSeries: { frames: [[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.6]] } as any },
    ],
  });
});
afterAll(async () => { await db.listeningEvent.deleteMany({ where: { userId: UID } }); await db.user.deleteMany({ where: { id: UID } }).catch(()=>{}); await db.$disconnect(); });

describe('GET /api/time-machine', () => {
  it('returns nearest event + context by datetime', async () => {
    const at = new Date('2025-07-21T10:30:00Z').toISOString();
    const res = await request(app).get(`/api/time-machine?at=${encodeURIComponent(at)}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.nearest).toBeTruthy();
    expect(d.nearest.heights.frames.length).toBeGreaterThan(0);
    expect(d.context.length).toBeLessThanOrEqual(5);
  });
});
