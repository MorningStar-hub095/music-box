/// <reference types="jest" />
import request from 'supertest';
import app from '../src/index';
import prisma from '../src/lib/prisma';

// 绕过速率限制（避免测试被限流），但保留真实认证流程
jest.mock('express-rate-limit', () => {
  return jest.fn(() => (_req: any, _res: any, next: any) => next());
});
jest.mock('../src/middleware/rateLimit', () => ({
  createRateLimit: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// 不 mock auth 中间件，使用真实认证流程

let testUser: { id: number; token: string };
let guestToken: string;

beforeAll(async () => {
  // 清理可能存在的测试用户（包括上次运行残留）
  await prisma.operationLog.deleteMany({
    where: { user: { username: { startsWith: 'test_auth_' } } },
  }).catch(() => {});
  await prisma.operationLog.deleteMany({
    where: { user: { username: { startsWith: 'guest_' } } },
  }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: 'test_auth_' } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: 'guest_' } } }).catch(() => {});
});

afterAll(async () => {
  // 清理测试数据
  if (testUser) {
    await prisma.operationLog.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: testUser.id } }).catch(() => {});
  }
  // 清理 guest 用户
  await prisma.operationLog.deleteMany({
    where: { user: { username: { startsWith: 'guest_' } } },
  }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: 'guest_' } } }).catch(() => {});
  // 清理残留的 test_auth_ 用户（如 profile 测试中创建的 other 用户）
  await prisma.operationLog.deleteMany({
    where: { user: { username: { startsWith: 'test_auth_' } } },
  }).catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: 'test_auth_' } } }).catch(() => {});

  await prisma.$disconnect();
});

describe('Auth - Register', () => {
  it('should register a new user successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'test_auth_user_1',
        email: 'test_auth_1@example.com',
        password: 'password123',
        securityQuestion: '你的出生城市是？',
        securityAnswer: '北京',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.username).toBe('test_auth_user_1');
    expect(res.body.data.user.role).toBe('user');
    expect(res.body.data.user.status).toBe('active');

    testUser = { id: res.body.data.user.id, token: res.body.data.token };
  });

  it('should reject duplicate username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'test_auth_user_1',
        email: 'test_auth_2@example.com',
        password: 'password123',
        securityQuestion: '你的出生城市是？',
        securityAnswer: '北京',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('用户名已存在');
  });

  it('should reject duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'test_auth_user_3',
        email: 'test_auth_1@example.com',
        password: 'password123',
        securityQuestion: '你的出生城市是？',
        securityAnswer: '北京',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('邮箱已被注册');
  });

  it('should reject short username', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'ab',
        email: 'short@example.com',
        password: 'password123',
        securityQuestion: 'Q',
        securityAnswer: 'A',
      });
    expect(res.status).toBe(400);
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'test_auth_shortpw',
        email: 'shortpw@example.com',
        password: '12345',
        securityQuestion: 'Q',
        securityAnswer: 'A',
      });
    expect(res.status).toBe(400);
  });

  it('should reject missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'test_auth_incomplete' });
    expect(res.status).toBe(400);
  });
});

describe('Auth - Login', () => {
  it('should login with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_auth_user_1', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.username).toBe('test_auth_user_1');
  });

  it('should reject wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_auth_user_1', password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('用户名或密码错误');
  });

  it('should reject non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent_user_xyz', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('should reject missing credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_auth_user_1' });
    expect(res.status).toBe(400);
  });
});

describe('Auth - Guest Login', () => {
  it('should create guest user', async () => {
    const res = await request(app)
      .post('/api/auth/guest');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.username).toMatch(/^guest_/);
    expect(res.body.data.user.role).toBe('user');
    guestToken = res.body.data.token;
  });

  it('should access /me with guest token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${guestToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toMatch(/^guest_/);
  });
});

describe('Auth - Get Current User', () => {
  it('should return user info with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${testUser.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('test_auth_user_1');
    expect(res.body.data.email).toBe('test_auth_1@example.com');
  });

  it('should reject request without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should reject request with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token_here');
    expect(res.status).toBe(401);
  });
});

describe('Auth - Change Password', () => {
  it('should change password successfully', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({ oldPassword: 'password123', newPassword: 'newpassword456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should login with new password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_auth_user_1', password: 'newpassword456' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    // 更新 token
    testUser.token = res.body.data.token;
  });

  it('should reject old password after change', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_auth_user_1', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('should reject wrong old password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({ oldPassword: 'wrongold', newPassword: 'anothernew' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('原密码错误');
  });

  it('should reject short new password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({ oldPassword: 'newpassword456', newPassword: '12345' });
    expect(res.status).toBe(400);
  });

  it('should reject without auth', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ oldPassword: 'newpassword456', newPassword: 'newpw789' });
    expect(res.status).toBe(401);
  });
});

describe('Auth - Update Profile', () => {
  it('should update email', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({ email: 'updated_test@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('updated_test@example.com');
  });

  it('should reject duplicate email', async () => {
    // 先创建另一个用户
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'test_auth_other',
        email: 'other_test@example.com',
        password: 'password123',
        securityQuestion: 'Q',
        securityAnswer: 'A',
      });

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({ email: 'other_test@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('邮箱已被使用');

    // 清理
    await prisma.user.delete({ where: { id: reg.body.data.user.id } }).catch(() => {});
  });

  it('should update security question and answer', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({ securityQuestion: '新安全问题', securityAnswer: '新安全答案' });
    expect(res.status).toBe(200);
  });

  it('should reject empty update', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${testUser.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('should reject without auth', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .send({ email: 'hack@example.com' });
    expect(res.status).toBe(401);
  });
});

describe('Auth - Password Reset Flow', () => {
  it('should request password reset with correct security answer', async () => {
    const res = await request(app)
      .post('/api/auth/password-reset-request')
      .send({ username: 'test_auth_user_1', securityAnswer: '新安全答案' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should handle non-existent user gracefully', async () => {
    const res = await request(app)
      .post('/api/auth/password-reset-request')
      .send({ username: 'nonexistent_xyz', securityAnswer: 'whatever' });
    // 应返回成功（不泄露用户是否存在）
    expect(res.status).toBe(200);
  });

  it('should reject missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/password-reset-request')
      .send({ username: 'test_auth_user_1' });
    expect(res.status).toBe(400);
  });
});

describe('Auth - Audit Logging', () => {
  it('should have created audit logs for register and login', async () => {
    if (!testUser) return;

    const logs = await prisma.operationLog.findMany({
      where: { userId: testUser.id },
      orderBy: { createdAt: 'desc' },
    });

    const actions = logs.map(l => l.action);
    // 应该有 REGISTER、LOGIN、CHANGE_PASSWORD 等记录
    expect(actions).toContain('REGISTER');
    expect(actions).toContain('LOGIN');
    expect(actions).toContain('CHANGE_PASSWORD');
  });
});
