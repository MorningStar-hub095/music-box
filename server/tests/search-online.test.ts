/**
 * 线上搜索服务单元测试（2026-11-18 搜索强化）
 *
 * 覆盖：scope 短路 / 全局开关 / stub 模式 / 进程内缓存 / 硬超时 fail-open / 结果映射
 * jamendo.service 与 config 全部 mock，不发真实网络请求。
 */
import { searchOnline, clearOnlineSearchCache } from '../src/modules/search/search-online.service';
import { searchJamendoTracks, isJamendoConfigured } from '../src/modules/library/jamendo.service';

jest.mock('../src/modules/library/jamendo.service', () => ({
  __esModule: true,
  searchJamendoTracks: jest.fn(),
  isJamendoConfigured: jest.fn(),
}));

jest.mock('../src/config', () => ({
  __esModule: true,
  config: {
    search: {
      online: {
        enabled: true,
        timeoutMs: 200,
        maxResults: 10,
        cacheTtl: 300,
      },
    },
  },
  default: {
    search: {
      online: {
        enabled: true,
        timeoutMs: 200,
        maxResults: 10,
        cacheTtl: 300,
      },
    },
  },
}));

const mockedSearch = searchJamendoTracks as jest.Mock;
const mockedConfigured = isJamendoConfigured as jest.Mock;

// 构造 Jamendo 风格的原始结果
function jamTrack(overrides: Record<string, any> = {}) {
  return {
    id: '42',
    name: 'Test Song',
    artist_name: 'Test Artist',
    album_name: 'Test Album',
    album_image: 'https://img.example/cover.jpg',
    duration: 180,
    license_ccurl: 'https://creativecommons.org/licenses/by/3.0/',
    audiodownload: 'https://dl.example/42.mp3',
    audiodownload_allowed: true,
    audio: 'https://stream.example/42.mp3',
    ...overrides,
  };
}

describe('searchOnline（线上搜索）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearOnlineSearchCache();
    mockedConfigured.mockReturnValue(true);
    mockedSearch.mockResolvedValue({ ok: true, tracks: [jamTrack()] });
  });

  it('scope=local 直接短路：available=false 且不发起任何线上请求', async () => {
    const r = await searchOnline('jazz', 'local');
    expect(r.available).toBe(false);
    expect(r.reason).toBe('scope_local');
    expect(r.items).toEqual([]);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('全局开关关闭时降级为不可用，不发起请求', async () => {
    const { config } = require('../src/config');
    const saved = config.search.online.enabled;
    config.search.online.enabled = false;
    try {
      const r = await searchOnline('jazz');
      expect(r.available).toBe(false);
      expect(r.reason).toBe('online_disabled');
      expect(mockedSearch).not.toHaveBeenCalled();
    } finally {
      config.search.online.enabled = saved;
    }
  });

  it('stub 模式（client_id 未配置）返回明确 reason，不发起请求', async () => {
    mockedConfigured.mockReturnValue(false);
    const r = await searchOnline('jazz');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('JAMENDO_CLIENT_ID');
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('正常搜索：Jamendo 结果映射为线上曲目，流媒体链接优先', async () => {
    const r = await searchOnline('jazz');
    expect(r.available).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      id: 'jamendo-online:42',
      title: 'Test Song',
      artist: 'Test Artist',
      platform: 'jamendo',
      source: 'online',
      audioKind: 'stream',
      audioUrl: 'https://stream.example/42.mp3',
    });
    expect(r.items[0].licenseUrl).toContain('creativecommons.org');
    // 2026-11-20 搜索升级：搜索路径传 groupby:false（旧实现恒带 groupby:'artist_id'，
    // 每位歌手只回 1 首，导致歌手名搜索线上命中缺失）；offset:0 为默认首页
    expect(mockedSearch).toHaveBeenCalledWith({ q: 'jazz', limit: 10, groupby: false, offset: 0 });
  });

  it('无任何可播放链接的结果被过滤，download-only 结果 audioKind=download', async () => {
    mockedSearch.mockResolvedValue({
      ok: true,
      tracks: [
        jamTrack({ id: '1', audio: '' }),
        jamTrack({ id: '2', audio: '', audiodownload: 'https://dl.example/2.mp3' }),
        jamTrack({ id: '3', audio: '', audiodownload: '' }),
      ],
    });
    const r = await searchOnline('jazz');
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ id: 'jamendo-online:1', audioKind: 'download' });
    expect(r.items[1]).toMatchObject({ id: 'jamendo-online:2', audioKind: 'download' });
  });

  it('进程内缓存生效：同一关键词第二次调用不重复请求 Jamendo', async () => {
    await searchOnline('jazz');
    const r2 = await searchOnline('jazz');
    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(r2.items).toHaveLength(1);
    expect(r2.duration).toBe(0); // 缓存命中几乎零耗时
  });

  it('不同关键词不共享缓存', async () => {
    await searchOnline('jazz');
    await searchOnline('piano');
    expect(mockedSearch).toHaveBeenCalledTimes(2);
  });

  it('线上 API 失败：fail-open 返回空结果 + reason，绝不抛错', async () => {
    mockedSearch.mockResolvedValue({ ok: false, reason: 'api_http_500', tracks: [] });
    const r = await searchOnline('jazz');
    expect(r.available).toBe(false);
    expect(r.reason).toBe('jamendo:api_http_500');
    expect(r.items).toEqual([]);
  });

  it('线上 API 挂起：硬超时闸门兜底，fail-open 返回空结果', async () => {
    mockedSearch.mockImplementation(() => new Promise(() => { /* 永不 resolve */ }));
    const r = await searchOnline('jazz');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('timeout');
    expect(r.items).toEqual([]);
    expect(r.duration).toBeLessThan(5000);
  }, 5000);

  it('线上异常抛错：同样 fail-open 不向外传播异常', async () => {
    mockedSearch.mockRejectedValue(new Error('network dead'));
    const r = await searchOnline('jazz');
    expect(r.available).toBe(false);
    expect(r.items).toEqual([]);
  });
});
