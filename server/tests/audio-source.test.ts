// Source-Adapter 解析优先级 + Jamendo stub 模式测试
process.env.ENABLE_NETEASE_FALLBACK = 'false';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../src/config';

const mockFindUnique = jest.fn();
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: { findUnique: (...args: any[]) => mockFindUnique(...args) },
    $queryRawUnsafe: jest.fn(),
  },
}));

import { resolveTrackAudio, isInLibrary } from '../src/modules/library/audio-source.service';
import { searchJamendoTracks, importJamendoTracks } from '../src/modules/library/jamendo.service';

describe('Source-Adapter 解析优先级', () => {
  const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-lib-test-'));

  beforeAll(() => {
    // 直接替换 config 对象字段（service 在调用时读取）
    (config as any).audioLibraryDir = tmpLib;
    (config as any).port = 49200;
    (config as any).neteaseFallbackEnabled = false;
    (config as any).jamendo = { clientId: '', apiBase: 'https://api.jamendo.com/v3.0', maxImportCount: 50 };
  });

  afterAll(() => fs.rmSync(tmpLib, { recursive: true, force: true }));

  beforeEach(() => mockFindUnique.mockReset());

  test('曲库文件存在 → kind=library（最高优先级）', async () => {
    const big = Buffer.alloc(200_000, 1);
    fs.writeFileSync(path.join(tmpLib, 'netease_1060910.mp3'), big);
    expect(isInLibrary('netease:1060910')).toBe(true);
    const r = await resolveTrackAudio('netease:1060910');
    expect(r.kind).toBe('library');
    expect((r as any).filePath).toContain('netease_1060910.mp3');
  });

  test('url_source=self-hosted 且相对路径 → absolutize 为远程 URL', async () => {
    mockFindUnique.mockResolvedValue({ audioUrl: '/audio-lib/netease_28059417.mp3', urlSource: 'self-hosted', platform: 'netease' });
    const r = await resolveTrackAudio('netease:28059417');
    expect(r.kind).toBe('remote');
    expect((r as any).url).toBe('http://127.0.0.1:49200/audio-lib/netease_28059417.mp3');
    expect((r as any).source).toBe('self-hosted');
  });

  test('url_source=jamendo 且绝对 URL → 原样返回', async () => {
    mockFindUnique.mockResolvedValue({ audioUrl: 'https://prod-1.storage-server-nyc.audius.ovh/x.mp3', urlSource: 'jamendo', platform: 'jamendo' });
    const r = await resolveTrackAudio('jamendo:123');
    expect(r.kind).toBe('remote');
    expect((r as any).url).toBe('https://prod-1.storage-server-nyc.audius.ovh/x.mp3');
  });

  test('无曲库文件、无可用 url_source、fallback 关闭 → none', async () => {
    mockFindUnique.mockResolvedValue({ audioUrl: '', urlSource: null, platform: 'netease' });
    const r = await resolveTrackAudio('netease:999');
    expect(r.kind).toBe('none');
  });

  test('歌曲不存在 → none', async () => {
    mockFindUnique.mockResolvedValue(null);
    const r = await resolveTrackAudio('netease:404');
    expect(r.kind).toBe('none');
    expect((r as any).reason).toBe('song_not_found');
  });

  test('曲库文件 <100KB 不算有效资产', () => {
    fs.writeFileSync(path.join(tmpLib, 'netease_tiny.mp3'), Buffer.alloc(1024));
    expect(isInLibrary('netease_tiny')).toBe(false);
  });
});

describe('Jamendo stub 模式（client_id 未配置）', () => {
  beforeAll(() => {
    (config as any).jamendo = { clientId: '', apiBase: 'https://api.jamendo.com/v3.0', maxImportCount: 50 };
  });

  test('搜索返回 stub 提示且不发起网络请求', async () => {
    const r = await searchJamendoTracks({ q: 'acoustic', limit: 5 });
    expect(r.ok).toBe(false);
    expect(r.stub).toBe(true);
    expect(r.reason).toContain('JAMENDO_CLIENT_ID');
    expect(r.tracks).toHaveLength(0);
  });

  test('导入返回 stub 提示', async () => {
    const r = await importJamendoTracks(['123', '456']);
    expect(r.ok).toBe(false);
    expect(r.stub).toBe(true);
    expect(r.imported).toBe(0);
  });
});
