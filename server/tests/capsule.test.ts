import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 5, username: 'cap_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const db = new PrismaClient();
const TEST_USER_ID = 5;

beforeAll(async () => {
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: { id: TEST_USER_ID, username: 'cap_test', email: 'cap_test@example.com', passwordHash: 'x' },
  });
  await db.capsule.deleteMany({ where: { userId: TEST_USER_ID } });
});

afterAll(async () => {
  await db.capsule.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe('Capsules', () => {
  it('POST /seal creates a capsule locked 90 days with auto note', async () => {
    const res = await request(app).post('/api/capsules/seal').send({
      trackPath: 'D:/music/track_a.mp3',
      songId: null,
      freqSnapshot: [0.8,0.7,0.5,0.4,0.3,0.2,0.1,0.1],
      lrcLine: '当我在这里',
      resonance: 0.82,
      engagementScore: 0.9,
      posMs: 120000,
    });
    expect(res.status).toBe(201);
    const cap = res.body.data;
    expect(cap.note).toBeTruthy();
    expect(cap.note).toContain('当我在这里');
    const days = (new Date(cap.lockedUntil).getTime() - new Date(cap.createdAt).getTime()) / 86400000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it('POST /seal dedupes: second seal for same track within 90d is skipped', async () => {
    const res = await request(app).post('/api/capsules/seal').send({
      trackPath: 'D:/music/track_a.mp3',
      songId: null,
      freqSnapshot: [0.8,0.7,0.5,0.4,0.3,0.2,0.1,0.1],
      lrcLine: '',
      resonance: 0.82, engagementScore: 0.9, posMs: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.skipped).toBe(true);
  });

  it('GET /due returns unlocked capsules and marks revealed (one-shot)', async () => {
    await db.capsule.create({
      data: {
        userId: TEST_USER_ID, trackPath: 'D:/music/track_b.mp3',
        snapshotJson: { freq: [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8], lrcLine: '旧时光', note: 'test', resonance: 0.7, engagementScore: 0.9, posMs: 0 },
        lockedUntil: new Date(Date.now() - 86400000),
      },
    });
    const res = await request(app).get('/api/capsules/due');
    expect(res.status).toBe(200);
    const due = res.body.data;
    expect(due.length).toBeGreaterThan(0);
    const b = due.find((c: any) => c.trackPath.includes('track_b'));
    expect(b).toBeTruthy();
    expect(b.snapshot.lrcLine).toBe('旧时光');
    const res2 = await request(app).get('/api/capsules/due');
    expect(res2.body.data.find((c: any) => c.trackPath.includes('track_b'))).toBeUndefined();
  });
});
