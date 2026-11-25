﻿﻿﻿﻿﻿﻿/**
 * Radio Controller - 个人电台控制器
 */

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest, authenticate, authorize } from '../../middleware/auth';
import { RadioService } from './radio.service';
import { RadioStreamService, getExplorationRatio, setExplorationRatio } from './radio-stream.service';
import { getLlmConfigView, saveLlmConfig } from './llm-config';

export function createRadioController(prisma: PrismaClient) {
  const router = Router();
  const service = new RadioService(prisma);
  const streamService = new RadioStreamService(prisma);

  // 检查 LLM 配置状态（无需认证）
  router.get('/status', async (_req: AuthRequest, res: Response) => {
    try {
      const { checkLLMReachable } = await import('../../lib/llm-health');
      const reachable = service.isConfigured() ? await checkLLMReachable() : false;
      res.json({ success: true, data: { configured: service.isConfigured(), reachable } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to check status' });
    }
  });

  // 获取 LLM API 配置（脱敏）
  router.get('/llm-config', authenticate, async (_req: AuthRequest, res: Response) => {
    try {
      res.json({ success: true, data: getLlmConfigView() });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get LLM config' });
    }
  });

  // 保存 LLM API 配置（仅管理员：会改写服务器 .env，属全局敏感操作）
  router.put('/llm-config', authenticate, authorize('super_admin', 'admin'), async (req: AuthRequest, res: Response) => {
    try {
      const { provider, apiKey, model, baseUrl, temperature, timeout } = req.body;
      if (!provider) {
        res.status(400).json({ success: false, error: 'provider is required' });
        return;
      }
      const data = saveLlmConfig({ provider, apiKey, model, baseUrl, temperature, timeout });
      res.json({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save LLM config';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 创建新会话
  router.post('/sessions', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const session = await service.createSession(req.user!.id);
      res.json({ success: true, data: session });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to create session' });
    }
  });

  // 获取会话列表
  router.get('/sessions', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessions = await service.getSessions(req.user!.id);
      res.json({ success: true, data: sessions });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get sessions' });
    }
  });

  // 获取会话消息
  router.get('/sessions/:sessionId/messages', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const messages = await service.getSessionMessages(req.user!.id, sessionId);
      res.json({ success: true, data: messages });
    } catch (err) {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  });

  // 发送消息
  router.post('/sessions/:sessionId/messages', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { content } = req.body;
      if (!content) {
        res.status(400).json({ success: false, error: 'Content is required' });
        return;
      }
      const result = await service.sendMessage(req.user!.id, sessionId, content);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 一键电台
  router.post('/quick', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const result = await service.quickRecommend(req.user!.id);
      res.json({ success: true, data: result });
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      const message = err instanceof Error ? err.message : 'Failed to generate recommendation';
      res.status(statusCode || 500).json({ success: false, error: message });
    }
  });

  // 删除会话
  router.delete('/sessions/:sessionId', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const result = await service.deleteSession(req.user!.id, sessionId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  });

  // 获取用户偏好记忆
  router.get('/preferences', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const preferences = await service.getPreferences(req.user!.id);
      res.json({ success: true, data: preferences });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get preferences' });
    }
  });

  // ── 全自动 AI 电台（无限连播）──

  // 预热：后台开始为当前用户预生成歌单（前端登录后调用，不阻塞）
  router.post('/stream/warmup', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const result = await streamService.warmup(req.user!.id);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to warmup';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 启动自动电台：返回已就绪的 LLM 歌单（秒开），后台持续生成
  router.post('/stream/start', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const result = await streamService.start(req.user!.id);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start auto radio';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 获取下一批歌单（无限连播预取）
  router.get('/stream/:sessionId/next', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const result = await streamService.next(req.user!.id, sessionId);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get next songs';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 换一批（手动刷新）：LLM 生成全新一批（避免重复）
  router.post('/stream/:sessionId/refresh', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const result = await streamService.refresh(req.user!.id, sessionId);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh playlist';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 播放反馈（跳过/完成）
  router.post('/stream/:sessionId/feedback', authenticate, async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const { songId } = req.body;
      if (!songId) {
        res.status(400).json({ success: false, error: 'songId is required' });
        return;
      }
      const result = await streamService.feedback(req.user!.id, sessionId, songId);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record feedback';
      res.status(500).json({ success: false, error: message });
    }
  });

  // 获取电台探索比例（0~1，个性化 vs 探索）
  router.get('/exploration-ratio', authenticate, async (_req: AuthRequest, res: Response) => {
    res.json({ success: true, data: { explorationRatio: getExplorationRatio() } });
  });

  // 更新电台探索比例（运行时生效，无需重启）
  router.put('/exploration-ratio', authenticate, async (req: AuthRequest, res: Response) => {
    const { explorationRatio } = req.body || {};
    if (typeof explorationRatio !== 'number') {
      res.status(400).json({ success: false, error: 'explorationRatio must be a number' });
      return;
    }
    const value = setExplorationRatio(explorationRatio);
    res.json({ success: true, data: { explorationRatio: value } });
  });

  return router;
}
