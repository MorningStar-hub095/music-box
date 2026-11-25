import { SongsService } from '../src/modules/songs/songs.service';

// mock 依赖
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    operationLog: {
      create: jest.fn(),
    },
  },
}));
jest.mock('../src/lib/python-runner', () => ({
  runPython: jest.fn(),
}));

const prisma = require('../src/lib/prisma').default;
const { runPython } = require('../src/lib/python-runner');

describe('SongsService.addManualSong', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('自动搜索成功时创建歌曲', async () => {
    prisma.song.findFirst.mockResolvedValue(null);
    runPython.mockResolvedValue({
      stdout: JSON.stringify({ success: true, url: 'https://example.com/a.mp3', songId: '1', title: '测试', artist: '歌手' }),
      stderr: '',
    });
    prisma.song.create.mockImplementation(async ({ data }: any) => ({ id: data.id, ...data }));

    const svc = new SongsService();
    const song = await svc.addManualSong('测试', '歌手', undefined, 1);

    expect(song.title).toBe('测试');
    expect(song.audioUrl).toBe('https://example.com/a.mp3');
    expect(prisma.song.create).toHaveBeenCalled();
  });

  it('自动搜索失败时抛出错误', async () => {
    prisma.song.findFirst.mockResolvedValue(null);
    runPython.mockResolvedValue({ stdout: JSON.stringify({ success: false, error: '无结果' }), stderr: '' });

    const svc = new SongsService();
    await expect(svc.addManualSong('不存在', '歌手', undefined, 1)).rejects.toThrow();
  });

  it('歌曲已存在时返回已有歌曲（不重复创建）', async () => {
    const existing = { id: 'manual:old', title: '测试', artist: '歌手', audioUrl: 'https://old' };
    prisma.song.findFirst.mockResolvedValue(existing);

    const svc = new SongsService();
    const song = await svc.addManualSong('测试', '歌手', undefined, 1);

    expect(song.id).toBe('manual:old');
    expect(prisma.song.create).not.toHaveBeenCalled();
  });
});
