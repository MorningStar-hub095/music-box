import { Router } from 'express';
import prisma from '../../lib/prisma';
import { authenticate, authorize, AuthRequest, AuthResponse } from '../../middleware/auth';

const router = Router();

// 获取用户列表（仅管理员：列表含 email 等敏感字段）
router.get('/', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: users });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取用户列表失败',
    });
  }
});

// 获取单个用户（仅管理员，与列表接口保持一致）
router.get('/:id', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }
    return res.json({ success: true, data: user });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取用户详情失败',
    });
  }
});

// 更新用户
router.put('/:id', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { id } = req.params;
    const { role, status } = req.body;
    const targetId = Number(id);

    if (role && targetId === req.user!.id) {
      return res.status(403).json({ success: false, error: '不能修改自己的角色' });
    }

    if (role === 'super_admin' && req.user!.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: '无权设置超级管理员角色' });
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: {
        ...(role && { role }),
        ...(status && { status }),
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    return res.json({ success: true, data: user });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : '更新用户失败',
    });
  }
});

// 删除用户
router.delete('/:id', authenticate, authorize('super_admin'), async (req: AuthRequest, res: AuthResponse) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({ where: { id: Number(id) } });
    return res.json({ success: true, message: '用户已删除' });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : '删除用户失败',
    });
  }
});

export default router;
