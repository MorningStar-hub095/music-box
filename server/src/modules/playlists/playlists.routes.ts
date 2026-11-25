import { Router } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, AuthRequest, AuthResponse } from '../../middleware/auth';
import { getHot100 } from './hot100.service';
import { getCategorySongs, CATEGORY_DEFS } from './category.service';

const router = Router();

// 热门100首（公开接口，无需认证）
router.get('/hot100', async (req, res) => {
  try {
    const result = await getHot100();
    return res.json({ success: true, data: result.songs, count: result.count });
  } catch (error) {
    console.error('获取热门100首失败:', error);
    return res.status(500).json({ success: false, error: '获取热门100首失败' });
  }
});

// 分类歌单列表（公开接口）
router.get('/categories', async (req, res) => {
  const categories = [
    { id: 'hot', name: '热门推荐', description: '当前热门100首' },
    ...CATEGORY_DEFS.map(c => ({ id: c.id, name: c.name, description: c.description })),
  ];
  return res.json({ success: true, data: categories });
});

// 获取指定分类歌单（公开接口，无需认证）
router.get('/category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const result = await getCategorySongs(categoryId);
    return res.json({ success: true, data: result.songs, count: result.count });
  } catch (error) {
    console.error('获取分类歌单失败:', error);
    return res.status(500).json({ success: false, error: '获取分类歌单失败' });
  }
});

// 获取播放列表
router.get('/', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const playlists = await prisma.playlist.findMany({
      where: { userId: req.user!.id },
      include: {
        _count: { select: { songs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = playlists.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      userId: p.userId,
      songCount: p._count.songs,
      createdAt: p.createdAt,
    }));

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: '操作失败，请稍后重试',
    });
  }
});

// 获取单个播放列表
router.get('/:id', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { id } = req.params;
    const playlist = await prisma.playlist.findFirst({
      where: { id: Number(id), userId: req.user!.id },
      include: {
        songs: {
          include: {
            song: {
              select: {
                id: true,
                title: true,
                artist: true,
                album: true,
                audioUrl: true,
                playable: true,
              },
            },
          },
        },
      },
    });
    if (!playlist) {
      return res.status(404).json({ success: false, error: '播放列表不存在' });
    }
    return res.json({ success: true, data: playlist });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: '操作失败，请稍后重试',
    });
  }
});

// 创建播放列表
router.post('/', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { name, description } = req.body;
    const userId = req.user?.id;

    if (!name) {
      return res.status(400).json({ success: false, error: '请提供播放列表名称' });
    }

    const playlist = await prisma.playlist.create({
      data: {
        name,
        description,
        userId,
      },
    });
    return res.status(201).json({ success: true, data: playlist });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: '操作失败，请稍后重试',
    });
  }
});

// 更新播放列表
router.put('/:id', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const existing = await prisma.playlist.findFirst({
      where: { id: Number(id), userId: req.user!.id },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: '播放列表不存在' });
    }

    const playlist = await prisma.playlist.update({
      where: { id: Number(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
      },
    });
    return res.json({ success: true, data: playlist });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: '操作失败，请稍后重试',
    });
  }
});

// 删除播放列表
router.delete('/:id', authenticate, async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { id } = req.params;
    const existing = await prisma.playlist.findFirst({
      where: { id: Number(id), userId: req.user!.id },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: '播放列表不存在' });
    }
    await prisma.playlist.delete({ where: { id: Number(id) } });
    return res.json({ success: true, message: '播放列表已删除' });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: '操作失败，请稍后重试',
    });
  }
});

export default router;
