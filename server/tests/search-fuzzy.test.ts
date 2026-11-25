/**
 * 搜索升级回归测试（2026-11-20 搜索全面升级）
 *
 * 覆盖场景：在线（Jamendo groupby=false、线上条目重排）/ 离线（大小写不敏感、
 * 分词、拼音捞回、歌手聚合）/ 空结果 / 特殊字符与全角归一 / 重名歌手 / 分页一致性。
 *
 * 全程 mock prisma/redis/jamendo，零真实网络与数据库。
 */
import { EnhancedSearchService } from '../src/modules/search/search-enhanced.service';
import { SearchService } from '../src/modules/search/search.service';
import { searchOnline } from '../src/modules/search/search-online.service';
import { searchJamendoTracks } from '../src/modules/library/jamendo.service';

// mock prisma 与缓存，隔离数据库
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    song: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  },
}));
jest.mock('../src/lib/redis', () => ({
  cache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    clearPattern: jest.fn().mockResolvedValue(true),
  },
  withRedis: jest.fn(async (fn: any, fb: any) => fb),
}));
// mock Jamendo 服务（线上搜索路径经 searchOnline -> searchJamendoTracks）
jest.mock('../src/modules/library/jamendo.service', () => ({
  __esModule: true,
  isJamendoConfigured: jest.fn().mockReturnValue(true),
  searchJamendoTracks: jest.fn().mockResolvedValue({ ok: true, tracks: [] }),
}));

const prisma = require('../src/lib/prisma').default;
const { cache } = require('../src/lib/redis');
const searchJamendoTracksMock = searchJamendoTracks as jest.Mock;

function mkSong(id: string, title: string, artist: string, album: string | null = null, hotScore = 0) {
  return { id, title, artist, album, hotScore, playable: true, archived: false };
}

describe('搜索升级（2026-11-20）', () => {
  let svc: EnhancedSearchService;
  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    searchJamendoTracksMock.mockResolvedValue({ ok: true, tracks: [] });
    svc = new EnhancedSearchService();
  });

  describe('离线/本地：关键词匹配', () => {
    it('大小写不敏感：小写歌手名能命中库里首字母大写的歌手（mode insensitive 下推 SQL）', async () => {
      prisma.song.count.mockResolvedValue(2);
      prisma.song.findMany.mockResolvedValue([
        mkSong('1', 'Yellow', 'Coldplay'),
        mkSong('2', 'Fix You', 'Coldplay', 'X&Y'),
      ]);

      const r = await svc.searchSongs({ q: 'coldplay', scope: 'local' } as any);

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { artist: { contains: 'coldplay', mode: 'insensitive' } },
          { title: { contains: 'coldplay', mode: 'insensitive' } },
          { album: { contains: 'coldplay', mode: 'insensitive' } },
        ])
      );
      expect(r.results).toHaveLength(2);
      // 歌手精确命中的歌曲应排最前（两首同分，按热度/顺序稳定即可）
      expect(r.results.every((s: any) => s.artist === 'Coldplay')).toBe(true);
    });

    it('多词分词："歌手 歌名"组合词按 词内 OR / 词间 AND 构建，不再整串 contains', async () => {
      prisma.song.count.mockResolvedValue(1);
      prisma.song.findMany.mockResolvedValue([mkSong('1', '晴天', '周杰伦')]);

      await svc.searchSongs({ q: '周杰伦 晴天', scope: 'local' } as any);

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where.AND).toHaveLength(2);
      expect(where.AND[0]).toEqual({
        OR: expect.arrayContaining([{ artist: { contains: '周杰伦', mode: 'insensitive' } }]),
      });
      expect(where.AND[1]).toEqual({
        OR: expect.arrayContaining([{ title: { contains: '晴天', mode: 'insensitive' } }]),
      });
    });

    it('特殊字符与全角归一：全角字母/全角空格规范化为半角后参与匹配，% _ 作为字面量传递', async () => {
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany.mockResolvedValue([]);

      await svc.searchSongs({ q: 'ＡＢ　％１００', scope: 'local' } as any); // 全角 AB + 全角空格 + %100

      const where = prisma.song.findMany.mock.calls[0][0].where;
      // NFKC 归一后分为两个 token：'AB' 与 '%100'
      expect(where.AND).toHaveLength(2);
      expect(JSON.stringify(where.AND[0])).toContain('AB');
      expect(JSON.stringify(where.AND[1])).toContain('%100');
    });

    it('空结果不抛错：本地+线上都无结果时返回空列表', async () => {
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany.mockResolvedValue([]);
      searchJamendoTracksMock.mockResolvedValue({ ok: true, tracks: [] });

      const r = await svc.searchSongs({ q: 'zzzz不存在的关键词', scope: 'all' } as any);

      expect(r.results).toEqual([]);
      expect(r.pagination.total).toBe(0);
      expect(r.online?.items).toEqual([]);
    });

    it('纯空白查询：不做关键词过滤、不触发线上搜索', async () => {
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany.mockResolvedValue([]);

      const r = await svc.searchSongs({ q: '   ', scope: 'all' } as any);

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where.AND).toBeUndefined();
      expect(r.results).toEqual([]);
      expect(searchJamendoTracksMock).not.toHaveBeenCalled();
    });
  });

  describe('离线/本地：拼音与歌手关联', () => {
    it('拼音捞回：主查询为空时用全库 matchPinyin 二次过滤，拼音搜中文歌手可命中', async () => {
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany
        .mockResolvedValueOnce([]) // 主查询：SQL contains 对中文歌手无拼音命中
        .mockResolvedValueOnce([
          mkSong('9', '七里香', '周杰伦'),
          mkSong('10', '晴天', '周杰伦'),
          mkSong('11', 'Yellow', 'Coldplay'),
        ]); // 捞回池

      const r = await svc.searchSongs({ q: 'zhoujielun', scope: 'local' } as any);

      expect(prisma.song.findMany).toHaveBeenCalledTimes(2);
      const ids = r.results.map((s: any) => s.id);
      expect(ids).toContain('9');
      expect(ids).toContain('10');
      expect(ids).not.toContain('11'); // Coldplay 不应被拼音捞回
    });

    it('重名歌手：同名歌手全部歌曲保留并聚合为一条歌手统计', async () => {
      const songs = [
        mkSong('1', '歌A', '李娜'),
        mkSong('2', '歌B', '李娜'),
        mkSong('3', '歌C', '李娜'),
      ];
      prisma.song.count.mockResolvedValue(3);
      prisma.song.findMany.mockResolvedValue(songs);

      const r = await svc.searchSongs({ q: '李娜', scope: 'local' } as any);

      expect(r.results).toHaveLength(3);
      expect(r.searchInfo?.artists).toEqual([{ artist: '李娜', count: 3 }]);
    });

    it('歌手聚合：不同歌手按命中歌曲数降序排列', async () => {
      const songs = [
        mkSong('1', 'A1', '周杰伦'),
        mkSong('2', 'A2', '周杰伦'),
        mkSong('3', 'B1', '林俊杰'),
      ];
      prisma.song.count.mockResolvedValue(3);
      prisma.song.findMany.mockResolvedValue(songs);

      const r = await svc.searchSongs({ q: '音乐', scope: 'local' } as any);

      const artists = r.searchInfo?.artists || [];
      expect(artists[0]).toEqual({ artist: '周杰伦', count: 2 });
      expect(artists.map((a: any) => a.artist)).toContain('林俊杰');
    });
  });

  describe('离线/本地：分页与排序一致性', () => {
    it('分页修复：第 2 页从窗口第 21 条开始，与第 1 页无重叠（旧实现会重复）', async () => {
      prisma.song.count.mockResolvedValue(25);
      const songs = Array.from({ length: 25 }, (_, i) => mkSong(String(i + 1), `Song ${i + 1}`, 'A', null, i));
      prisma.song.findMany.mockResolvedValue(songs);

      const p1 = await svc.searchSongs({ q: 'Song', page: 1, limit: 20, scope: 'local' } as any);
      const p2 = await svc.searchSongs({ q: 'Song', page: 2, limit: 20, scope: 'local' } as any);

      expect(p1.results).toHaveLength(20);
      expect(p2.results).toHaveLength(5);
      const ids1 = new Set(p1.results.map((s: any) => s.id));
      for (const s of p2.results) {
        expect(ids1.has(s.id)).toBe(false); // 无重叠
      }
      expect(p2.pagination.total_pages).toBe(2);
    });

    it('相关结果排序：标题精确命中排在包含命中之前', async () => {
      prisma.song.count.mockResolvedValue(2);
      prisma.song.findMany.mockResolvedValue([
        mkSong('1', 'My Love Song', 'B'),
        mkSong('2', 'love', 'A'),
      ]);

      const r = await svc.searchSongs({ q: 'love', scope: 'local' } as any);

      expect(r.results[0].title).toBe('love'); // 精确命中在前
    });
  });

  describe('在线：Jamendo 线上搜索', () => {
    it('歌手名搜索：线上请求不再带 groupby:artist_id（每位歌手可返回多首歌曲）', async () => {
      await searchOnline('coldplay');
      expect(searchJamendoTracksMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'coldplay', groupby: false })
      );
    });

    it('线上分页（加载更多）：offset 透传 Jamendo，不同 offset 缓存隔离且满页 hasMore=true', async () => {
      searchJamendoTracksMock.mockResolvedValue({
        ok: true,
        tracks: Array.from({ length: 10 }, (_, i) => ({
          id: `p${i}`, name: `Track ${i}`, artist_name: 'A', audio: `http://s/${i}`, duration: 60,
        })),
      });

      const page2 = await searchOnline('coldplay', 'all', 10);

      expect(searchJamendoTracksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'coldplay', groupby: false, offset: 10 })
      );
      expect(page2.items).toHaveLength(10);
      expect(page2.hasMore).toBe(true); // 满页 → 可能还有更多

      // 同 offset 再次请求走缓存（Jamendo 不再被调用），hasMore 保持
      searchJamendoTracksMock.mockClear();
      const cached = await searchOnline('coldplay', 'all', 10);
      expect(searchJamendoTracksMock).not.toHaveBeenCalled();
      expect(cached.items).toHaveLength(10);
      expect(cached.hasMore).toBe(true);
    });

    it('线上分页：不满页 hasMore=false（线上结果耗尽）', async () => {
      searchJamendoTracksMock.mockResolvedValue({
        ok: true,
        tracks: [{ id: 'x1', name: 'Last', artist_name: 'A', audio: 'http://s/x', duration: 60 }],
      });

      const r = await searchOnline('exhausted-query', 'all', 0);

      expect(r.items).toHaveLength(1);
      expect(r.hasMore).toBe(false);
    });

    it('在线条目重排：标题精确命中的线上结果排前，无播放链接的条目被过滤', async () => {
      searchJamendoTracksMock.mockResolvedValue({
        ok: true,
        tracks: [
          { id: 'a1', name: 'Some Jazz Song', artist_name: 'B', audio: 'http://s/1', duration: 100 },
          { id: 'a2', name: 'jazz', artist_name: 'A', audio: 'http://s/2', duration: 100 },
          { id: 'a3', name: 'No Audio', artist_name: 'C' }, // 无 audio/audiodownload → 过滤
        ],
      });
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany.mockResolvedValue([]);

      const r = await svc.searchSongs({ q: 'jazz', scope: 'all' } as any);

      expect(r.online?.items).toHaveLength(2);
      expect(r.online?.items[0].title).toBe('jazz');
      expect(r.online?.items.every((t: any) => t.audioUrl)).toBe(true);
      expect(r.searchInfo?.sources).toMatchObject({ online: 2, onlineAvailable: true });
    });

    it('scope=local：完全不触网', async () => {
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany.mockResolvedValue([]);

      const r = await svc.searchSongs({ q: 'jazz', scope: 'local' } as any);

      expect(searchJamendoTracksMock).not.toHaveBeenCalled();
      expect(r.online).toBeUndefined();
    });
  });

  describe('不可播放歌曲可见化（2026-11-20）', () => {
    it('关键词搜索不再硬过滤 playable=false：网易云未分发音频的歌曲也应被搜到', async () => {
      // 华晨宇《烟火里的尘埃》：部署包内 playable=false（音频不随包分发）
      const dbRow = { ...mkSong('1', '烟火里的尘埃', '华晨宇'), playable: false };
      prisma.song.count.mockResolvedValue(1);
      // 主查询与拼音捞回池均返回该行（mock 对所有 findMany 调用生效）
      prisma.song.findMany.mockResolvedValue([dbRow]);

      const r = await svc.searchSongs({ q: '华晨宇', scope: 'local' } as any);

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.playable).toBeUndefined(); // 不再硬过滤 playable
      expect(where.archived).toBe(false);
      expect(r.results).toHaveLength(1);
      expect(r.results[0].title).toBe('烟火里的尘埃');
      expect(r.searchInfo?.unplayableCount).toBe(1);
    });

    it('可播放歌曲排序优先于不可播放歌曲', async () => {
      prisma.song.count.mockResolvedValue(2);
      prisma.song.findMany.mockResolvedValue([
        { ...mkSong('1', '好想爱这个世界啊', '华晨宇'), playable: false },
        { ...mkSong('2', '异类', '华晨宇'), playable: true },
      ]);

      const r = await svc.searchSongs({ q: '华晨宇', scope: 'local' } as any);

      // 两首都是歌手精确命中同分，可播放(+30)应排在前面
      expect(r.results[0].title).toBe('异类');
      expect(r.results[1].title).toBe('好想爱这个世界啊');
    });

    it('无关键词的浏览场景维持只看可播放歌曲（playable: true）', async () => {
      prisma.song.count.mockResolvedValue(0);
      prisma.song.findMany.mockResolvedValue([]);

      await svc.searchSongs({ scope: 'local' } as any);

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.playable).toBe(true);
    });

    it('搜索建议包含不可播放歌曲并携带 playable 标记', async () => {
      prisma.song.findMany.mockResolvedValue([
        { id: '1', title: '烟火里的尘埃', artist: '华晨宇', album: null, playable: false },
      ]);
      prisma.song.groupBy.mockResolvedValue([{ artist: '华晨宇', _count: 12 }]);

      const s = await new SearchService().getSuggestions('华晨宇');

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.playable).toBeUndefined(); // 建议也不过滤 playable
      const songEntry = s.find((x: any) => x.type === 'song');
      expect(songEntry).toEqual(expect.objectContaining({ title: '烟火里的尘埃', playable: false }));
    });
  });

  describe('搜索建议：歌手聚合入口', () => {
    it('命中歌手名时建议首位为歌手条目（type=artist，count 为歌曲数），歌曲条目在后', async () => {
      prisma.song.groupBy.mockResolvedValue([{ artist: '周杰伦', _count: 8 }]);
      prisma.song.findMany.mockResolvedValue([mkSong('1', '晴天', '周杰伦')]);

      const s = await new SearchService().getSuggestions('周杰伦');

      expect(s[0]).toEqual(expect.objectContaining({ type: 'artist', artist: '周杰伦', count: 8 }));
      expect(s[1]).toEqual(expect.objectContaining({ type: 'song', title: '晴天' }));
    });

    it('大小写不敏感：小写英文歌手名建议也能命中', async () => {
      prisma.song.findMany.mockResolvedValue([]);
      prisma.song.groupBy.mockResolvedValue([{ artist: 'Coldplay', _count: 3 }]);

      const s = await new SearchService().getSuggestions('coldplay');

      const where = prisma.song.findMany.mock.calls[0][0].where;
      expect(where.OR[0].title.mode).toBe('insensitive');
      expect(s[0].type).toBe('artist');
    });
  });
});
