import { Router } from 'express';

/**
 * 音频 URL 刷新路由（从 index.ts 拆出，2026-10-26）
 * 挂载点：app.use('/api/refresh-track', refreshTrackLimiter, refreshTrackRoutes)
 * 优先级：Redis缓存 → DB验证 → Python刷新
 */
const router = Router();

router.get('/', async (req, res) => {
  try {
    const id = req.query.id as string;
    if (!id) {
      return res.status(400).json({ success: false, error: '缺少歌曲 ID' });
    }
    // 保留函数内懒加载（与原实现一致，避免启动期加载 840 行服务模块）
    const { UrlManagerService } = require('./url-manager.service');
    const urlMgr = new UrlManagerService();
    // getUrl: 缓存命中直接返回，DB有效直接返回，过期才触发Python刷新
    const url = await urlMgr.getUrl(id, 'manual');
    if (url) {
      return res.json({ success: true, new_url: url, refreshed: true });
    }
    return res.status(500).json({ success: false, error: '无法获取有效的播放地址' });
  } catch (err: any) {
    if (String(err?.message).includes('歌曲不存在')) {
      return res.status(404).json({ success: false, error: '歌曲不存在' });
    }
    console.error('[refreshTrack] 错误:', err);
    return res.status(500).json({ success: false, error: err?.message || '刷新失败' });
  }
});

export default router;
