import { AuthRequest, AuthResponse } from '../../middleware/auth';
import { AuthService } from './auth.service';

const authService = new AuthService();

/** 数据库不可达等底层错误转换为用户可读提示（避免泄露 Prisma 堆栈/连接串） */
function friendlyAuthError(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : '';
  if (/Can't reach database server|P1001|connect ECONNREFUSED/i.test(msg)) {
    return '数据库服务未启动或不可达，请启动数据库后重试';
  }
  return msg || fallback;
}

export class AuthController {
  async register(req: AuthRequest, res: AuthResponse) {
    try {
      const { username, email, password, securityQuestion, securityAnswer } = req.body;

      if (!username || !email || !password || !securityQuestion || !securityAnswer) {
        return res.status(400).json({
          success: false,
          error: '请提供完整的注册信息'
        });
      }

      const ip = req.ip || req.connection?.remoteAddress;
      const result = await authService.register(username, email, password, securityQuestion, securityAnswer, ip);
      return res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: friendlyAuthError(error, '注册失败')
      });
    }
  }

  async login(req: AuthRequest, res: AuthResponse) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: '请提供用户名和密码'
        });
      }

      const ip = req.ip || req.connection?.remoteAddress;
      const result = await authService.login(username, password, ip);
      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: friendlyAuthError(error, '登录失败')
      });
    }
  }

  async getCurrentUser(req: AuthRequest, res: AuthResponse) {
    try {
      const userId = req.user!.id;
      const user = await authService.getCurrentUser(userId);
      return res.json({
        success: true,
        data: user
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : '获取用户信息失败'
      });
    }
  }

  async requestPasswordReset(req: AuthRequest, res: AuthResponse) {
    try {
      const { username, securityAnswer } = req.body;

      if (!username || !securityAnswer) {
        return res.status(400).json({
          success: false,
          error: '请提供用户名和安全问题答案'
        });
      }

      const ip = req.ip || req.connection?.remoteAddress;
      const result = await authService.requestPasswordReset(username, securityAnswer, ip);
      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '验证失败'
      });
    }
  }

  async resetPassword(req: AuthRequest, res: AuthResponse) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          success: false,
          error: '请提供重置令牌和新密码'
        });
      }

      const ip = req.ip || req.connection?.remoteAddress;
      const result = await authService.resetPassword(token, newPassword, ip);
      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '密码重置失败'
      });
    }
  }

  async approveUser(req: AuthRequest, res: AuthResponse) {
    try {
      const userId = parseInt(req.params.id);
      if (isNaN(userId)) {
        return res.status(400).json({
          success: false,
          error: '无效的用户ID'
        });
      }

      const user = await authService.approveUser(userId);
      return res.json({
        success: true,
        data: user
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '审批失败'
      });
    }
  }

  async getPendingUsers(req: AuthRequest, res: AuthResponse) {
    try {
      const users = await authService.getPendingUsers();
      return res.json({
        success: true,
        data: users
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '获取待审批用户列表失败'
      });
    }
  }

  async changePassword(req: AuthRequest, res: AuthResponse) {
    try {
      const userId = req.user!.id;
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: '请提供原密码和新密码'
        });
      }

      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: '新密码长度至少为6个字符'
        });
      }

      const ip = req.ip || req.connection?.remoteAddress;
      await authService.changePassword(userId, oldPassword, newPassword, ip);
      return res.json({
        success: true,
        data: { message: '密码修改成功' }
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '密码修改失败'
      });
    }
  }

  async updateProfile(req: AuthRequest, res: AuthResponse) {
    try {
      const userId = req.user!.id;
      const { email, securityQuestion, securityAnswer } = req.body;

      if (!email && !securityQuestion && !securityAnswer) {
        return res.status(400).json({
          success: false,
          error: '请提供需要更新的信息'
        });
      }

      const user = await authService.updateProfile(userId, { email, securityQuestion, securityAnswer });
      return res.json({
        success: true,
        data: user
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '更新资料失败'
      });
    }
  }

  async guestLogin(req: AuthRequest, res: AuthResponse) {
    try {
      const result = await authService.guestLogin();
      return res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '访客登录失败'
      });
    }
  }
}
