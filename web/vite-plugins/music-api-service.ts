// @deprecated 生产环境已由后端 server/src/modules/url-manager/music-api.service.ts 承接，
// 本文件仅在 Vite dev 服务器使用，保留用于本地开发调试，请勿在生产逻辑中依赖。
// web/vite-plugins/music-api-service.ts
// 统一音乐API服务：支持网易云、QQ音乐、酷狗音乐多源获取
import https from 'node:https';
import http from 'node:http';

// 音乐源类型
export type MusicSource = 'netease' | 'qq' | 'kugou';

// 音乐URL结果
export interface MusicUrlResult {
  url: string;
  size: number;
  source: MusicSource;
  bitrate: number;
}

// 音乐源配置
interface MusicSourceConfig {
  name: string;
  headers: Record<string, string>;
  timeout: number;
}

// 各音乐源配置
const SOURCE_CONFIGS: Record<MusicSource, MusicSourceConfig> = {
  netease: {
    name: '网易云音乐',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://music.163.com/',
      'Cookie': 'os=pc; osver=Microsoft-Windows-10-Professional-build-19045-64bit; appver=2.10.14; MUSIC_U=00C0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0; __remember_me=true; NMTID=00O0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0',
    },
    timeout: 8000,
  },
  qq: {
    name: 'QQ音乐',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://y.qq.com/',
      'Cookie': 'qqmusic_key=1234567890; qm_keyst=1234567890',
    },
    timeout: 8000,
  },
  kugou: {
    name: '酷狗音乐',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.kugou.com/',
    },
    timeout: 8000,
  },
};

// URL缓存
const urlCache = new Map<string, { result: MusicUrlResult; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30分钟缓存

// 请求统计
const requestStats = {
  netease: { success: 0, fail: 0 },
  qq: { success: 0, fail: 0 },
  kugou: { success: 0, fail: 0 },
};

/** HTTPS/HTTP GET 请求 */
function httpGet(url: string, headers: Record<string, string>, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers, timeout }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location, headers, timeout).then(resolve, reject);
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

/** HEAD 请求验证 URL */
function headCheck(url: string, headers: Record<string, string>, timeout: number): Promise<{ valid: boolean; sizeBytes: number; status: number }> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method: 'HEAD', headers, timeout }, (res) => {
      const size = parseInt(res.headers['content-length'] || '0', 10);
      resolve({ valid: res.statusCode === 200 && size > 1024 * 1024, sizeBytes: size, status: res.statusCode || 0 });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ valid: false, sizeBytes: 0, status: 0 }); });
    req.on('error', () => resolve({ valid: false, sizeBytes: 0, status: 0 }));
    req.end();
  });
}

/** 网易云音乐API */
async function fetchFromNetease(songId: string): Promise<MusicUrlResult | null> {
  const config = SOURCE_CONFIGS.netease;
  
  // 多码率尝试
  for (const br of [128000, 192000, 320000]) {
    try {
      const apiUrl = `https://music.163.com/api/song/enhance/player/url?ids=${encodeURIComponent(`[${parseInt(songId, 10)}]`)}&br=${br}`;
      const text = await httpGet(apiUrl, config.headers, config.timeout);
      const json = JSON.parse(text);
      const data = json?.data?.[0];
      if (data?.url && data?.size > 1024 * 1024) {
        return {
          url: data.url,
          size: data.size,
          source: 'netease',
          bitrate: br,
        };
      }
    } catch {
      // 继续尝试下一码率
    }
  }
  return null;
}

/** QQ音乐API */
async function fetchFromQQ(songId: string): Promise<MusicUrlResult | null> {
  const config = SOURCE_CONFIGS.qq;
  
  try {
    // QQ音乐API - 获取歌曲播放链接
    const apiUrl = `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify({
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: '1234567890',
          songmid: [songId],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
        },
      },
    }))}`;
    
    const text = await httpGet(apiUrl, config.headers, config.timeout);
    const json = JSON.parse(text);
    const vkeyData = json?.req_0?.data?.midurlinfo?.[0];
    
    if (vkeyData?.purl) {
      const url = `https://dl.stream.qqmusic.qq.com/${vkeyData.purl}`;
      const check = await headCheck(url, config.headers, 5000);
      if (check.valid) {
        return {
          url,
          size: check.sizeBytes,
          source: 'qq',
          bitrate: 128000,
        };
      }
    }
  } catch {
    // QQ音乐API失败
  }
  return null;
}

/** 酷狗音乐API */
async function fetchFromKugou(songId: string): Promise<MusicUrlResult | null> {
  const config = SOURCE_CONFIGS.kugou;
  
  try {
    // 酷狗音乐API - 获取歌曲播放链接
    const apiUrl = `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${songId}&appid=1014&mid=1234567890&platid=4`;
    
    const text = await httpGet(apiUrl, config.headers, config.timeout);
    const json = JSON.parse(text);
    
    if (json?.data?.play_url) {
      const url = json.data.play_url;
      const check = await headCheck(url, config.headers, 5000);
      if (check.valid) {
        return {
          url,
          size: check.sizeBytes,
          source: 'kugou',
          bitrate: 128000,
        };
      }
    }
  } catch {
    // 酷狗音乐API失败
  }
  return null;
}

/** 从缓存获取URL */
function getCachedUrl(cacheKey: string): MusicUrlResult | null {
  const cached = urlCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  return null;
}

/** 更新缓存 */
function updateCache(cacheKey: string, result: MusicUrlResult): void {
  urlCache.set(cacheKey, { result, timestamp: Date.now() });
}

/** 清理过期缓存 */
export function cleanExpiredCache(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of urlCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      urlCache.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

/** 获取请求统计 */
export function getRequestStats(): typeof requestStats {
  return { ...requestStats };
}

/** 统一音乐URL获取接口 */
export async function fetchMusicUrl(
  songId: string,
  source: MusicSource = 'netease',
  preferredBitrate: number = 128000
): Promise<MusicUrlResult | null> {
  const cacheKey = `${source}:${songId}:${preferredBitrate}`;
  
  // 1. 检查缓存
  const cached = getCachedUrl(cacheKey);
  if (cached) {
    // 验证缓存URL是否有效
    const config = SOURCE_CONFIGS[cached.source];
    const check = await headCheck(cached.url, config.headers, 4000);
    if (check.valid) {
      return cached;
    }
    // 缓存失效，删除
    urlCache.delete(cacheKey);
  }
  
  // 2. 根据源获取URL
  let result: MusicUrlResult | null = null;
  
  try {
    switch (source) {
      case 'netease':
        result = await fetchFromNetease(songId);
        break;
      case 'qq':
        result = await fetchFromQQ(songId);
        break;
      case 'kugou':
        result = await fetchFromKugou(songId);
        break;
    }
    
    if (result) {
      requestStats[source].success++;
      updateCache(cacheKey, result);
    } else {
      requestStats[source].fail++;
    }
  } catch {
    requestStats[source].fail++;
  }
  
  return result;
}

/** 多源并发获取（优先返回第一个有效结果） */
export async function fetchMusicUrlFromMultipleSources(
  songId: string,
  sources: MusicSource[] = ['netease', 'qq', 'kugou'],
  preferredBitrate: number = 128000
): Promise<MusicUrlResult | null> {
  // 并发请求多个源
  const promises = sources.map(source => 
    fetchMusicUrl(songId, source, preferredBitrate)
      .catch(() => null) // 忽略单个源的错误
  );
  
  // 等待第一个成功的结果
  const results = await Promise.allSettled(promises);
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }
  
  return null;
}

/** 根据trackId解析songId和source */
export function parseTrackId(trackId: string): { songId: string; source: MusicSource } {
  if (trackId.startsWith('netease:')) {
    return { songId: trackId.slice('netease:'.length), source: 'netease' };
  }
  if (trackId.startsWith('qq:')) {
    return { songId: trackId.slice('qq:'.length), source: 'qq' };
  }
  if (trackId.startsWith('kugou:')) {
    return { songId: trackId.slice('kugou:'.length), source: 'kugou' };
  }
  
  // 默认为网易云
  const colonIdx = trackId.indexOf(':');
  return {
    songId: colonIdx >= 0 ? trackId.slice(colonIdx + 1) : trackId,
    source: 'netease',
  };
}
