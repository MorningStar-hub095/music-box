import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 8, username: 'sd_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const db = new PrismaClient();
const UID = 8;

beforeAll(async () => {
  await db.user.upsert({
    where: { id: UID },
    update: {},
    create: { id: UID, username: 'sd_test', email: 'sd@e.com', passwordHash: 'x' },
  });
  await db.socialDna.deleteMany({ where: { userId: UID } });
  await db.listeningEvent.deleteMany({ where: { userId: UID } });
  await db.songFeature.deleteMany({ where: { song: { filePath: { startsWith: 'D:/sd_test/' } } } });
  await db.song.deleteMany({ where: { filePath: { startsWith: 'D:/sd_test/' } } });
  for (const [i, f] of [[0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]].entries()) {
    const s = await db.song.create({
      data: { id: `sd_s${i}`, title: `s${i}`, artist: '', audioUrl: '', filePath: `D:/sd_test/s${i}.mp3`, dataSource: 'manual' },
    });
    await db.songFeature.create({
      data: {
        songId: s.id,
        subBass: f[0], bass: f[1], lowMid: f[2], mid: f[3],
        highMid: f[4], presence: f[5], brilliance: f[6], air: f[7],
        bpm: 120, energy: 0.5, genomeX: i ? 1 : -1, genomeY: 0,
      },
    });
    await db.listeningEvent.create({
      data: {
        userId: UID, songId: s.id, eventType: 'complete', engagementScore: 0.8, occurredAt: new Date(),
        featSubBass: f[0], featBass: f[1], featLowMid: f[2], featMid: f[3],
        featHighMid: f[4], featPresence: f[5], featBrilliance: f[6], featAir: f[7],
      },
    });
  }
});

afterAll(async () => {
  await db.socialDna.deleteMany({ where: { userId: UID } });
  await db.listeningEvent.deleteMany({ where: { userId: UID } });
  await db.songFeature.deleteMany({ where: { song: { filePath: { startsWith: 'D:/sd_test/' } } } });
  await db.song.deleteMany({ where: { filePath: { startsWith: 'D:/sd_test/' } } });
  await db.user.deleteMany({ where: { id: UID } }).catch(() => {});
  await db.$disconnect();
});

describe('SocialDna', () => {
  it('GET /me returns 12-dim vector + SVG cipher', async () => {
    const res = await request(app).get('/api/social-dna/me');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.vector.length).toBe(12);
    expect(d.cipherSvg).toContain('<svg');
  });

  it('POST /match returns top complementary (1-cos)', async () => {
    await db.user.upsert({
      where: { id: 9 },
      update: {},
      create: { id: 9, username: 'sd_b', email: 'sd_b@e.com', passwordHash: 'x' },
    });
    await db.socialDna.upsert({
      where: { userId: 9 },
      create: { userId: 9, vectorJson: { vector: Array(12).fill(0.1) }, cipherSvg: '<svg/>' },
      update: { vectorJson: { vector: Array(12).fill(0.1) }, cipherSvg: '<svg/>' },
    });
    const res = await request(app).post('/api/social-dna/match').send({ limit: 10 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    await db.socialDna.deleteMany({ where: { userId: 9 } });
    await db.user.deleteMany({ where: { id: 9 } });
  });
});
