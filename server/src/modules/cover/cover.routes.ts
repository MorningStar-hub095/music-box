import { Router } from 'express';
import {
  getCoverImage,
  validateCoverUrl,
  MAX_IMAGE_BYTES,
} from './cover-proxy.service';

/**
 * 封面图片代理路由（2026-11-20 新增）
 * 挂载点：app.use('/api/cover', coverLimiter, coverRoutes)
 * - GET /api/cover?url=<encodeURIComponent(图片URL)>
 *
 * 行为：
 *   - 空参/非法 URL → 400
 *   - 非白名单域名 / 内网地址 → 403
 *   - 上游非 200 / 非图片 content-type / 超限 → 502
 *   - 命中内存/磁盘缓存直接返回（X-Cover-Source: memory|disk）
 *   - 成功响应带 Cache-Control: public, max-age=604800, immutable
 *
 * 封面为图片资源（非音频版权出口），演示模式下保持可用。
 */
const router = Router();

router.get('/', async (req, res) => {
  // [2026-11-20 封面代理上线] 旧实现：无任何封面代理，前端直连外链图片被防盗链 403
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!raw) {
    return res.status(400).json({ error: '缺少 url 参数' });
  }

  const check = await validateCoverUrl(raw);
  if (!check.ok) {
    console.warn(`[COVER-PROXY] 拒绝请求 url=${raw.slice(0, 120)} reason=${check.reason}`);
    return res.status(403).json({ error: '封面地址不被允许', reason: check.reason });
  }

  try {
    const { buf, contentType, source } = await getCoverImage(raw);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('X-Cover-Source', source);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(buf);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[COVER-PROXY] 拉取失败 url=${raw.slice(0, 120)} reason=${reason}`);
    if (reason === 'image_too_large' || reason.includes('too_large')) {
      return res.status(502).json({ error: `图片超过大小上限 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB` });
    }
    return res.status(502).json({ error: '封面拉取失败', reason });
  }
});

export default router;
