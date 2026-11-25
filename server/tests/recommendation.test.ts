import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { cache } from '../src/lib/redis';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 2, username: 'rec_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const db = new PrismaClient();
const TEST_USER_ID = 2;
const testSongIds: string[] = [];

beforeAll(async () => {
  // 清除候选池缓存，确保种子歌曲可见（避免上一个测试的缓存污染）
  await cache.del('rec:pool:v1');
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: { id: TEST_USER_ID, username: 'rec_test', email: 'rec_test@example.com', passwordHash: 'x' },
  });
  // 种子 12 首歌曲，8 首带 SongFeature
  for (let i = 0; i < 12; i++) {
    const sid = `rec-test-${i}`;
    const song = await db.song.create({
      data: {
        id: sid, title: `RecTest ${i}`, artist: `Artist ${i}`,
        audioUrl: `http://example.com/${i}.mp3`, playable: true, hotScore: 100 - i,
        features: i < 8 ? {
          create: {
            subBass: 0.5 + i * 0.05, bass: 0.4, lowMid: 0.3, mid: 0.3,
            highMid: 0.2, presence: 0.2, brilliance: 0.1, air: 0.1,
            bpm: 120, energy: 0.6,
          },
        } : undefined,
      },
    });
    testSongIds.push(song.id);
  }
});

afterAll(async () => {
  await db.dailyRecommendation.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.recommendationFeedback.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.songFeature.deleteMany({ where: { songId: { in: testSongIds } } });
  await db.song.deleteMany({ where: { id: { in: testSongIds } } });
  await db.listeningEvent.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe('GET /api/recommendation/daily', () => {
  it('returns 10 distinct recommendations', async () => {
    // 先清理可能的当日推荐，触发生成
    await db.dailyRecommendation.deleteMany({ where: { userId: TEST_USER_ID } });
    const res = await request(app).get('/api/recommendation/daily');
    expect(res.status).toBe(200);
    expect(res.body.data.songs).toHaveLength(10);
    const ids = res.body.data.songs.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('returns same recommendations on second call (cached for the day)', async () => {
    const res1 = await request(app).get('/api/recommendation/daily');
    const res2 = await request(app).get('/api/recommendation/daily');
    expect(res1.body.data.songs.map((s:any)=>s.id)).toEqual(res2.body.data.songs.map((s:any)=>s.id));
  });
});
