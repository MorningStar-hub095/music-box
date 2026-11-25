import prisma from '../../lib/prisma';
import badwordsData from './badwords.json';

// === 敏感词过滤 ===

const BADWORDS: string[] = badwordsData.keywords;
const BADWORD_PATTERNS: RegExp[] = badwordsData.regexPatterns.map(p => new RegExp(p, 'i'));

function checkContent(content: string): { ok: boolean; reason?: string } {
  const lower = content.toLowerCase();
  for (const word of BADWORDS) {
    if (lower.includes(word.toLowerCase())) {
      return { ok: false, reason: '评论包含敏感词，请修改后重试' };
    }
  }
  for (const pattern of BADWORD_PATTERNS) {
    if (pattern.test(content)) {
      return { ok: false, reason: '评论包含敏感词，请修改后重试' };
    }
  }
  if (content.trim().length === 0) {
    return { ok: false, reason: '评论内容不能为空' };
  }
  if (content.length > 500) {
    return { ok: false, reason: '评论内容不能超过500字' };
  }
  return { ok: true };
}

// === 热度分数计算 ===

function calcHotScore(likeCount: number, reportCount: number, createdAt: Date): number {
  const hoursElapsed = (Date.now() - createdAt.getTime()) / 3600000;
  const freshnessBonus = Math.max(0, 48 - hoursElapsed) * 0.5;
  return likeCount * 3 - reportCount * 5 + freshnessBonus;
}

// === 评论 CRUD ===

export async function createComment(
  userId: number,
  songId: string,
  commentType: 'song' | 'lyric',
  content: string,
  timestampSec?: number
) {
  const check = checkContent(content);
  if (!check.ok) return { error: check.reason };

  const comment = await prisma.comment.create({
    data: {
      userId,
      songId,
      commentType,
      timestampSec: commentType === 'lyric' ? timestampSec ?? null : null,
      content: content.trim(),
    },
    include: { user: { select: { id: true, username: true } } },
  });

  // 更新歌曲评论计数
  await prisma.song.update({
    where: { id: songId },
    data: { commentCount: { increment: 1 } },
  });

  return { comment };
}

export async function getSongComments(
  songId: string,
  sort: 'hot' | 'time' = 'hot',
  page: number = 1,
  pageSize: number = 20
) {
  const skip = (page - 1) * pageSize;
  const where = { songId, commentType: 'song', status: 'active' };
  const total = await prisma.comment.count({ where });

  // 热度排序：需要在“全局”按热度分数排序后再分页，
  // 否则只会在当前页内重排，导致最热评论被分页边界截断
  if (sort === 'hot') {
    const all = await prisma.comment.findMany({
      where,
      include: { user: { select: { id: true, username: true } } },
    });
    const sorted = all.sort(
      (a, b) =>
        calcHotScore(b.likeCount, b.reportCount, b.createdAt) -
        calcHotScore(a.likeCount, a.reportCount, a.createdAt)
    );
    return { comments: sorted.slice(skip, skip + pageSize), total, page, pageSize };
  }

  const comments = await prisma.comment.findMany({
    where,
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    skip,
    take: pageSize,
  });

  return { comments, total, page, pageSize };
}

export async function getLyricComments(songId: string) {
  const comments = await prisma.comment.findMany({
    where: { songId, commentType: 'lyric', status: 'active' },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { timestampSec: 'asc' },
  });

  const grouped: Record<number, typeof comments> = {};
  for (const c of comments) {
    const key = c.timestampSec ?? 0;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  return { comments, grouped };
}

export async function deleteComment(commentId: bigint, userId: number, isAdmin: boolean) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) return { error: '评论不存在' };
  if (!isAdmin && comment.userId !== userId) return { error: '无权删除此评论' };

  await prisma.comment.update({
    where: { id: commentId },
    data: { status: 'deleted' },
  });

  await prisma.song.update({
    where: { id: comment.songId },
    data: { commentCount: { decrement: 1 } },
  });

  return { success: true };
}

// === 点赞 ===

export async function toggleLike(commentId: bigint, userId: number) {
  const existing = await prisma.commentLike.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });

  if (existing) {
    await prisma.commentLike.delete({ where: { id: existing.id } });
    await prisma.comment.update({
      where: { id: commentId },
      data: { likeCount: { decrement: 1 } },
    });
    return { liked: false };
  } else {
    await prisma.commentLike.create({ data: { userId, commentId } });
    await prisma.comment.update({
      where: { id: commentId },
      data: { likeCount: { increment: 1 } },
    });
    return { liked: true };
  }
}

export async function isLiked(commentId: bigint, userId: number) {
  const existing = await prisma.commentLike.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });
  return { liked: !!existing };
}

// === 举报 ===

export async function reportComment(commentId: bigint, userId: number, reason: string) {
  const existing = await prisma.commentReport.findUnique({
    where: { userId_commentId: { userId, commentId } },
  });
  if (existing) return { error: '您已举报过此评论' };

  await prisma.commentReport.create({ data: { userId, commentId, reason } });
  await prisma.comment.update({
    where: { id: commentId },
    data: { reportCount: { increment: 1 } },
  });

  // 自动隐藏：举报数 >= 5 时隐藏评论
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (comment && comment.reportCount >= 5) {
    await prisma.comment.update({
      where: { id: commentId },
      data: { status: 'hidden' },
    });
  }

  return { success: true };
}

// === 管理接口 ===

export async function getReports(page: number = 1, pageSize: number = 20) {
  const skip = (page - 1) * pageSize;
  const [reports, total] = await Promise.all([
    prisma.commentReport.findMany({
      where: { status: 'pending' },
      include: {
        user: { select: { id: true, username: true } },
        comment: { include: { user: { select: { id: true, username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.commentReport.count({ where: { status: 'pending' } }),
  ]);
  return { reports, total, page, pageSize };
}

export async function updateCommentStatus(commentId: bigint, status: 'active' | 'hidden') {
  await prisma.comment.update({ where: { id: commentId }, data: { status } });
  return { success: true };
}
