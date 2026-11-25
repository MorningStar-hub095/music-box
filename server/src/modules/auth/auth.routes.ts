import { Router, Request, Response, NextFunction } from 'express';
import { AuthController } from './auth.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { createRateLimit } from '../../middleware/rateLimit';
import { sanitizeInput } from '../../middleware/sanitize';

const router = Router();
const authController = new AuthController();

router.use(sanitizeInput);

// 速率限制实例
const guestLimiter = createRateLimit(15 * 60 * 1000, 10, '访客登录请求过于频繁，请15分钟后再试');
const loginLimiter = createRateLimit(15 * 60 * 1000, 10, '登录请求过于频繁，请15分钟后再试');
const registerLimiter = createRateLimit(15 * 60 * 1000, 5, '注册请求过于频繁，请15分钟后再试');
const resetRequestLimiter = createRateLimit(15 * 60 * 1000, 5, '密码重置请求过于频繁，请15分钟后再试');
const resetLimiter = createRateLimit(15 * 60 * 1000, 5, '密码重置操作过于频繁，请15分钟后再试');

const validateRegister = (req: Request, res: Response, next: NextFunction) => {
  const { username, email, password, securityQuestion, securityAnswer } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32) {
    return res.status(400).json({ success: false, error: '用户名长度必须在3-32个字符之间' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ success: false, error: '密码长度至少为6个字符' });
  }
  if (!email || !securityQuestion || !securityAnswer) {
    return res.status(400).json({ success: false, error: '请提供完整的注册信息' });
  }
  next();
};

const validateLogin = (req: Request, res: Response, next: NextFunction) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32) {
    return res.status(400).json({ success: false, error: '用户名或密码错误' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ success: false, error: '用户名或密码错误' });
  }
  next();
};

router.post('/register', registerLimiter, validateRegister, (req, res) => authController.register(req, res));

router.post('/login', loginLimiter, validateLogin, (req, res) => authController.login(req, res));

router.get('/me', authenticate, (req, res) => authController.getCurrentUser(req, res));

router.post('/password-reset-request', resetRequestLimiter, (req, res) => authController.requestPasswordReset(req, res));

router.post('/password-reset', resetLimiter, (req, res) => authController.resetPassword(req, res));

router.post('/approve/:id', authenticate, authorize('super_admin', 'admin'), (req, res) => authController.approveUser(req, res));

router.get('/pending-users', authenticate, authorize('super_admin', 'admin'), (req, res) => authController.getPendingUsers(req, res));

router.post('/guest', guestLimiter, (req, res) => authController.guestLogin(req, res));

router.post('/change-password', authenticate, (req, res) => authController.changePassword(req, res));

router.put('/profile', authenticate, (req, res) => authController.updateProfile(req, res));

export default router;
