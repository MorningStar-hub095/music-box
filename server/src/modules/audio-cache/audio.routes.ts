import { Router } from 'express';
import { checkAudioUrl, logAudioError } from './audio-cache.service';
import { config } from '../../config';

/**
 * 音频流路由（从 index.ts 拆出，2026-10-26）
 * 挂载点：app.use('/api/audio', audioRoutes)
 * - GET  /api/audio/:trackId       本地缓存优先，未命中实时代理（支持 Range）
 * - HEAD /api/audio/:trackId       预加载：触发下载缓存但不返回音频体
 * - GET  /api/audio/:trackId/check 音频 URL 预检测
 * - POST /api/audio/error-report   音频错误上报
 *
 * 演示模式（DEMO_MODE=true）下，本路由全部外链音频端点关闭（403）——
 * 公网 Demo 不代理/分发第三方版权音频；唯一音频来源见 /api/library/*。
 */
const router = Router();

const DEMO_BLOCKED = {
  error: '演示模式下第三方音频播放已停用（版权合规）',
  demoMode: true,
  alternative: '/api/library/tracks',
};

// 错误上报先注册：避免被 GET /:trackId 以 trackId='error-report' 吞掉语义
router.post('/error-report', async (req, res) => {
  try {
    const { trackId, errorType, urlSource, statusCode, details } = req.body;
    if (!trackId || !errorType) {
      return res.status(400).json({ error: 'trackId and errorType required' });
    }
    await logAudioError({
      trackId,
      errorType,
      urlSource,
      statusCode,
      userAgent: req.headers['user-agent'],
      details,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log error' });
  }
});

// 音频URL预检测
router.get('/:trackId/check', async (req, res) => {
  if (config.demoMode) return res.status(403).json(DEMO_BLOCKED);
  try {
    const trackId = decodeURIComponent(req.params.trackId);
    const result = await checkAudioUrl(trackId);
    res.json(result);
  } catch (err) {
    res.json({ valid: false, source: 'none', reason: 'check_error' });
  }
});

// 音频代理缓存接口：本地缓存优先，未命中则实时代理网易云CDN
// 支持 Range 请求（播放器拖拽进度条），缓存后永久有效
router.get('/:trackId', async (req, res) => {
  if (config.demoMode) return res.status(403).json(DEMO_BLOCKED);
  try {
    const trackId = req.params.trackId;
    if (!trackId) {
      return res.status(400).end('缺少歌曲 ID');
    }
    const { serveAudio } = require('./audio-cache.service');
    const range = req.headers.range;
    await serveAudio(trackId, range, res);
  } catch (err: any) {
    console.error('[AUDIO] 错误:', err);
    if (!res.headersSent) {
      res.status(500).end('音频服务异常');
    }
  }
});

// HEAD 请求用于预加载：触发下载缓存但不返回音频体
router.head('/:trackId', async (req, res) => {
  if (config.demoMode) return res.status(403).end();
  try {
    const trackId = req.params.trackId;
    if (!trackId) {
      return res.status(400).end();
    }
    const { ensureCached, isCached, getCacheSize } = require('./audio-cache.service');
    if (isCached(trackId)) {
      const size = getCacheSize(trackId);
      res.setHeader('Content-Length', size);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-Audio-Source', 'cached');
      return res.status(200).end();
    }
    // 触发后台下载
    ensureCached(trackId).then((filePath: string | null) => {
      if (filePath) {
        console.log(`[AUDIO] 预加载完成: ${trackId}`);
      }
    }).catch(() => {});
    res.setHeader('X-Audio-Source', 'downloading');
    return res.status(202).end();
  } catch (err: any) {
    console.error('[AUDIO-HEAD] 错误:', err);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

export default router;
