import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../src/index';

// 绕过认证：让 authenticate 直接注入测试用户，authorize 放行
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'test', role: 'user', status: 'active' };
    next();
  },
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

const testPrisma = new PrismaClient();

beforeAll(async () => {
  // 确保测试用户存在（外键约束要求 user_id 引用真实用户）
  await testPrisma.user.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      username: 'test_listener',
      email: 'test_listener@example.com',
      passwordHash: 'test_hash_not_real',
    },
  });
});

afterAll(async () => {
  // 清理测试数据
  await testPrisma.listeningEvent.deleteMany({ where: { userId: 1 } });
  await testPrisma.user.deleteMany({ where: { id: 1 } }).catch(() => {});
  await testPrisma.$disconnect();
});

describe('POST /api/listening/events', () => {
  it('should batch insert listening events', async () => {
    const payload = {
      events: [
        {
          trackPath: 'D:/music/1.mp3', trackTitle: 'T1', trackArtist: 'A1',
          eventType: 'complete', positionMs: 180000, durationMs: 180000,
          engagementScore: 0.95, occurredAt: new Date().toISOString(),
          featBass: 0.6, featMid: 0.4,
        },
        {
          trackPath: 'D:/music/2.mp3', trackTitle: 'T2', trackArtist: 'A2',
          eventType: 'skip', positionMs: 8000, durationMs: 200000,
          engagementScore: 0.1, occurredAt: new Date().toISOString(),
        },
      ],
    };
    const res = await request(app).post('/api/listening/events').send(payload);
    expect(res.status).toBe(201);
    // 修复: API 响应结构为 { success, data: { accepted } }，原断言取错层级
    expect(res.body.data.accepted).toBe(2);
  });
});
