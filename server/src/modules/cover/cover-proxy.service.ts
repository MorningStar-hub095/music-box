/**
 * 封面图片代理服务（2026-11-20 新增，修复专辑封面全挂问题）
 *
 * 背景：网易云图片 CDN（p1-p4.music.126.net）有防盗链，浏览器直连外链时
 * 携带 Referer 会返回 403；桌面版 Electron（file:// 源）同样被拒；
 * 部分历史入库的封面 URL 已过期失效。
 *
 * 解决：前端统一走 GET /api/cover?url=<encoded>，由服务端拉取远程图片
 * （对 126.net 伪造 music.163.com Referer，其余不带 Referer），
 * 命中内存 LRU / 磁盘缓存直接返回，并设置长 Cache-Control。
 *
 * 安全（SSRF 防护）：
 *   - 协议仅 http/https
 *   - 域名白名单（music.126.net / jamendo.com / scdn.co 等）
 *   - 拒绝内网地址（127.x / 10.x / 172.16-31.x / 192.168.x / 169.254.x /
 *     0.x / localhost / IPv6 回环与链路本地等），含 DNS 解析后逐 IP 校验
 *   - content-type 必须 image/*（另明确拒绝 image/svg+xml，防脚本注入）
 *   - 大小上限 5MB
 *
 * 存储结构：data/cover-cache/{sha1(url)}.{ext}（可用 COVER_CACHE_DIR 覆盖）
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dns from 'dns';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT = 10_000;               // 单次拉取超时 10s
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 图片大小上限 5MB
export const MAX_REDIRECTS = 3;

/** 域名白名单：hostname 等于该值或以 ".该值" 结尾即放行 */
export const COVER_ALLOWED_HOSTS = [
  'music.126.net',   // 网易云图片 CDN（p1-p4.music.126.net）
  '126.net',         // 网易云其他资源域
  'jamendo.com',     // Jamendo CC 音乐封面
  'scdn.co',         // Spotify CDN
];

/** 内存 LRU：最多 300 张 / 64MB（封面通常 30~200KB） */
const MEM_CACHE_MAX_ENTRIES = 300;
const MEM_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/** 磁盘缓存上限（MB），可用 COVER_CACHE_MAX_MB 覆盖；默认 300MB */
const DISK_CACHE_MAX_BYTES =
  (Number.parseInt(process.env.COVER_CACHE_MAX_MB || '', 10) || 300) * 1024 * 1024;

const COVER_CACHE_DIR = process.env.COVER_CACHE_DIR
  ? path.resolve(process.env.COVER_CACHE_DIR)
  : path.resolve(process.cwd(), '..', 'data', 'cover-cache');

// ---------------------------------------------------------------------------
// SSRF 校验
// ---------------------------------------------------------------------------

/** 判断 IP 字符串是否为内网/保留地址 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase().trim();

  // IPv4-mapped IPv6（::ffff:a.b.c.d）→ 提取 v4 部分递归校验
  const v4mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateAddress(v4mapped[1]);

  // IPv6
  if (addr.includes(':')) {
    if (addr === '::' || addr === '::1') return true;               // 未指定/回环
    const first = addr.split(':')[0];
    const hex = parseInt(first, 16);
    if (!Number.isNaN(hex)) {
      if (hex >= 0xfc00 && hex <= 0xfdff) return true;              // fc00::/7 唯一本地
      if (hex >= 0xfe80 && hex <= 0xfebf) return true;              // fe80::/10 链路本地
    }
    return false;
  }

  // IPv4 点分十进制
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // 解析失败按拒绝处理
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;                // 0.x / 10.x / 127.x
  if (a === 169 && b === 254) return true;                          // 169.254.x 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true;                 // 172.16-31.x
  if (a === 192 && b === 168) return true;                          // 192.168.x
  return false;
}

/** hostname 是否在白名单内（等于或子域） */
export function isCoverHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, ''); // 去 FQDN 结尾点
  return COVER_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith('.' + allowed),
  );
}

export type UrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * 校验封面 URL（同步部分 + DNS 解析）：
 * 协议、内网地址（字面量 + 解析结果）、域名白名单
 */
export async function validateCoverUrl(raw: string): Promise<UrlValidationResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol_not_allowed' };
  }

  const host = url.hostname.toLowerCase();

  // 禁止 localhost 及其子域
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, reason: 'internal_address' };
  }

  // IP 字面量直接校验
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddress(host.includes(':') ? `[${host}]`.replace(/[[\]]/g, '') : host)) {
      return { ok: false, reason: 'internal_address' };
    }
    // 公网 IP 字面量不在域名白名单内，同样拒绝
    return { ok: false, reason: 'host_not_allowed' };
  }

  // 域名白名单
  if (!isCoverHostAllowed(host)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  // DNS 解析后逐 IP 校验（防 DNS rebinding 指向内网）
  try {
    const records = await dns.promises.lookup(host, { all: true });
    if (records.length === 0) return { ok: false, reason: 'dns_resolve_failed' };
    for (const rec of records) {
      if (isPrivateAddress(rec.address)) {
        return { ok: false, reason: 'internal_address' };
      }
    }
  } catch {
    return { ok: false, reason: 'dns_resolve_failed' };
  }

  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// 远程拉取（可注入 mock，供单测替换）
// ---------------------------------------------------------------------------

export interface RemoteImage {
  statusCode: number;
  contentType?: string;
  body: Buffer;
}

export type CoverFetcher = (url: string, referer?: string) => Promise<RemoteImage>;

/** 按主机返回伪造 Referer：网易云图片 CDN 校验 Referer，其余源不带 */
export function refererForHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (host.endsWith('126.net') || host.endsWith('music.126.net')) {
    return 'https://music.163.com/';
  }
  return undefined;
}

function collectBody(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        (stream as any).destroy?.();
        reject(new Error('image_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Node 默认实现：跟随重定向（每跳重新做 SSRF 校验） */
async function defaultNodeFetcher(target: string, referer?: string): Promise<RemoteImage> {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await validateCoverUrl(current);
    if (!check.ok) throw new Error(check.reason);

    const mod = check.url.protocol === 'https:' ? https : http;
    const result: RemoteImage & { redirect?: string } = await new Promise((resolve, reject) => {
      const req = mod.get(
        check.url,
        {
          timeout: FETCH_TIMEOUT,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            Accept: 'image/*,*/*;q=0.8',
            ...(referer ? { Referer: referer } : {}),
          },
        },
        (res) => {
          // 跟随重定向
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            const next = new URL(res.headers.location, check.url).toString();
            resolve({ statusCode: res.statusCode, body: Buffer.alloc(0), redirect: next });
            return;
          }
          collectBody(res, MAX_IMAGE_BYTES)
            .then((buf) => resolve({ statusCode: res.statusCode || 500, contentType: res.headers['content-type'], body: buf }))
            .catch(reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('fetch_timeout')); });
    });

    if (result.redirect) {
      current = result.redirect;
      continue;
    }
    return result;
  }
  throw new Error('too_many_redirects');
}

let fetcher: CoverFetcher = defaultNodeFetcher;

/** 测试注入 mock 拉取器；传 null 恢复默认实现 */
export function setCoverFetcherForTests(f: CoverFetcher | null): void {
  fetcher = f ?? defaultNodeFetcher;
}

// ---------------------------------------------------------------------------
// 缓存：内存 LRU + 磁盘
// ---------------------------------------------------------------------------

interface MemEntry { buf: Buffer; contentType: string; lastAccess: number }
const memCache = new Map<string, MemEntry>();
let memCacheBytes = 0;

function memGet(url: string): MemEntry | null {
  const entry = memCache.get(url);
  if (!entry) return null;
  entry.lastAccess = Date.now();
  return entry;
}

function memSet(url: string, buf: Buffer, contentType: string): void {
  const old = memCache.get(url);
  if (old) { memCacheBytes -= old.buf.length; memCache.delete(url); }
  while (
    memCache.size > 0 &&
    (memCacheBytes + buf.length > MEM_CACHE_MAX_BYTES || memCache.size >= MEM_CACHE_MAX_ENTRIES)
  ) {
    // 逐出最久未访问条目
    let oldestKey = ''; let oldestTime = Infinity;
    for (const [k, v] of memCache) {
      if (v.lastAccess < oldestTime) { oldestTime = v.lastAccess; oldestKey = k; }
    }
    if (!oldestKey) break;
    memCacheBytes -= memCache.get(oldestKey)!.buf.length;
    memCache.delete(oldestKey);
  }
  memCache.set(url, { buf, contentType, lastAccess: Date.now() });
  memCacheBytes += buf.length;
}

export function clearCoverMemCacheForTests(): void {
  memCache.clear();
  memCacheBytes = 0;
}

/** content-type → 扩展名（仅白名单类型落盘） */
function extForContentType(ct: string): string | null {
  const t = ct.split(';')[0].trim().toLowerCase();
  switch (t) {
    case 'image/jpeg': case 'image/jpg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/avif': return 'avif';
    case 'image/bmp': return 'bmp';
    default: return null;
  }
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case 'jpg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'avif': return 'image/avif';
    case 'bmp': return 'image/bmp';
    default: return 'image/jpeg';
  }
}

function ensureCacheDir(): void {
  if (!fs.existsSync(COVER_CACHE_DIR)) {
    fs.mkdirSync(COVER_CACHE_DIR, { recursive: true });
  }
}

function diskPathFor(url: string, ext: string): string {
  const hash = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(COVER_CACHE_DIR, `${hash}.${ext}`);
}

function diskGet(url: string): { filePath: string; contentType: string } | null {
  // 尝试常见扩展名（首次落盘时扩展名由 content-type 决定）
  for (const ext of ['jpg', 'png', 'webp', 'gif', 'avif', 'bmp']) {
    const p = diskPathFor(url, ext);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0) {
        // 触碰 mtime，供磁盘 LRU 淘汰
        const now = new Date();
        fs.utimesSync(p, now, now);
        return { filePath: p, contentType: contentTypeForExt(ext) };
      }
    } catch { /* 不存在，继续 */ }
  }
  return null;
}

function diskSet(url: string, buf: Buffer, contentType: string): void {
  const ext = extForContentType(contentType);
  if (!ext) return;
  try {
    ensureCacheDir();
    const dest = diskPathFor(url, ext);
    const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    void enforceDiskCacheLimit();
  } catch { /* 落盘失败不影响响应 */ }
}

/** 磁盘缓存超限时按 mtime LRU 淘汰（节流：60s 一次） */
let diskEvictLastRun = 0;
function enforceDiskCacheLimit(): void {
  const now = Date.now();
  if (now - diskEvictLastRun < 60_000) return;
  diskEvictLastRun = now;
  try {
    ensureCacheDir();
    const files: { name: string; size: number; mtime: number }[] = [];
    let total = 0;
    for (const f of fs.readdirSync(COVER_CACHE_DIR)) {
      if (!/\.(jpg|png|webp|gif|avif|bmp)$/.test(f)) continue;
      try {
        const st = fs.statSync(path.join(COVER_CACHE_DIR, f));
        files.push({ name: f, size: st.size, mtime: st.mtimeMs });
        total += st.size;
      } catch { /* ignore */ }
    }
    if (total <= DISK_CACHE_MAX_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime);
    let over = total - DISK_CACHE_MAX_BYTES;
    for (const f of files) {
      if (over <= 0) break;
      try {
        fs.unlinkSync(path.join(COVER_CACHE_DIR, f.name));
        over -= f.size;
      } catch { /* ignore */ }
    }
    console.log('[COVER-PROXY] 磁盘缓存超限，已 LRU 淘汰');
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 核心入口：取封面 Buffer（内存 → 磁盘 → 远程）
// ---------------------------------------------------------------------------

export interface CoverResult {
  buf: Buffer;
  contentType: string;
  source: 'memory' | 'disk' | 'remote';
}

export async function getCoverImage(rawUrl: string): Promise<CoverResult> {
  // 1. 内存缓存
  const mem = memGet(rawUrl);
  if (mem) return { buf: mem.buf, contentType: mem.contentType, source: 'memory' };

  // 2. 磁盘缓存
  const disk = diskGet(rawUrl);
  if (disk) {
    try {
      const buf = fs.readFileSync(disk.filePath);
      memSet(rawUrl, buf, disk.contentType);
      return { buf, contentType: disk.contentType, source: 'disk' };
    } catch { /* 读盘失败走远程 */ }
  }

  // 3. 远程拉取
  const url = new URL(rawUrl);
  const remote = await fetcher(rawUrl, refererForHost(url.hostname));
  if (remote.statusCode !== 200) {
    throw new Error(`upstream_status_${remote.statusCode}`);
  }
  const ct = (remote.contentType || '').split(';')[0].trim().toLowerCase();
  // content-type 必须 image/*；明确拒绝 SVG（可含脚本，直出有 XSS 风险）
  if (!ct.startsWith('image/')) throw new Error('not_an_image');
  if (ct === 'image/svg+xml') throw new Error('svg_not_allowed');
  if (remote.body.length === 0) throw new Error('empty_body');
  if (remote.body.length > MAX_IMAGE_BYTES) throw new Error('image_too_large');

  diskSet(rawUrl, remote.body, ct);
  memSet(rawUrl, remote.body, ct);
  return { buf: remote.body, contentType: ct, source: 'remote' };
}
