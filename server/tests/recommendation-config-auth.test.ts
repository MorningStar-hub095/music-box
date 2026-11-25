/**
 * 推荐配置接口权限测试
 * 对应优化2（H4）：PUT /api/recommendation/config 仅 admin/super_admin 可调用
 *
 * 注意：本文件使用【真实的 authorize 中间件】，仅 mock authenticate 注入用户身份，
 * 以验证路由层的角色校验真实生效。
 */
import request from 'supertest';
import app from '../src/index';

// mock authenticate：可按用例切换角色；authorize 保持真实实现
let currentRole = 'user';
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 2, username: 'perm_test', role: currentRole, status: 'active' };
      next();
    },
  };
});

describe('PUT /api/recommendation/config 权限校验', () => {
  it('普通用户（role=user）被拒绝，返回 403', async () => {
    currentRole = 'user';
    const res = await request(app).put('/api/recommendation/config').send({ weights: { rule: 0.4 } });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('管理员（role=admin）可正常更新配置', async () => {
    currentRole = 'admin';
    const res = await request(app).put('/api/recommendation/config').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('超级管理员（role=super_admin）可正常更新配置', async () => {
    currentRole = 'super_admin';
    const res = await request(app).put('/api/recommendation/config').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
