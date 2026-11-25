import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../../lib/prisma';
import { config } from '../../config';

/** 写审计日志（fire-and-forget，不阻塞主流程） */
async function writeAuditLog(
  userId: number | null,
  action: string,
  details: Record<string, any>,
  ip?: string,
) {
  try {
    await prisma.operationLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress: ip ?? undefined,
      },
    });
  } catch {
    // 审计日志写入失败不应影响主业务
  }
}

/** 保留用户名：防止抢注系统身份（desktop 用于 API-Key 鉴权注入，抢注会污染身份绑定） */
const RESERVED_USERNAMES = new Set([
  'desktop',
  'admin',
  'administrator',
  'root',
  'system',
  'super_admin',
  'guest',
]);

export class AuthService {
  async register(username: string, email: string, password: string, securityQuestion: string, securityAnswer: string, ip?: string) {
    if (RESERVED_USERNAMES.has(username.toLowerCase()) || username.toLowerCase().startsWith('guest_')) {
      throw new Error('该用户名为系统保留，请更换');
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    });

    if (existingUser) {
      throw new Error(existingUser.username === username ? '用户名已存在' : '邮箱已被注册');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase(), 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        securityQuestion,
        securityAnswer: hashedAnswer,
        status: 'active',
        role: 'user'
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true
      }
    });

    const token = jwt.sign(
      { userId: user.id },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    writeAuditLog(user.id, 'REGISTER', { username, email }, ip);

    return { token, user };
  }

  async login(username: string, password: string, ip?: string) {
    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      writeAuditLog(null, 'LOGIN_FAILED', { username, reason: '用户不存在' }, ip);
      throw new Error('用户名或密码错误');
    }

    if (user.status !== 'active') {
      writeAuditLog(user.id, 'LOGIN_FAILED', { username, reason: `账号状态: ${user.status}` }, ip);
      throw new Error(user.status === 'pending' ? '账号待审批，请等待管理员审核' : '账号已被禁用');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      writeAuditLog(user.id, 'LOGIN_FAILED', { username, reason: '密码错误' }, ip);
      throw new Error('用户名或密码错误');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    const token = jwt.sign(
      { userId: user.id },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    writeAuditLog(user.id, 'LOGIN', { username }, ip);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status
      }
    };
  }

  async getCurrentUser(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true
      }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return user;
  }

  async requestPasswordReset(username: string, securityAnswer: string, ip?: string) {
    const message = '如果用户存在，重置指令已发送';

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user || !user.securityQuestion || !user.securityAnswer) {
      return { message, resetToken: null };
    }

    const isAnswerValid = await bcrypt.compare(securityAnswer.toLowerCase(), user.securityAnswer);
    if (!isAnswerValid) {
      return { message, resetToken: null };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiresAt = new Date(Date.now() + 3600000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: resetTokenHash,
        resetTokenExpiresAt
      }
    });

    writeAuditLog(user.id, 'PASSWORD_RESET_REQUEST', { username }, ip);

    return { message, resetToken };
  }

  async resetPassword(token: string, newPassword: string, ip?: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await prisma.user.findFirst({
      where: {
        resetToken: tokenHash,
        resetTokenExpiresAt: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      throw new Error('重置令牌无效或已过期');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null
      }
    });

    writeAuditLog(user.id, 'PASSWORD_RESET', { username: user.username }, ip);

    return { message: '密码重置成功' };
  }

  async approveUser(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    if (user.status !== 'pending') {
      throw new Error('该用户不在待审批状态');
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true
      }
    });

    return updatedUser;
  }

  async getPendingUsers() {
    const users = await prisma.user.findMany({
      where: { status: 'pending' },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        securityQuestion: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return users;
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('用户不存在');

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new Error('原密码错误');

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });

    writeAuditLog(userId, 'CHANGE_PASSWORD', { username: user.username }, ip);
  }

  async updateProfile(userId: number, data: { email?: string; securityQuestion?: string; securityAnswer?: string }) {
    if (data.email) {
      const existing = await prisma.user.findFirst({
        where: { email: data.email, id: { not: userId } },
      });
      if (existing) throw new Error('邮箱已被使用');
    }

    const updateData: any = { ...data };
    if (data.securityAnswer) {
      updateData.securityAnswer = await bcrypt.hash(data.securityAnswer, 10);
    }

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, username: true, email: true, role: true, status: true, createdAt: true, lastLoginAt: true },
    });
  }

  /** 自动创建访客用户（无需审批，直接激活） */
  async guestLogin() {
    // 生成唯一用户名
    const randomId = crypto.randomBytes(6).toString('hex');
    const username = `guest_${randomId}`;
    const email = `${username}@musicbox.local`;
    const password = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        securityQuestion: 'auto-generated',
        securityAnswer: 'auto-generated',
        status: 'active',
        role: 'user',
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
      }
    });

    const token = jwt.sign(
      { userId: user.id },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    return { token, user };
  }
}
