/**
 * 线上搜索服务（2026-11-18 搜索强化）
 *
 * 职责：为 /api/search 提供"线上增量结果"——本地库未覆盖时从 Jamendo（CC 授权，
 * 官方 API）实时搜索，映射为与本地歌曲同构的对象返回给前端。
 *
 * 设计原则：
 *  1. 本地优先：本地结果永远是主结果，线上结果只作为附加段（result.online），绝不混入
 *     本地分页语义（pagination.total 仍只统计本地）。
 *  2. fail-open：任何线上故障（未配置 client_id / 网络异常 / 超时）都降级为空结果 +
 *     明确 reason，绝不抛错阻塞本地搜索响应。
 *  3. 短路保护：Promise.race 硬超时（config.search.online.timeoutMs），Jamendo API
 *     实测存在间歇空响应/慢响应，搜索内置 3 次退避重试，这里再兜一层总时长闸门。
 *  4. 进程内 TTL 缓存：同一关键词 300s 内复用，避免高频重复打 Jamendo API。
 *  5. 合规：只搜 CC 授权曲目（audiodownload_allowed=true），结果携带 license 信息，
 *     与 audio_licenses 登记体系一致。
 */

import { config } from '../../config';
import { isJamendoConfigured, searchJamendoTracks } from '../library/jamendo.service';

// ==================== 类型定义 ====================

/** 线上搜索结果条目（与本地歌曲对象同构的子集 + 线上标记） */
export interface OnlineTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  audioUrl: string;
  duration?: number;
  platform: 'jamendo';
  source: 'online';
  /** 播放/下载链接类型：stream 为即时流媒体，download 为持久下载链接 */
  audioKind: 'stream' | 'download';
  licenseUrl?: string;
}

export interface OnlineSection {
  /** 线上搜索是否参与本次响应（配置开启且 client_id 已配置） */
  available: boolean;
  /** 线上来源标识 */
  source: 'jamendo';
  /** 结果条目（失败/stub 时为空数组） */
  items: OnlineTrack[];
  /** 不可用/失败原因（available=false 或失败时有值） */
  reason?: string;
  /** 线上搜索耗时（ms，含超时截断） */
  duration: number;
  /** 是否可能还有更多（2026-11-20 新增：满页启发式，供前端"加载更多"） */
  hasMore: boolean;
}

interface CacheEntry {
  items: OnlineTrack[];
  expiresAt: number;
}

// ==================== 进程内 TTL 缓存 ====================

const onlineCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 200;

function cacheGet(q: string): OnlineTrack[] | null {
  const entry = onlineCache.get(q);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    onlineCache.delete(q);
    return null;
  }
  return entry.items;
}

function cacheSet(q: string, items: OnlineTrack[]): void {
  if (onlineCache.size >= MAX_CACHE_SIZE) {
    // 淘汰最早的条目
    const oldest = onlineCache.keys().next().value;
    if (oldest) onlineCache.delete(oldest);
  }
  onlineCache.set(q, { items, expiresAt: Date.now() + config.search.online.cacheTtl * 1000 });
}

/** 清空线上搜索缓存（测试与 /api/search/clear-cache 使用） */
export function clearOnlineSearchCache(): void {
  onlineCache.clear();
}

// ==================== 映射 ====================

/** Jamendo 搜索结果 → 线上曲目对象 */
function mapJamendoTrack(t: any): OnlineTrack | null {
  const streamUrl = t.audio || '';
  const downloadUrl = t.audiodownload || '';
  const audioUrl = streamUrl || downloadUrl;
  if (!audioUrl) return null; // 无任何可播放链接的结果没有价值
  return {
    id: `jamendo-online:${t.id}`,
    title: (t.name || 'Unknown').slice(0, 200),
    artist: (t.artist_name || 'Unknown').slice(0, 200),
    album: t.album_name ? t.album_name.slice(0, 200) : undefined,
    albumCover: t.album_image || undefined,
    audioUrl,
    duration: t.duration && t.duration > 0 ? t.duration : undefined,
    platform: 'jamendo',
    source: 'online',
    audioKind: streamUrl ? 'stream' : 'download',
    licenseUrl: t.license_ccurl || undefined,
  };
}

// ==================== 核心入口 ====================

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

/**
 * 线上搜索入口。任何失败路径都返回结构完整的 OnlineSection，绝不抛错。
 * @param q 搜索关键词（调用方保证非空）
 * @param scope 'local' 直接短路返回不参与（不消耗任何资源）
 * @param offset 线上分页偏移（2026-11-20 新增：加载更多场景；缓存键含 offset，不同页互不污染）
 */
export async function searchOnline(q: string, scope?: string, offset: number = 0): Promise<OnlineSection> {
  const started = Date.now();
  const base: OnlineSection = { available: true, source: 'jamendo', items: [], duration: 0, hasMore: false };

  // scope=local：明确只要本地，短路
  if (scope === 'local') return { ...base, available: false, reason: 'scope_local' };

  // 全局开关关闭（离线场景/合规要求）
  if (!config.search.online.enabled) {
    return { ...base, available: false, reason: 'online_disabled', duration: Date.now() - started };
  }

  // stub 模式：client_id 未配置
  if (!isJamendoConfigured()) {
    return {
      ...base,
      available: false,
      reason: 'jamendo_client_id_missing（在 developer.jamendo.com 注册后设置 JAMENDO_CLIENT_ID）',
      duration: Date.now() - started,
    };
  }

  // 进程内缓存命中（键含 offset，不同分页互不污染）
  const cacheKey = `${q}::${offset}`;
  // 旧实现（保留备查）：const cached = cacheGet(q); if (cached) {...}
  const cached = cacheGet(cacheKey);
  if (cached) {
    const cachedHasMore = cached.length >= config.search.online.maxResults;
    return { ...base, items: cached, hasMore: cachedHasMore, duration: Date.now() - started };
  }

  // 真实搜索：硬超时闸门（搜索服务内部已有 3 次退避重试，这里兜总时长）
  // 2026-11-20：groupby=false —— 旧实现沿用导入管线的 groupby:'artist_id'，
  // 每位歌手只回 1 首，搜歌手名时线上命中严重缺失；搜索场景需返回该歌手全部候选歌曲。
  const budgetMs = config.search.online.timeoutMs;
  const searchPromise = searchJamendoTracks({ q, limit: config.search.online.maxResults, groupby: false, offset });
  const result = await withTimeout(
    searchPromise,
    budgetMs,
    { ok: false, reason: `timeout_${budgetMs}ms`, tracks: [] }
  );

  if (!result.ok) {
    // 超时 fail-open：不阻塞本次响应；慢响应在后台继续完成并回填进程缓存，
    // 同一关键词下次搜索（Redis 结果缓存过期后）即可立即命中线上结果
    if ((result.reason || '').startsWith('timeout')) {
      void searchPromise
        .then(r => {
          if (r.ok) {
            const items = r.tracks
              .map(mapJamendoTrack)
              .filter((t): t is OnlineTrack => t !== null)
              .slice(0, config.search.online.maxResults);
            cacheSet(cacheKey, items);
          }
        })
        .catch(() => { /* 后台回填失败可忽略 */ });
    }
    return {
      ...base,
      available: false,
      reason: `jamendo:${result.reason || 'unknown'}`,
      duration: Date.now() - started,
    };
  }

  const items = result.tracks
    .map(mapJamendoTrack)
    .filter((t): t is OnlineTrack => t !== null)
    .slice(0, config.search.online.maxResults);

  cacheSet(cacheKey, items);
  // hasMore：返回满页视为可能还有更多（Jamendo 不回传总数，以满页启发式判断）
  const hasMore = items.length >= config.search.online.maxResults;
  return { ...base, items, hasMore, duration: Date.now() - started };
}

// 导出单例形态（供依赖注入与测试 mock 使用）
export const searchOnlineService = { searchOnline, clearOnlineSearchCache };
export default searchOnlineService;
