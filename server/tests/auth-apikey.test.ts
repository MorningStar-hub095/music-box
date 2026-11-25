import request from 'supertest';
import app from '../src/index';

// 注意：本测试不 mock auth 中间件，用于验证真实 X-Api-Key 回退路径。
// 使用 GET /api/genome/map（已注册 authenticate）作为鉴权探针端点。
// 该端点在鉴权通过后若 DB 无数据可能返回 500，因此断言只关注是否 401。

describe('API key auth fallback', () => {
  it('accepts valid X-Api-Key and injects desktop user', async () => {
    const res = await request(app)
      .get('/api/genome/map')
      .set('X-Api-Key', 'mb-desktop-secret-key');
    expect(res.status).not.toBe(401);
  });

  it('rejects invalid X-Api-Key', async () => {
    const res = await request(app)
      .get('/api/genome/map')
      .set('X-Api-Key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('still rejects requests with no auth header (401)', async () => {
    const res = await request(app).get('/api/genome/map');
    expect(res.status).toBe(401);
  });
});
