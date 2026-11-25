// web/src/services/cover.ts
// 封面 URL 统一解析（2026-11-20 新增，修复专辑/单曲封面全部无法显示的问题）
//
// 根因：网易云图片 CDN（p1-p4.music.126.net）有防盗链，浏览器直连外链图片
// 携带 Referer 会返回 403；桌面版 Electron（file:// 源）同样被拒；
// 部分历史入库的封面 URL 已过期失效。
//
// 方案：外链封面统一改走服务端封面代理 GET /api/cover?url=<encoded>，
// 由服务端伪造 Referer 拉取并缓存（内存 LRU + 磁盘），详见
// server/src/modules/cover/cover-proxy.service.ts。
import { API_BASE } from './api';

/**
 * 解析封面展示 URL：
 * - 空值 → undefined（组件据此走 coverColor 渐变兜底）
 * - 本地/相对路径、data:/blob: → 原样返回（本地导入歌曲封面等）
 * - http(s) 外链 → 服务端封面代理地址（绕过防盗链 Referer 校验）
 * - 其他协议/非法格式 → undefined（走兜底）
 */
export function resolveCoverUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const u = url.trim();
  if (!u) return undefined;
  // 本地路径 / 相对路径 / 内联数据（本地导入歌曲、静态资源）
  if (u.startsWith('/') || u.startsWith('data:') || u.startsWith('blob:')) return u;
  // http(s) 外链 → 代理
  if (/^https?:\/\//i.test(u)) {
    return `${API_BASE}/cover?url=${encodeURIComponent(u)}`;
  }
  return undefined;
}
