import { UrlManagerService } from '../src/modules/url-manager/url-manager.service';

// mock 依赖，避免真实网络/DB/Python
jest.mock('../src/modules/songs/songs.service', () => ({
  checkAudioUrlPlayable: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    urlRefreshLog: { create: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock('../src/lib/redis', () => ({
  withRedis: jest.fn(async (fn: any, fb: any) => fb),
}));
jest.mock('../src/lib/python-runner', () => ({
  runPython: jest.fn(),
}));
jest.mock('../src/modules/url-manager/music-api.service', () => ({
  parseTrackId: jest.fn((id: string) => ({ songId: id.split(':').pop()!, source: 'netease' })),
  fetchMusicUrlFromMultipleSources: jest.fn(),
}));

const prisma = require('../src/lib/prisma').default;
const { runPython } = require('../src/lib/python-runner');
const { fetchMusicUrlFromMultipleSources } = require('../src/modules/url-manager/music-api.service');

// 单测中 withRetry 使用真实指数退避，失败降级用例耗时较长，放宽超时
jest.setTimeout(20000);

describe('UrlManagerService.refreshUrl 多源降级', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // 消除 getUrlSize 的真实 HTTP HEAD 请求（避免单测挂起/命中网络）
    jest.spyOn(UrlManagerService.prototype as any, 'getUrlSize').mockResolvedValue(0);
    prisma.song.findUnique.mockResolvedValue({
      id: 'netease:123', title: '测试歌曲', audioUrl: 'https://old', platform: 'netease', urlSource: 'netease',
    });
  });

  it('Python 网易云主源成功时直接返回', async () => {
    runPython.mockResolvedValue({ stdout: JSON.stringify({ success: true, url: 'https://python-url' }), stderr: '' });
    fetchMusicUrlFromMultipleSources.mockResolvedValue(null);

    const svc = new UrlManagerService();
    const url = await svc.refreshUrl('netease:123', 'manual');
    expect(url).toBe('https://python-url');
    expect(fetchMusicUrlFromMultipleSources).not.toHaveBeenCalled();
  });

  it('Python 失败时降级到多源（qq）', async () => {
    runPython.mockResolvedValue({ stdout: JSON.stringify({ success: false, error: 'fail' }), stderr: '' });
    fetchMusicUrlFromMultipleSources.mockResolvedValue({ url: 'https://qq-url', size: 2 * 1024 * 1024, source: 'qq', bitrate: 128000 });

    const svc = new UrlManagerService();
    const url = await svc.refreshUrl('netease:123', 'manual');
    expect(url).toBe('https://qq-url');
    expect(fetchMusicUrlFromMultipleSources).toHaveBeenCalled();
  });
});
