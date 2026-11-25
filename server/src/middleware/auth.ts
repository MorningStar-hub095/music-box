import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import prisma from '../lib/prisma';

export interface AuthRequest {
  headers: {
    authorization?: string;
  };
  user?: {
    id: number;
    username: string;
    role: string;
    status: string;
  };
  [key: string]: any;
}

export interface AuthResponse {
  status(code: number): AuthResponse;
  json(data: any): void;
}

export type NextFunction = () => void;

export const authenticate = async (req: AuthRequest, res: AuthResponse, next: NextFunction) => {
  try {
    // 共享 API Key 回退：桌面端 HttpClient 无 JWT，用 X-Api-Key 鉴权并注入桌面用户
    const apiKey = (req.headers as any)['x-api-key'];
    if (apiKey && typeof apiKey === 'string' && config.desktopApiKey) {
      // 常量时间比较，防止时序侧信道逐字节猜解 API Key
      const apiKeyBuf = Buffer.from(apiKey, 'utf8');
      const expectedBuf = Buffer.from(config.desktopApiKey, 'utf8');
      const keyValid =
        apiKeyBuf.length === expectedBuf.length && crypto.timingSafeEqual(apiKeyBuf, expectedBuf);
      if (!keyValid) {
        return res.status(401).json({ success: false, error: '无效的 API Key' });
      }
      // 确保桌面用户存在
      let desktopUser = await prisma.user.findFirst({
        where: { username: 'desktop' },
        select: { id: true, username: true, role: true, status: true },
      });

      if (!desktopUser) {
        desktopUser = await prisma.user.create({
          data: {
            username: 'desktop',
            email: 'desktop@musicbox.local',
            passwordHash: 'api-key-auth-no-password',
            securityQuestion: 'auto',
            securityAnswer: 'auto',
            status: 'active',
            role: 'user',
          },
          select: { id: true, username: true, role: true, status: true },
        });
      }

      req.user = desktopUser;
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: '未提供认证令牌' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as { userId: number };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, username: true, role: true, status: true }
    });

    if (!user) {
      return res.status(401).json({ success: false, error: '用户不存在' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: '用户账号已被禁用或待审批' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ success: false, error: '无效的认证令牌' });
    }
    return res.status(500).json({ success: false, error: '认证服务异常' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: AuthResponse, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: '权限不足' });
    }

    next();
  };
};
