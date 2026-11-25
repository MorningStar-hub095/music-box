import { RadioStreamService } from '../src/modules/radio/radio-stream.service';

// mock 个性化推荐引擎，避免真实画像/融合计算
jest.mock('../src/modules/recommendation/recommendation.service', () => ({
  RecommendationService: jest.fn(),
}));

const { RecommendationService } = require('../src/modules/recommendation/recommendation.service');

describe('RadioStreamService.fallbackSongs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('个性化推荐为空时回退热门，返回指定数量且无重复、结构精简', async () => {
    RecommendationService.mockImplementation(() => ({
      generateForUser: jest.fn().mockResolvedValue([]),
    }));

    const prisma: any = {
      song: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'h1', title: 'H1', artist: 'A', duration: 100, hotScore: 50 },
          { id: 'h2', title: 'H2', artist: 'A', duration: 100, hotScore: 40 },
          { id: 'h3', title: 'H3', artist: 'A', duration: 100, hotScore: 30 },
          { id: 'h4', title: 'H4', artist: 'A', duration: 100, hotScore: 20 },
        ]),
      },
    };
    const svc = new RadioStreamService(prisma);
    const state: any = { userId: 1, playedSongIds: new Set(), playedTitles: [] };

    const songs = await (svc as any).fallbackSongs(state, 3);
    expect(songs).toHaveLength(3);
    expect(new Set(songs.map((s: any) => s.id)).size).toBe(3);
    // 返回结构精简，不含内部字段 hotScore
    expect(songs[0]).not.toHaveProperty('hotScore');
    expect(songs[0]).toEqual(expect.objectContaining({ id: expect.any(String), title: expect.any(String), artist: expect.any(String) }));
  });

  it('个性化推荐失败时降级热门，不抛错', async () => {
    RecommendationService.mockImplementation(() => ({
      generateForUser: jest.fn().mockRejectedValue(new Error('boom')),
    }));

    const prisma: any = {
      song: {
        findMany: jest.fn().mockResolvedValue([{ id: 'h1', title: 'H1', artist: 'A', duration: 100, hotScore: 50 }]),
      },
    };
    const svc = new RadioStreamService(prisma);
    const state: any = { userId: 1, playedSongIds: new Set(), playedTitles: [] };

    const songs = await (svc as any).fallbackSongs(state, 1);
    expect(songs).toHaveLength(1);
    expect(songs[0].id).toBe('h1');
  });
});
