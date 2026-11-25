import request from 'supertest';
import { PrismaClient, Prisma } from '@prisma/client';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 4, username: 'dna_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const db = new PrismaClient();
const TEST_USER_ID = 4;

beforeAll(async () => {
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: { id: TEST_USER_ID, username: 'dna_test', email: 'dna_test@example.com', passwordHash: 'x' },
  });
  await db.listeningEvent.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.listeningEvent.createMany({
    data: [
      { userId: TEST_USER_ID, eventType: 'complete', engagementScore: 0.9,
        featSubBass: 0.8, featBass: 0.7, featLowMid: 0.5, featMid: 0.4,
        featHighMid: 0.3, featPresence: 0.2, featBrilliance: 0.1, featAir: 0.1 },
      { userId: TEST_USER_ID, eventType: 'complete', engagementScore: 0.8,
        featSubBass: 0.7, featBass: 0.6, featLowMid: 0.4, featMid: 0.3,
        featHighMid: 0.2, featPresence: 0.2, featBrilliance: 0.1, featAir: 0.1 },
      { userId: TEST_USER_ID, eventType: 'skip', engagementScore: 0.5,
        featSubBass: 0.1, featBass: 0.1, featLowMid: 0.3, featMid: 0.4,
        featHighMid: 0.6, featPresence: 0.7, featBrilliance: 0.8, featAir: 0.9 },
      // 修复: 服务自 2026-08-09 起要求 >=5 条事件才计算（MIN_EVENTS_THRESHOLD），
      // 补足 2 条低频偏好的 complete 事件以越过阈值
      { userId: TEST_USER_ID, eventType: 'complete', engagementScore: 0.9,
        featSubBass: 0.8, featBass: 0.7, featLowMid: 0.5, featMid: 0.4,
        featHighMid: 0.3, featPresence: 0.2, featBrilliance: 0.1, featAir: 0.1 },
      { userId: TEST_USER_ID, eventType: 'complete', engagementScore: 0.8,
        featSubBass: 0.7, featBass: 0.6, featLowMid: 0.4, featMid: 0.3,
        featHighMid: 0.2, featPresence: 0.2, featBrilliance: 0.1, featAir: 0.1 },
    ],
  });
});

afterAll(async () => {
  await db.listeningEvent.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.update({ where: { id: TEST_USER_ID }, data: { emotionDna: Prisma.DbNull } }).catch(()=>{});
  await db.user.deleteMany({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe('GET /api/emotion-dna', () => {
  it('returns 8-dim vector with high low-freq and reduced high-freq (skip negative)', async () => {
    const res = await request(app).get('/api/emotion-dna');
    expect(res.status).toBe(200);
    const v = res.body.data.vector;
    expect(v.subBass).toBeGreaterThan(v.air);
    expect(v.subBass).toBeGreaterThan(0.5);
    expect(res.body.data.updatedAt).not.toBeUndefined();
  });
});
