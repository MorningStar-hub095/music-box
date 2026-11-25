import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { getProvider, switchProvider, getRegisteredProviders } from '../../lib/llm-provider';

/**
 * LLM 提供商管理路由（从 index.ts 拆出，2026-10-26）
 * 挂载点：app.use('/api/llm', llmAdminRoutes)
 * 2026-11-03 安全修复：管理接口必须鉴权，仅 admin 及以上可访问
 */
const router = Router();

// LLM 提供商健康检查
router.get('/health', authenticate, authorize('super_admin', 'admin'), async (_req, res) => {
  try {
    const provider = getProvider();
    const health = await provider.healthCheck();
    res.json({
      ...health,
      registeredProviders: getRegisteredProviders(),
      currentConfig: provider.getConfig(),
    });
  } catch (err: any) {
    res.status(500).json({ healthy: false, error: err?.message });
  }
});

// LLM 提供商切换
router.post('/switch', authenticate, authorize('super_admin', 'admin'), (req, res) => {
  const providerType = req.body?.provider;
  if (!providerType || !['ollama', 'openai'].includes(providerType)) {
    res.status(400).json({ error: '无效的提供商类型，支持: ollama, openai' });
    return;
  }
  switchProvider(providerType).healthCheck()
    .then((health: any) => {
      const provider = getProvider();
      res.json({ success: true, ...health, config: provider.getConfig() });
    })
    .catch((err: any) => {
      console.error('[LLM-SWITCH] 切换失败:', err?.message);
      res.status(500).json({ success: false, error: err?.message || '切换失败' });
    });
});

export default router;
