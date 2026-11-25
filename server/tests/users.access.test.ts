import request from 'supertest';
import app from '../src/index';

/**
 * users 路由越权修复回归测试（2026-10-26）
 * 修复前：GET /api/users 与 GET /api/users/:id 仅 authenticate 未 authorize，
 * 任意登录用户可拉取全量用户列表（含 email）。
 * 本测试只 mock authenticate 注入不同角色，authorize 使用真实实现。
 */
jest.mock('../src/middleware/auth', () => {
  // authorize 保留真实实现：从原模块取
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: jest.fn((req: any, _res: any, next: any) => {
      const role = (req.headers['x-test-role'] as string) || 'user';
      req.user = { id: 1, username: 'tester', role, status: 'active' };
      next();
    }),
  };
});

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, username: 'alice', email: 'a@x.com', role: 'user', status: 'active', createdAt: new Date() },
        { id: 2, username: 'bob', email: 'b@x.com', role: 'admin', status: 'active', createdAt: new Date() },
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: 2, username: 'bob', email: 'b@x.com', role: 'admin', status: 'active', createdAt: new Date() }),
    },
  },
}));

const prisma = require('../src/lib/prisma').default;

describe('GET /api/users 角色访问控制', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('普通用户访问列表 → 403', async () => {
    const res = await request(app).get('/api/users').set('x-test-role', 'user');
    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('admin 可访问列表', async () => {
    const res = await request(app).get('/api/users').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('super_admin 可访问单个用户', async () => {
    const res = await request(app).get('/api/users/2').set('x-test-role', 'super_admin');
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('bob');
  });

  it('普通用户访问单个用户 → 403', async () => {
    const res = await request(app).get('/api/users/2').set('x-test-role', 'user');
    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
