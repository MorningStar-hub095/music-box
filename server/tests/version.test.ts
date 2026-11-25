import request from 'supertest';
import app from '../src/index';
import { APP_VERSION, CHANGELOG } from '../src/version';

describe('GET /api/version', () => {
  it('returns current version and changelog', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(APP_VERSION);
    expect(Array.isArray(res.body.data.changelog)).toBe(true);
    // CHANGELOG 至少包含当前版本一条，且倒序排列在首位
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(res.body.data.changelog[0].version).toBe(APP_VERSION);
    expect(Array.isArray(res.body.data.changelog[0].changes)).toBe(true);
  });
});
