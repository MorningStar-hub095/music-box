import { createComment, getSongComments, deleteComment, toggleLike, reportComment } from '../src/modules/comments/comments.service';

// mock prisma，隔离数据库
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    comment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    song: { update: jest.fn().mockResolvedValue({}) },
    commentLike: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    commentReport: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

const prisma = require('../src/lib/prisma').default;

describe('comments.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createComment 内容校验', () => {
    it('空内容 / 纯空白 → 拒绝', async () => {
      expect((await createComment(1, 's1', 'song', '   ')).error).toBeDefined();
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it('超过 500 字 → 拒绝', async () => {
      expect((await createComment(1, 's1', 'song', '好'.repeat(501))).error).toMatch(/500/);
    });

    it('包含敏感词 → 拒绝且不落库', async () => {
      const r = await createComment(1, 's1', 'song', '这首歌真是傻逼');
      expect(r.error).toBeDefined();
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it('song 类型评论忽略 timestampSec 并递增歌曲评论数', async () => {
      prisma.comment.create.mockResolvedValueOnce({ id: 1n });
      const r = await createComment(1, 's1', 'song', '好听', 42);
      expect(r.comment).toBeTruthy();
      expect(prisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ timestampSec: null, content: '好听' }) })
      );
      expect(prisma.song.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { commentCount: { increment: 1 } } })
      );
    });

    it('lyric 类型保留时间戳', async () => {
      prisma.comment.create.mockResolvedValueOnce({ id: 2n });
      await createComment(1, 's1', 'lyric', '这句绝了', 88);
      expect(prisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ commentType: 'lyric', timestampSec: 88 }) })
      );
    });
  });

  describe('deleteComment 权限', () => {
    it('评论不存在 → error', async () => {
      prisma.comment.findUnique.mockResolvedValueOnce(null);
      expect((await deleteComment(999n, 1, false)).error).toBeDefined();
    });

    it('非本人且非管理员 → 无权删除', async () => {
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 1n, userId: 2, songId: 's1' });
      expect((await deleteComment(1n, 1, false)).error).toMatch(/无权/);
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });

    it('本人删除 → 软删除并递减评论数', async () => {
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 1n, userId: 1, songId: 's1' });
      expect((await deleteComment(1n, 1, false)).success).toBe(true);
      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'deleted' } })
      );
      expect(prisma.song.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { commentCount: { decrement: 1 } } })
      );
    });

    it('管理员可删他人评论', async () => {
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 1n, userId: 2, songId: 's1' });
      expect((await deleteComment(1n, 1, true)).success).toBe(true);
    });
  });

  describe('toggleLike 点赞切换', () => {
    it('未点赞 → 点赞并递增', async () => {
      prisma.commentLike.findUnique.mockResolvedValueOnce(null);
      expect((await toggleLike(1n, 1)).liked).toBe(true);
      expect(prisma.commentLike.create).toHaveBeenCalled();
      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { likeCount: { increment: 1 } } })
      );
    });

    it('已点赞 → 取消并递减', async () => {
      prisma.commentLike.findUnique.mockResolvedValueOnce({ id: 9n });
      expect((await toggleLike(1n, 1)).liked).toBe(false);
      expect(prisma.commentLike.delete).toHaveBeenCalled();
      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { likeCount: { decrement: 1 } } })
      );
    });
  });

  describe('reportComment 举报', () => {
    it('重复举报 → 拒绝', async () => {
      prisma.commentReport.findUnique.mockResolvedValueOnce({ id: 1n });
      expect((await reportComment(1n, 1, 'spam')).error).toBeDefined();
    });

    it('举报数达到 5 → 自动隐藏', async () => {
      prisma.commentReport.findUnique.mockResolvedValueOnce(null);
      // 递增后服务重新读取评论，reportCount >= 5 触发隐藏
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 1n, reportCount: 5 });
      expect((await reportComment(1n, 1, 'spam')).success).toBe(true);
      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'hidden' } })
      );
    });

    it('举报数不足 5 → 不隐藏', async () => {
      prisma.commentReport.findUnique.mockResolvedValueOnce(null);
      prisma.comment.findUnique.mockResolvedValueOnce({ id: 1n, reportCount: 4 });
      expect((await reportComment(1n, 1, 'spam')).success).toBe(true);
      const updates = prisma.comment.update.mock.calls.map((c: any[]) => c[0].data);
      expect(updates.some((d: any) => d.status === 'hidden')).toBe(false);
    });
  });

  describe('getSongComments 分页', () => {
    it('按时间排序时应用 skip/take', async () => {
      await getSongComments('s1', 'time', 3, 10);
      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10, orderBy: { createdAt: 'desc' } })
      );
    });

    it('按热度排序时全局排序后内存分页', async () => {
      const now = Date.now();
      prisma.comment.findMany.mockResolvedValueOnce([
        { id: 1n, likeCount: 0, reportCount: 0, createdAt: new Date(now - 100000) },
        { id: 2n, likeCount: 10, reportCount: 0, createdAt: new Date(now) },
      ]);
      const r = await getSongComments('s1', 'hot', 1, 1);
      expect(r.comments).toHaveLength(1);
      expect(r.comments[0].id).toBe(2n); // 点赞多的排前面
      expect(r.total).toBe(0); // 来自 count mock
    });
  });
});
