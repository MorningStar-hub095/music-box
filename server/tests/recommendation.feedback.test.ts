import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { cache } from '../src/lib/redis';
import app from '../src/index';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 3, username: 'fb_test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const db = new PrismaClient();
const TEST_USER_ID = 3;
const testSongIds: string[] = [];

beforeAll(async () => {
  // 清除候选池缓存，确保种子歌曲可见（避免上一个测试的缓存污染）
  await cache.del('rec:pool:v1');
  // 幂等清理：上次运行残留的种子行（含 social_dna 外键链）会导致 song.create 唯一约束冲突
  await db.songFeature.deleteMany({ where: { songId: { startsWith: 'fb-test-' } } });
  await db.listeningEvent.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.dailyRecommendation.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.recommendationFeedback.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.socialDna.deleteMany({ where: { userId: TEST_USER_ID } }).catch(() => {});
  await db.song.deleteMany({ where: { id: { startsWith: 'fb-test-' } } });
  await db.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: { id: TEST_USER_ID, username: 'fb_test', email: 'fb_test@example.com', passwordHash: 'x' },
  });
  // 种子 12 首歌曲，全部带 SongFeature 以确保走 MMR 路径
  for (let i = 0; i < 12; i++) {
    const sid = `fb-test-${i}`;
    await db.song.create({
      data: {
        id: sid, title: `FbTest ${i}`, artist: `Artist ${i}`,
        audioUrl: `http://example.com/fb${i}.mp3`, playable: true, hotScore: 100 - i,
        features: { create: { subBass: 0.5 + i*0.05, bass: 0.4, lowMid: 0.3, mid: 0.3, highMid: 0.2, presence: 0.2, brilliance: 0.1, air: 0.1, bpm: 120, energy: 0.6 } },
      },
    });
    testSongIds.push(sid);
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

describe('feedback loop', () => {
  it('excludes disliked songs from future recommendations', async () => {
    // 1. 先清理并生成推荐
    await db.dailyRecommendation.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.recommendationFeedback.deleteMany({ where: { userId: TEST_USER_ID } });
    const daily = await request(app).get('/api/recommendation/daily');
    expect(daily.body.data.songs).toHaveLength(10);
    const target = daily.body.data.songs[0].id;

    // 2. dislike 第一首
    const fb = await request(app).post('/api/recommendation/feedback')
      .send({ songId: target, feedback: 'dislike' });
    expect(fb.status).toBe(200);

    // 3. 再次获取推荐，target 不应再出现
    const next = await request(app).get('/api/recommendation/daily');
    const ids = next.body.data.songs.map((s: any) => s.id);
    expect(ids).not.toContain(target);
  });
});
