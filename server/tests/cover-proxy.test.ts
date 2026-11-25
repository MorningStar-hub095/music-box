/**
 * 封面代理路由单测（2026-11-20）
 * 覆盖：域名白名单拒绝、内网地址拒绝、非图片 content-type 拒绝、正常拉取与缓存命中
 * 远程拉取通过 setCoverFetcherForTests 注入 mock，不发真实网络请求；
 * DNS 解析通过 jest.spyOn(dns.promises, 'lookup') mock，测试不依赖外网。
 */

import request from 'supertest';
import dns from 'dns';
import path from 'path';
import fs from 'fs';
import os from 'os';

// 动态导入前设置缓存目录，避免测试污染真实 data/cover-cache
const TEST_COVER_CACHE_DIR = path.join(os.tmpdir(), `mb-cover-cache-test-${process.pid}`);

let app: any;
let service: typeof import('../src/modules/cover/cover-proxy.service');

beforeAll(async () => {
  process.env.COVER_CACHE_DIR = TEST_COVER_CACHE_DIR;
  service = await import('../src/modules/cover/cover-proxy.service');
  const mod = await import('../src/index');
  app = mod.default;
});

afterAll(() => {
  service.setCoverFetcherForTests(null);
  try { fs.rmSync(TEST_COVER_CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('isPrivateAddress（SSRF 防护 · 内网 IP 识别）', () => {
  const privateCases = ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1'];
  test.each(privateCases)('%s 应判定为内网', (ip) => {
    expect(service.isPrivateAddress(ip)).toBe(true);
  });

  const publicCases = ['8.8.8.8', '172.32.0.1', '45.113.128.1', '2001:db8::1'];
  test.each(publicCases)('%s 应判定为公网', (ip) => {
    expect(service.isPrivateAddress(ip)).toBe(false);
  });
});

describe('isCoverHostAllowed（域名白名单）', () => {
  it('放行网易云/Jamendo/Spotify 域名及其子域', () => {
    expect(service.isCoverHostAllowed('music.126.net')).toBe(true);
    expect(service.isCoverHostAllowed('p1.music.126.net')).toBe(true);
    expect(service.isCoverHostAllowed('pictures01.jamendo.com')).toBe(true);
    expect(service.isCoverHostAllowed('i.scdn.co')).toBe(true);
  });

  it('拒绝白名单外的域名与伪装域名', () => {
    expect(service.isCoverHostAllowed('evil.com')).toBe(false);
    expect(service.isCoverHostAllowed('music.126.net.evil.com')).toBe(false);
    expect(service.isCoverHostAllowed('fakejamendo.com')).toBe(false);
  });
});

describe('GET /api/cover', () => {
  let lookupSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // DNS 统一解析到公网 IP，使白名单域名的校验通过且不依赖真实网络
    lookupSpy = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '45.113.128.1', family: 4 },
    ] as any);
    fetchMock = jest.fn();
    service.setCoverFetcherForTests(async (url) => fetchMock(url));
    service.clearCoverMemCacheForTests();
  });

  afterEach(() => {
    lookupSpy.mockRestore();
  });

  it('缺少 url 参数 → 400', async () => {
    const res = await request(app).get('/api/cover');
    expect(res.status).toBe(400);
  });

  it('白名单外域名 → 403', async () => {
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent('https://evil.com/cover.jpg')}`);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('host_not_allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('内网 IP 字面量 → 403', async () => {
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent('http://127.0.0.1:49200/cover.jpg')}`);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('localhost → 403', async () => {
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent('http://localhost/cover.jpg')}`);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('internal_address');
  });

  it('非 http/https 协议 → 403', async () => {
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent('file:///etc/passwd')}`);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('protocol_not_allowed');
  });

  it('公网 IP 字面量（不在域名白名单）→ 403', async () => {
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent('http://8.8.8.8/cover.jpg')}`);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('上游返回非图片 content-type → 502', async () => {
    fetchMock.mockResolvedValue({ statusCode: 200, contentType: 'text/html', body: Buffer.from('<html/>') });
    const url = `https://p1.music.126.net/fake-${Date.now()}.png`;
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('not_an_image');
  });

  it('上游返回非 200 → 502', async () => {
    fetchMock.mockResolvedValue({ statusCode: 404, contentType: 'image/png', body: Buffer.alloc(0) });
    const url = `https://p2.music.126.net/gone-${Date.now()}.jpg`;
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('upstream_status_404');
  });

  it('正常拉取成功，再次请求命中内存缓存（fetcher 仅调用一次）', async () => {
    const img = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG 魔数
    fetchMock.mockResolvedValue({ statusCode: 200, contentType: 'image/png', body: img });
    const url = `https://p1.music.126.net/hit-${Date.now()}.png`;

    // 第一次：远程拉取
    const first = await request(app).get(`/api/cover?url=${encodeURIComponent(url)}`);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['x-cover-source']).toBe('remote');
    expect(first.headers['cache-control']).toContain('max-age=604800');
    expect(first.body).toEqual(img);

    // 第二次：内存缓存命中，不再访问上游
    const second = await request(app).get(`/api/cover?url=${encodeURIComponent(url)}`);
    expect(second.status).toBe(200);
    expect(second.headers['x-cover-source']).toBe('memory');
    expect(second.body).toEqual(img);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('SVG content-type 明确拒绝（防脚本注入）', async () => {
    fetchMock.mockResolvedValue({ statusCode: 200, contentType: 'image/svg+xml', body: Buffer.from('<svg/>') });
    const url = `https://pictures01.jamendo.com/s-${Date.now()}.svg`;
    const res = await request(app).get(`/api/cover?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('svg_not_allowed');
  });
});
