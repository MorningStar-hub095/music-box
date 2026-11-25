// @deprecated 生产环境音频 URL 刷新已由后端 /api/refresh-track (UrlManagerService) 承接，
// 本插件仅在 Vite dev 服务器提供 /api/refresh-track 调试端点，保留用于本地开发，请勿在生产依赖。
// web/vite-plugins/audio-refresher.ts
// Vite 插件：提供音频 URL 自动刷新 API，支持多源获取
import type { Plugin } from 'vite';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { 
  fetchMusicUrlFromMultipleSources, 
  parseTrackId, 
  cleanExpiredCache,
  getRequestStats,
  type MusicSource 
} from './music-api-service';

const TRACKS_FILE = path.resolve(__dirname, '../../shared/tracks.json');

// URL 缓存：避免频繁请求
const urlCache = new Map<string, { url: string; timestamp: number; source: MusicSource }>();
const CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存

// 请求头配置
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** HTTPS GET 请求（返回字符串） */
function httpsGet(url: string, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: COMMON_HEADERS, timeout }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 重定向
        httpsGet(res.headers.location, timeout).then(resolve, reject);
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** HEAD 请求验证 URL（返回 { valid, sizeBytes }） */
function headCheck(url: string, timeout = 6000): Promise<{ valid: boolean; sizeBytes: number; status: number }> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method: 'HEAD', headers: COMMON_HEADERS, timeout }, (res) => {
      const size = parseInt(res.headers['content-length'] || '0', 10);
      resolve({ valid: res.statusCode === 200 && size > 1024 * 1024, sizeBytes: size, status: res.statusCode || 0 });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ valid: false, sizeBytes: 0, status: 0 }); });
    req.on('error', () => resolve({ valid: false, sizeBytes: 0, status: 0 }));
    req.end();
  });
}

/** 调用多源音乐API获取新URL */
async function fetchMusicUrlMultiSource(trackId: string): Promise<{ url: string; size: number; source: MusicSource } | null> {
  // 解析trackId获取songId和源
  const { songId, source } = parseTrackId(trackId);
  
  // 检查缓存
  const cacheKey = `${source}:${songId}`;
  const cached = urlCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // 验证缓存的 URL 是否仍然有效
    const check = await headCheck(cached.url, 4000);
    if (check.valid) {
      return { url: cached.url, size: check.sizeBytes, source: cached.source };
    }
    // 缓存失效，删除
    urlCache.delete(cacheKey);
  }

  // 多源并发获取
  const result = await fetchMusicUrlFromMultipleSources(songId, [source, 'qq', 'kugou']);
  if (result) {
    // 更新缓存
    urlCache.set(cacheKey, { url: result.url, timestamp: Date.now(), source: result.source });
    return { url: result.url, size: result.size, source: result.source };
  }
  
  return null;
}

/** 读取 tracks.json */
function readTracks(): any[] {
  try {
    return JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/** 写入 tracks.json */
function writeTracks(tracks: any[]): void {
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(tracks, null, 2), 'utf-8');
}

/** 刷新单首曲目 URL */
async function refreshTrackUrl(trackId: string): Promise<{ success: boolean; newUrl: string; message: string }> {
  // 1. 调用多源音乐API
  const result = await fetchMusicUrlMultiSource(trackId);
  if (!result) return { success: false, newUrl: '', message: `多源音乐API未返回有效URL (trackId=${trackId})` };

  // 2. 验证新 URL
  const check = await headCheck(result.url, 8000);
  if (!check.valid) return { success: false, newUrl: '', message: `新URL验证失败 (status=${check.status}, size=${check.sizeBytes})` };

  // 3. 更新 tracks.json
  const tracks = readTracks();
  let updated = false;
  for (const t of tracks) {
    if (t.id === trackId) {
      // 旧 URL 还有效就不更新
      if (t.audioUrl) {
        const oldCheck = await headCheck(t.audioUrl, 4000);
        if (oldCheck.valid) {
          return { success: true, newUrl: t.audioUrl, message: 'URL仍然有效，无需刷新' };
        }
      }
      t.audioUrl = result.url;
      t.playable = true;
      t.source = result.source; // 记录来源
      updated = true;
      break;
    }
  }
  if (!updated) return { success: false, newUrl: '', message: `未在tracks.json中找到曲目: ${trackId}` };

  writeTracks(tracks);
  console.log(`[audio-refresher] ${trackId} -> 新URL (${result.source}, ${Math.round(check.sizeBytes / 1024)}KB)`);
  return { success: true, newUrl: result.url, message: `URL已刷新 (${result.source}, ${Math.round(check.sizeBytes / 1024)}KB)` };
}

/** Vite 插件：音频 URL 刷新服务 */
export function audioRefresherPlugin(): Plugin {
  return {
    name: 'audio-refresher',
    configureServer(server) {
      server.middlewares.use('/api/refresh-track', async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const trackId = url.searchParams.get('id');
          if (!trackId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ success: false, error: '缺少 id 参数' }));
            return;
          }
          console.log(`[audio-refresher] 收到刷新请求: ${trackId}`);
          const result = await refreshTrackUrl(trackId);
          res.statusCode = result.success ? 200 : 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            success: result.success,
            new_url: result.newUrl,
            message: result.message,
          }));
        } catch (err: any) {
          console.error('[audio-refresher] 错误:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
        }
      });

      server.middlewares.use('/api/health', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ status: 'ok', service: 'audio-refresher-vite-plugin' }));
      });

      // API统计端点
      server.middlewares.use('/api/music-stats', (_req, res) => {
        const stats = getRequestStats();
        const cacheSize = urlCache.size;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          success: true,
          stats,
          cacheSize,
          sources: ['netease', 'qq', 'kugou'],
        }));
      });

      // 缓存清理端点
      server.middlewares.use('/api/clean-cache', (_req, res) => {
        const cleaned = cleanExpiredCache();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          success: true,
          cleaned,
          remaining: urlCache.size,
        }));
      });

      console.log('[audio-refresher] 多源音乐API插件已启用');
      console.log('[audio-refresher] 支持的音乐源: 网易云、QQ音乐、酷狗音乐');
      console.log('[audio-refresher] API端点:');
      console.log('  - GET /api/refresh-track?id=xxx (刷新音频URL)');
      console.log('  - GET /api/health (健康检查)');
      console.log('  - GET /api/music-stats (API统计)');
      console.log('  - GET /api/clean-cache (清理缓存)');
    },
  };
}
