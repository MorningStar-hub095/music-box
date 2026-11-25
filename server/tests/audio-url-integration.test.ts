import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';

// 绕过认证
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 1, username: 'test', role: 'user', status: 'active' }; next(); },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const testPrisma = new PrismaClient();

// 预检测端点在未缓存时会走真实 URL 探测，放宽超时避免偶发超时
jest.setTimeout(20000);

beforeAll(async () => {
  await testPrisma.song.upsert({
    where: { id: 'netease:integration-test' },
    update: {},
    // 设置未来过期时间，避免 getNeteaseUrl 触发 Python 爬虫慢路径
    create: { id: 'netease:integration-test', title: '集成测试曲目', artist: '测试', audioUrl: 'https://example.com/audio.mp3', urlExpiresAt: new Date(Date.now() + 3600 * 1000) },
  });
});

afterAll(async () => {
  await testPrisma.audioErrorLog.deleteMany({ where: { trackId: 'netease:integration-test' } }).catch(() => {});
  await testPrisma.song.deleteMany({ where: { id: 'netease:integration-test' } });
  await testPrisma.$disconnect();
});

describe('GET /api/refresh-track', () => {
  it('缺少 id 返回 400', async () => {
    const res = await request(app).get('/api/refresh-track');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/audio/error-report', () => {
  it('记录播放错误并返回成功', async () => {
    const res = await request(app)
      .post('/api/audio/error-report')
      .send({ trackId: 'netease:integration-test', errorType: 'playback_error', urlSource: 'remote', details: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('缺少 trackId 返回 400', async () => {
    const res = await request(app).post('/api/audio/error-report').send({ errorType: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/audio/:trackId/check', () => {
  it('返回 valid 字段（本地未缓存）', async () => {
    const res = await request(app).get('/api/audio/netease:integration-test/check');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid');
  });
});
