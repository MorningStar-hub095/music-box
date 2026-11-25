import { UrlMonitorService } from '../src/modules/url-manager/url-manager.monitor';

// mock 依赖，避免真实 DB/缓存
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: { count: jest.fn(), findMany: jest.fn() },
    urlRefreshLog: { count: jest.fn(), aggregate: jest.fn() },
    urlAlert: {
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));
jest.mock('../src/lib/redis', () => ({
  withRedis: jest.fn(async (fn: any, fb: any) => fb),
}));

const prisma = require('../src/lib/prisma').default;
const { withRedis } = require('../src/lib/redis');

describe('UrlMonitorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recordRefreshSuccess 记录统计不抛错', async () => {
    const svc = new UrlMonitorService();
    await expect(svc.recordRefreshSuccess('netease:1', 'netease', 100)).resolves.toBeUndefined();
    expect(withRedis).toHaveBeenCalled();
  });

  it('recordRefreshFailure 记录统计不抛错', async () => {
    const svc = new UrlMonitorService();
    await expect(svc.recordRefreshFailure('netease:1', 'netease', 'err')).resolves.toBeUndefined();
    expect(withRedis).toHaveBeenCalled();
  });

  it('resolveAlert 调用 urlAlert.update', async () => {
    prisma.urlAlert.update.mockResolvedValue({});
    const svc = new UrlMonitorService();
    await svc.resolveAlert(1n);
    expect(prisma.urlAlert.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { resolved: true, resolvedAt: expect.any(Date) },
    });
  });

  it('getAlerts 返回 urlAlert.findMany 结果', async () => {
    const alerts = [{ id: 1n, type: 'validity_rate' }];
    prisma.urlAlert.findMany.mockResolvedValue(alerts);
    const svc = new UrlMonitorService();
    const result = await svc.getAlerts(10, false);
    expect(result).toEqual(alerts);
    expect(prisma.urlAlert.findMany).toHaveBeenCalledWith({
      where: { resolved: false },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('cleanupOldAlerts 返回删除数量', async () => {
    prisma.urlAlert.deleteMany.mockResolvedValue({ count: 5 });
    const svc = new UrlMonitorService();
    const result = await svc.cleanupOldAlerts();
    expect(result).toBe(5);
  });

  it('getStats 返回有效指标', async () => {
    prisma.song.count.mockResolvedValue(100);
    prisma.urlRefreshLog.count.mockResolvedValue(0);
    prisma.urlRefreshLog.aggregate.mockResolvedValue({ _avg: { responseTime: 0 } });

    const svc = new UrlMonitorService();
    const stats = await svc.getStats();
    expect(stats.totalTracks).toBe(100);
    expect(stats).toHaveProperty('validUrls');
    expect(stats).toHaveProperty('sourceSuccessRate');
    expect(stats).toHaveProperty('avgRefreshTime');
  });
});
