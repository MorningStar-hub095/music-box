/**
 * 本地音频缓存服务（永久解决方案）
 *
 * 核心思路：将网易云CDN音频下载到本地磁盘，从此不再依赖临时URL。
 * 前端统一请求 /api/audio/{trackId}，本服务按以下优先级返回音频：
 *   1. 本地缓存文件（即时返回，无网络依赖）
 *   2. Redis 缓存的网易云URL（流式代理 + 后台保存到本地）
 *   3. 实时从网易云获取新URL（流式代理 + 后台保存到本地）
 *
 * 存储结构：data/audio-cache/{platform}_{numericId}.mp3
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';
import { withRedis } from '../../lib/redis';
import prisma from '../../lib/prisma';
import { runPython } from '../../lib/python-runner';
import { config } from '../../config';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

// 缓存目录迁移至项目根文件夹（与 server 同级的 data/audio-cache）
// 桌面应用等场景可通过 AUDIO_CACHE_DIR 环境变量覆盖
const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR
  ? path.resolve(process.env.AUDIO_CACHE_DIR)
  : path.resolve(process.cwd(), '..', 'data', 'audio-cache');
const DOWNLOAD_TIMEOUT = 30_000;          // 单次下载超时 30s
const MAX_CONCURRENT_DOWNLOADS = 4;       // 同时最多下载 4 首（从2增到）

// 磁盘缓存容量上限（MB）。超过上限时按 LRU（文件 mtime，最久未播放先删）淘汰。
// 可通过环境变量 AUDIO_CACHE_MAX_MB 覆盖；默认 5120MB。
const DISK_CACHE_MAX_BYTES =
  (Number.parseInt(process.env.AUDIO_CACHE_MAX_MB || '', 10) || 5120) * 1024 * 1024;

// ---------------------------------------------------------------------------
// 批量下载进度追踪
// ---------------------------------------------------------------------------
interface DownloadProgress {
  active: boolean;
  total: number;
  completed: number;
  success: number;
  failed: number;
  currentSong: string;
  startedAt: number;
}

let downloadProgress: DownloadProgress = {
  active: false, total: 0, completed: 0, success: 0, failed: 0, currentSong: '', startedAt: 0,
};

export function getDownloadProgress(): DownloadProgress {
  return { ...downloadProgress };
}

/** 强制重置下载进度状态（安全阀：状态卡死超过阈值时由管理接口调用） */
export function resetDownloadProgress(): void {
  downloadProgress.active = false;
}

// ---------------------------------------------------------------------------
// 内存 LRU 缓存（热歌秒播）
// ---------------------------------------------------------------------------

const MEM_CACHE_MAX_SIZE = 100 * 1024 * 1024; // 内存缓存上限 100MB（从50MB增到）
const MEM_CACHE_MAX_ENTRIES = 40;             // 最多缓存 40 首（从20增到）

interface MemCacheEntry {
  buf: Buffer;
  lastAccess: number;
}

const memCache = new Map<string, MemCacheEntry>();
let memCacheSize = 0;

function memCacheGet(trackId: string): Buffer | null {
  const entry = memCache.get(trackId);
  if (!entry) return null;
  entry.lastAccess = Date.now();
  return entry.buf;
}

function memCacheSet(trackId: string, buf: Buffer): void {
  // 如果已存在，先移除旧条目
  const old = memCache.get(trackId);
  if (old) {
    memCacheSize -= old.buf.length;
    memCache.delete(trackId);
  }
  // 容量检查：逐出最久未访问的条目
  while (memCacheSize + buf.length > MEM_CACHE_MAX_SIZE || memCache.size >= MEM_CACHE_MAX_ENTRIES) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, entry] of memCache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    const evicted = memCache.get(oldestKey)!;
    memCacheSize -= evicted.buf.length;
    memCache.delete(oldestKey);
  }
  memCache.set(trackId, { buf, lastAccess: Date.now() });
  memCacheSize += buf.length;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 确保缓存目录存在 */
function ensureCacheDir(): void {
  if (!fs.existsSync(AUDIO_CACHE_DIR)) {
    fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
  }
}

/** 旧缓存目录（server/data/audio-cache） */
const OLD_CACHE_DIR = path.resolve(process.cwd(), 'data', 'audio-cache');

/**
 * 迁移旧缓存文件到新目录（项目根 data/audio-cache）
 * 启动时自动执行一次，已迁移则跳过。
 *
 * 安全护栏（2026-11-16 事故修复）：
 * 1. 显式设置 AUDIO_CACHE_DIR 时跳过迁移——此时调用方已明确指定缓存位置，
 *    不应再把 process.cwd()/data/audio-cache 的文件搬过去（曾因此把整个主缓存搬进临时目录）；
 * 2. 旧目录与新目录为同一路径时跳过，防止自迁移把缓存清空。
 */
function migrateCacheDir(): void {
  if (process.env.AUDIO_CACHE_DIR) return;
  if (path.resolve(OLD_CACHE_DIR) === path.resolve(AUDIO_CACHE_DIR)) return;
  if (!fs.existsSync(OLD_CACHE_DIR)) return;
  const oldFiles = fs.readdirSync(OLD_CACHE_DIR).filter(f => f.endsWith('.mp3'));
  if (oldFiles.length === 0) return;

  ensureCacheDir();
  let migrated = 0;
  for (const f of oldFiles) {
    const src = path.join(OLD_CACHE_DIR, f);
    const dest = path.join(AUDIO_CACHE_DIR, f);
    // 目标已存在则跳过
    if (fs.existsSync(dest)) continue;
    try {
      fs.renameSync(src, dest);
      migrated++;
    } catch {
      // 跨盘 rename 可能失败，回退到 copy + delete
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        migrated++;
      } catch { /* ignore */ }
    }
  }
  if (migrated > 0) {
    console.log(`[AUDIO-CACHE] 已迁移 ${migrated} 个缓存文件到 ${AUDIO_CACHE_DIR}`);
  }
  // 迁移后清理空的旧目录
  try {
    const remaining = fs.readdirSync(OLD_CACHE_DIR);
    if (remaining.length === 0) fs.rmdirSync(OLD_CACHE_DIR);
  } catch { /* ignore */ }
}

// 启动时自动迁移
migrateCacheDir();

/** 将 trackId 转为安全的文件名：platform_numericId.mp3 */
function trackIdToFilename(trackId: string): string {
  return trackId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
}

/** 本地缓存文件的完整路径 */
export function getCachePath(trackId: string): string {
  return path.join(AUDIO_CACHE_DIR, trackIdToFilename(trackId));
}

/** 检查本地缓存是否存在且有效（>100KB） */
export function isCached(trackId: string): boolean {
  // 内存缓存命中也算
  if (memCache.has(trackId)) return true;
  const p = getCachePath(trackId);
  try {
    const stat = fs.statSync(p);
    return stat.isFile() && stat.size > 100_000;
  } catch {
    return false;
  }
}

/** 获取本地缓存文件大小（字节），不存在返回 0 */
export function getCacheSize(trackId: string): number {
  const mem = memCache.get(trackId);
  if (mem) return mem.buf.length;
  try {
    return fs.statSync(getCachePath(trackId)).size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 磁盘缓存上限与 LRU 淘汰
// ---------------------------------------------------------------------------

let diskEvictRunning = false;
let diskEvictLastRun = 0;
let diskEvictionCount = 0;   // 累计淘汰文件数（供统计）

/**
 * 扫描缓存目录并统计总大小
 */
function scanDiskCache(): { files: { name: string; size: number; mtime: number }[]; totalBytes: number } {
  ensureCacheDir();
  const files: { name: string; size: number; mtime: number }[] = [];
  let totalBytes = 0;
  for (const f of fs.readdirSync(AUDIO_CACHE_DIR)) {
    if (!f.endsWith('.mp3')) continue;
    try {
      const st = fs.statSync(path.join(AUDIO_CACHE_DIR, f));
      files.push({ name: f, size: st.size, mtime: st.mtimeMs });
      totalBytes += st.size;
    } catch { /* ignore */ }
  }
  return { files, totalBytes };
}

/**
 * 内存 LRU 触碰：播放/命中时更新磁盘文件 mtime，使淘汰策略贴近真实使用频率。
 * 异步执行，失败忽略。
 */
function touchDiskCache(trackId: string): void {
  const p = getCachePath(trackId);
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) return;
    const now = new Date();
    fs.utimes(p, now, now, () => {});
  });
}

/**
 * 磁盘缓存上限检查 + LRU 淘汰。
 * 超过 DISK_CACHE_MAX_BYTES 时，按 mtime 从旧到新删除，直到回到上限以内。
 * 节流：60 秒内最多执行一次；进行中的下载文件不会被淘汰。
 */
async function enforceDiskCacheLimit(force = false): Promise<void> {
  const now = Date.now();
  if (diskEvictRunning) return;
  if (!force && now - diskEvictLastRun < 60_000) return;
  diskEvictRunning = true;
  diskEvictLastRun = now;
  try {
    const { files, totalBytes } = scanDiskCache();
    if (totalBytes <= DISK_CACHE_MAX_BYTES) return;

    // 下载中的曲目不淘汰
    const inflight = new Set([...inflightDownloads.keys()].map((id) => trackIdToFilename(id)));
    const evictable = files
      .filter((f) => !inflight.has(f.name))
      .sort((a, b) => a.mtime - b.mtime);

    let over = totalBytes - DISK_CACHE_MAX_BYTES;
    let freed = 0;
    const removed: string[] = [];
    for (const f of evictable) {
      if (over <= 0) break;
      try {
        fs.unlinkSync(path.join(AUDIO_CACHE_DIR, f.name));
        over -= f.size;
        freed += f.size;
        removed.push(f.name);
        diskEvictionCount++;
      } catch { /* ignore */ }
    }
    if (removed.length > 0) {
      console.log(
        `[AUDIO-CACHE] 磁盘缓存超限（${(totalBytes / 1048576).toFixed(0)}MB > 上限 ${(DISK_CACHE_MAX_BYTES / 1048576).toFixed(0)}MB），` +
        `LRU 淘汰 ${removed.length} 个文件，释放 ${(freed / 1048576).toFixed(1)}MB`,
      );
      // 同步清理对应的内存缓存条目，避免命中已删除文件
      for (const name of removed) {
        const trackId = name.slice(0, -4);
        const entry = memCache.get(trackId);
        if (entry) {
          memCacheSize -= entry.buf.length;
          memCache.delete(trackId);
        }
      }
    }
  } finally {
    diskEvictRunning = false;
  }
}

// 启动后延迟执行一次（异步，不阻塞启动；force 绕过节流）
setTimeout(() => { void enforceDiskCacheLimit(true); }, 5_000).unref?.();

// ---------------------------------------------------------------------------
// 下载引擎
// ---------------------------------------------------------------------------

/** 下载计数器 */
let activeDownloads = 0;
const downloadQueue: Array<() => void> = [];

/** 等待下载槽位 */
async function acquireDownloadSlot(): Promise<void> {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads++;
    return;
  }
  await new Promise<void>((resolve) => downloadQueue.push(resolve));
  activeDownloads++;
}

/** 释放下载槽位 */
function releaseDownloadSlot(): void {
  activeDownloads--;
  if (downloadQueue.length > 0) {
    const next = downloadQueue.shift()!;
    next();
  }
}

/**
 * 从 URL 下载文件到本地路径（流式写入，不占内存）
 */
function downloadFile(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let settled = false;
    const settle = (ok: boolean) => {
      if (!settled) { settled = true; resolve(ok); }
    };

    const req = mod.get(url, { timeout: DOWNLOAD_TIMEOUT }, (res) => {
      // 跟随重定向（最多3次）
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, destPath).then(settle);
        return;
      }
      if (res.statusCode !== 200) {
        settle(false);
        return;
      }

      // 临时文件名加入唯一后缀：即使未来出现并发写同一曲目，也不会交错写同一个 tmp
      const tmpPath = `${destPath}.${process.pid}.${Date.now()}.tmp`;
      const ws = fs.createWriteStream(tmpPath);
      pipeline(res, ws).then(() => {
        // 下载完成，原子重命名
        try {
          fs.renameSync(tmpPath, destPath);
          settle(true);
        } catch {
          settle(false);
        }
      }).catch(() => {
        // 清理临时文件
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        settle(false);
      });
    });

    req.on('error', () => settle(false));
    req.on('timeout', () => { req.destroy(); settle(false); });
  });
}

// ---------------------------------------------------------------------------
// 核心服务
// ---------------------------------------------------------------------------

/**
 * 获取有效的网易云音频URL（优先缓存，过期才刷新）
 */
async function getNeteaseUrl(trackId: string): Promise<string | null> {
  // 1. Redis 缓存
  const cached = await withRedis(async (redis) => {
    const data = await redis.get(`url:cache:${trackId}`);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed.expiresAt > Date.now()) return parsed.url as string;
      await redis.del(`url:cache:${trackId}`);
    } catch { /* ignore */ }
    return null;
  }, null);

  if (cached) return cached;

  // 2. DB 查询（含标题/歌手，供跨源搜索降级使用）
  const song = await prisma.song.findUnique({
    where: { id: trackId },
    select: { audioUrl: true, urlExpiresAt: true, platform: true, title: true, artist: true },
  });
  if (!song) return null;

  // 已有 audioUrl 时：未过期直接返回；过期但可达则延长并返回
  if (song.audioUrl) {
    // URL 未过期 → 直接返回
    if (song.urlExpiresAt && song.urlExpiresAt.getTime() > Date.now()) {
      return song.audioUrl;
    }

    // URL 已过期，但很多网易云 URL 过期后仍可用 → 先 HEAD 验证
    const stillPlayable = await checkUrlReachable(song.audioUrl);
    if (stillPlayable) {
      // 更新过期时间（延长1小时）
      await prisma.song.update({
        where: { id: trackId },
        data: { urlExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      }).catch(() => {});
      return song.audioUrl;
    }
  }

  // 3. URL 确实失效/为空，尝试 Python 脚本按原生 ID 刷新
  const execScriptPath = path.resolve(process.cwd(), '..', 'tools', 'refresh_song_url.py');
  try {
    const platform = song.platform || trackId.split(':')[0] || 'netease';
    const { stdout } = await runPython([execScriptPath, trackId], { timeout: DOWNLOAD_TIMEOUT });
    const result = JSON.parse(stdout);
    if (result.success && result.url) {
      // 更新 DB 和缓存
      await prisma.song.update({
        where: { id: trackId },
        data: {
          audioUrl: result.url,
          playable: true,
          urlSource: platform,
          urlCheckedAt: new Date(),
          urlExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          urlRefreshCount: { increment: 1 },
        },
      });
      await withRedis(async (redis) => {
        await redis.set(`url:cache:${trackId}`, JSON.stringify({
          url: result.url, source: platform, fetchedAt: Date.now(),
          expiresAt: Date.now() + 30 * 60 * 1000,
        }), 'EX', 1800);
      }, undefined);
      return result.url;
    }
  } catch (err) {
    console.error(`[AUDIO-CACHE] Python刷新失败 ${trackId}:`, err instanceof Error ? err.message : err);
  }

  // 4. 跨源搜索：按标题+歌手在网易云搜索替代（qq/酷狗歌曲或网易云 VIP）
  if (song.title) {
    const searchScriptPath = path.resolve(process.cwd(), '..', 'tools', 'search_song_url.py');
    try {
      const { stdout } = await runPython([searchScriptPath, song.title, song.artist || ''], { timeout: DOWNLOAD_TIMEOUT });
      const result = JSON.parse(stdout);
      if (result.success && result.url) {
        await prisma.song.update({
          where: { id: trackId },
          data: {
            audioUrl: result.url,
            playable: true,
            urlSource: 'netease-search',
            urlCheckedAt: new Date(),
            urlExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
            urlRefreshCount: { increment: 1 },
          },
        }).catch(() => {});
        await withRedis(async (redis) => {
          await redis.set(`url:cache:${trackId}`, JSON.stringify({
            url: result.url, source: 'netease-search', fetchedAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000,
          }), 'EX', 1800);
        }, undefined);
        return result.url;
      }
    } catch (err) {
      console.error(`[AUDIO-CACHE] 跨源搜索失败 ${trackId}:`, err instanceof Error ? err.message : err);
    }
  }

  // 5. 全部失败 → 返回 null
  console.warn(`[AUDIO-CACHE] 所有刷新方式失败: ${trackId}`);
  return null;
}

/**
 * GET Range 请求验证 URL 是否可达（比 HEAD 更可靠，网易云CDN可能拒绝HEAD但接受GET Range）
 */
async function checkUrlReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      timeout: 8000,
      headers: { 'Range': 'bytes=0-1023' }
    }, (res) => {
      // 消费掉响应体，避免连接泄漏
      res.resume();
      resolve(res.statusCode === 200 || res.statusCode === 206);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * 确保音频文件已缓存到本地（并发安全：同一曲目同时只跑一个下载，其余请求复用结果）
 * @returns 本地文件路径，或 null（下载失败）
 */
const inflightDownloads = new Map<string, Promise<string | null>>();

export function ensureCached(trackId: string): Promise<string | null> {
  const existing = inflightDownloads.get(trackId);
  if (existing) return existing;
  const task = ensureCachedInner(trackId).finally(() => {
    inflightDownloads.delete(trackId);
  });
  inflightDownloads.set(trackId, task);
  return task;
}

async function ensureCachedInner(trackId: string): Promise<string | null> {
  // 内存缓存命中 → 直接返回
  if (memCache.has(trackId)) {
    return getCachePath(trackId);
  }
  // 磁盘缓存命中 → 加载到内存并返回
  if (isCached(trackId)) {
    const p = getCachePath(trackId);
    touchDiskCache(trackId); // 更新 mtime，供磁盘 LRU 淘汰判断
    try {
      const buf = fs.readFileSync(p);
      memCacheSet(trackId, buf);
    } catch { /* ignore */ }
    return p;
  }

  // 获取网易云 URL
  const neteaseUrl = await getNeteaseUrl(trackId);
  if (!neteaseUrl) return null;

  // 下载到本地
  await acquireDownloadSlot();
  try {
    // 双重检查（等待期间可能已被其他请求缓存）
    if (isCached(trackId)) {
      return getCachePath(trackId);
    }

    ensureCacheDir();
    const destPath = getCachePath(trackId);
    const ok = await downloadFile(neteaseUrl, destPath);
    if (ok && isCached(trackId)) {
      const size = getCacheSize(trackId);
      console.log(`[AUDIO-CACHE] 缓存成功: ${trackId} (${(size / 1024).toFixed(0)}KB)`);
      // 异步检查磁盘缓存是否超限（超限则 LRU 淘汰）
      void enforceDiskCacheLimit();
      // 加载到内存缓存
      try {
        const buf = fs.readFileSync(getCachePath(trackId));
        memCacheSet(trackId, buf);
      } catch { /* ignore */ }
      // 异步更新 DB 中的本地路径标记（不阻塞返回）
      prisma.song.update({
        where: { id: trackId },
        data: { audioUrlMp3: destPath },
      }).catch(() => {});
      return destPath;
    }
    console.warn(`[AUDIO-CACHE] 下载失败或文件过小: ${trackId}`);
    return null;
  } finally {
    releaseDownloadSlot();
  }
}

/**
 * 找到一个可播放的替代歌曲（排除当前歌曲）
 */
async function findFallbackTrack(excludeId: string): Promise<{ id: string } | null> {
  try {
    const song = await prisma.song.findFirst({
      where: {
        id: { not: excludeId },
        playable: true,
        archived: false,
        audioUrl: { not: '' },
      },
      orderBy: { hotScore: 'desc' },
      select: { id: true },
    });
    return song;
  } catch {
    return null;
  }
}

/**
 * 流式代理音频请求（支持 Range 请求，用于播放器拖拽进度条）
 * 优先从本地缓存返回，未命中则实时代理网易云并后台缓存
 */
export async function serveAudio(
  trackId: string,
  reqRange: string | undefined,
  res: {
    status: (code: number) => any;
    setHeader: (name: string, value: string | number) => void;
    pipe?: (stream: fs.ReadStream) => void;
  } & NodeJS.WritableStream,
): Promise<void> {
  // 1. 尝试内存缓存（最快）
  const memBuf = memCacheGet(trackId);
  if (memBuf) {
    res.setHeader('X-Audio-Source', 'memory-cache');
    return serveBuffer(memBuf, reqRange, res);
  }

  // 2. 尝试本地磁盘缓存
  if (isCached(trackId)) {
    const filePath = getCachePath(trackId);
    touchDiskCache(trackId); // 更新 mtime，供磁盘 LRU 淘汰判断
    // 异步加载到内存（下次命中更快）
    try {
      const buf = fs.readFileSync(filePath);
      memCacheSet(trackId, buf);
    } catch { /* ignore */ }
    return serveLocalFile(filePath, reqRange, res);
  }

  // 3. 缓存未命中 → Source-Adapter 解析（曲库文件/自托管源/Jamendo；默认不再走网易爬取）
  const { resolveTrackAudio } = require('../library/audio-source.service');
  let neteaseUrl: string | null = null;
  let libraryFilePath: string | null = null;
  try {
    const resolved = await resolveTrackAudio(trackId);
    if (resolved.kind === 'library') {
      libraryFilePath = resolved.filePath;
    } else if (resolved.kind === 'remote') {
      neteaseUrl = resolved.url;
    }
  } catch (resolveErr) {
    console.warn(`[AUDIO-CACHE] 来源解析失败: ${trackId}`, resolveErr instanceof Error ? resolveErr.message : resolveErr);
  }

  // 3a. 曲库永久资产：直接本地文件服务（零网络、不被 LRU 淘汰）
  if (libraryFilePath) {
    console.log(`[AUDIO-CACHE] 曲库直供: ${trackId}`);
    return serveLocalFile(libraryFilePath, reqRange, res, 'library');
  }

  // 3b. 旧网易路径（仅 ENABLE_NETEASE_FALLBACK=true 时启用，默认关闭）
  if (!neteaseUrl && config.neteaseFallbackEnabled) {
    for (let attempt = 0; attempt < 3; attempt++) {
      neteaseUrl = await getNeteaseUrl(trackId);
      if (neteaseUrl) break;
      if (attempt < 2) {
        console.warn(`[AUDIO-CACHE] 获取URL失败，重试 ${attempt + 1}/3: ${trackId}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  if (!neteaseUrl) {
    // 所有来源均不可用 → 返回404，让前端走正常的错误处理流程
    // 不再使用302重定向，避免播放错误歌曲且UI不同步
    console.warn(`[AUDIO-CACHE] 无可用音频来源，返回404: ${trackId}`);
    res.status(404).json({ error: '音频资源不可用', trackId });
    return;
  }

  // 实时代理（单请求：同时转发给客户端并缓存到本地）
  return new Promise((resolve) => {
    const mod = neteaseUrl.startsWith('https') ? https : http;
    const headers: Record<string, string> = {};
    if (reqRange) headers['Range'] = reqRange;

    const req = mod.get(neteaseUrl, { headers, timeout: 15000 }, (upstream) => {
      // 跟随重定向
      if (upstream.statusCode && upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        serveAudio(trackId, reqRange, res).then(resolve);
        return;
      }
      if (upstream.statusCode && upstream.statusCode >= 400) {
        console.warn(`[AUDIO-CACHE] 上游返回 ${upstream.statusCode}，尝试回退: ${trackId}`);
        res.status(502).end('音频资源暂时不可用，请稍后重试');
        resolve();
        return;
      }

      // 设置响应头
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', upstream.headers['content-length']);
      }
      if (upstream.headers['content-range']) {
        res.setHeader('Content-Range', upstream.headers['content-range']);
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(upstream.statusCode || 200);

      // 流式传输给客户端 + 后台缓存（单请求，无竞态）
      if (!reqRange) {
        // 非Range请求：使用PassThrough分流，同时转发给客户端和写入本地缓存
        const { PassThrough } = require('stream');
        const tee = new PassThrough();
        upstream.pipe(tee);
        tee.pipe(res as any);
        ensureCacheDir();
        const tmpPath = getCachePath(trackId) + '.tmp';
        const ws = fs.createWriteStream(tmpPath);
        tee.pipe(ws);
        tee.on('end', () => {
          try {
            fs.renameSync(tmpPath, getCachePath(trackId));
            console.log(`[AUDIO-CACHE] 后台缓存完成: ${trackId}`);
            void enforceDiskCacheLimit(); // 异步检查磁盘缓存是否超限
          } catch { /* ignore */ }
          resolve();
        });
        tee.on('error', () => {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          resolve();
        });
      } else {
        // Range请求：直接转发，不缓存
        upstream.pipe(res as any);
        upstream.on('end', () => resolve());
        upstream.on('error', () => resolve());
      }
    });

    req.on('error', () => {
      res.status(502).end('无法连接音频服务');
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      res.status(504).end('音频服务响应超时');
      resolve();
    });
  });
}

/**
 * 预检测音频URL有效性（不下载，只验证）
 */
export async function checkAudioUrl(trackId: string): Promise<{
  valid: boolean;
  source: 'memory-cache' | 'disk-cache' | 'remote' | 'none';
  reason?: string;
}> {
  // 1. 内存缓存
  const memBuf = memCacheGet(trackId);
  if (memBuf) return { valid: true, source: 'memory-cache' };

  // 2. 磁盘缓存
  if (isCached(trackId)) return { valid: true, source: 'disk-cache' };

  // 3. 远程URL检测
  const url = await getNeteaseUrl(trackId);
  if (!url) return { valid: false, source: 'none', reason: 'url_unavailable' };

  const reachable = await checkUrlReachable(url);
  if (reachable) return { valid: true, source: 'remote' };

  return { valid: false, source: 'none', reason: 'url_unreachable' };
}

/**
 * 从内存 Buffer 提供音频（最快，支持 Range 请求）
 */
function serveBuffer(
  buf: Buffer,
  reqRange: string | undefined,
  res: any,
): void {
  const fileSize = buf.length;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=604800');

  if (reqRange) {
    const parts = reqRange.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    res.end(buf.subarray(start, end + 1));
  } else {
    res.status(200);
    res.setHeader('Content-Length', fileSize);
    res.end(buf);
  }
}

/**
 * 从本地文件提供音频（支持 Range 请求）
 */
function serveLocalFile(
  filePath: string,
  reqRange: string | undefined,
  res: any,
  sourceHeader: string = 'local-cache',
): void {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=604800'); // 7天浏览器缓存
  res.setHeader('X-Audio-Source', sourceHeader);

  if (reqRange) {
    const parts = reqRange.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.status(200);
    res.setHeader('Content-Length', fileSize);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}

// ---------------------------------------------------------------------------
// 批量预下载
// ---------------------------------------------------------------------------

/**
 * 预下载热门歌曲到本地缓存
 * @param limit 最多下载多少首
 * @returns 成功下载的数量
 */
export async function preDownloadPopular(limit: number = 20): Promise<number> {
  // 防止重复触发
  if (downloadProgress.active) {
    console.log('[AUDIO-CACHE] 已有下载任务进行中，跳过');
    return 0;
  }

  // 查找热门但未缓存的歌曲
  let songs: { id: string; title: string | null }[];
  try {
    songs = await prisma.song.findMany({
      where: {
        archived: false,
        playable: true,
        audioUrl: { not: '' },
      },
      orderBy: { hotScore: 'desc' },
      take: Math.max(limit * 10, 100), // 多取一些，确保能找到未缓存的歌曲
    });
  } catch (err) {
    console.error('[AUDIO-CACHE] 查询歌曲失败:', err);
    return 0;
  }

  const uncached = songs.filter((s) => !isCached(s.id)).slice(0, limit);
  if (uncached.length === 0) {
    console.log('[AUDIO-CACHE] 所有热门歌曲已缓存');
    return 0;
  }

  // 初始化进度
  downloadProgress = {
    active: true,
    total: uncached.length,
    completed: 0,
    success: 0,
    failed: 0,
    currentSong: uncached[0]?.title || uncached[0]?.id || '',
    startedAt: Date.now(),
  };

  try {
    console.log(`[AUDIO-CACHE] 开始预下载 ${uncached.length} 首热门歌曲`);
    for (const song of uncached) {
      downloadProgress.currentSong = song.title || song.id;
      try {
        const result = await ensureCached(song.id);
        downloadProgress.completed++;
        if (result) {
          downloadProgress.success++;
        } else {
          downloadProgress.failed++;
        }
      } catch (err) {
        console.error(`[AUDIO-CACHE] 下载失败 ${song.id}:`, err);
        downloadProgress.completed++;
        downloadProgress.failed++;
      }
    }
    console.log(`[AUDIO-CACHE] 预下载完成: ${downloadProgress.success}/${uncached.length} 成功`);
  } finally {
    // 确保无论成功还是失败，都重置 active 状态
    downloadProgress.active = false;
  }
  return downloadProgress.success;
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): {
  totalFiles: number;
  totalSizeMB: number;
  maxSizeMB: number;
  evictions: number;
  cacheDir: string;
  cacheFiles: string[];
} {
  ensureCacheDir();
  const files = fs.readdirSync(AUDIO_CACHE_DIR).filter((f) => f.endsWith('.mp3'));
  let totalSize = 0;
  for (const f of files) {
    try {
      totalSize += fs.statSync(path.join(AUDIO_CACHE_DIR, f)).size;
    } catch { /* ignore */ }
  }
  return {
    totalFiles: files.length,
    totalSizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10,
    maxSizeMB: Math.round(DISK_CACHE_MAX_BYTES / 1024 / 1024),
    evictions: diskEvictionCount,
    cacheDir: AUDIO_CACHE_DIR,
    cacheFiles: files,
  };
}

/**
 * 手动触发一次磁盘缓存上限检查（供管理接口调用，force 绕过节流）
 */
export function enforceDiskCacheLimitNow(): Promise<void> {
  return enforceDiskCacheLimit(true);
}

/**
 * 统计可播放歌曲中有多少已缓存到本地
 * 正向查询：遍历可播放歌曲，检查缓存文件是否存在（避免文件名反推的有损映射）
 */
export async function getCachedPlayableCount(): Promise<number> {
  const songs = await prisma.song.findMany({
    where: { archived: false, playable: true },
    select: { id: true },
  });
  let count = 0;
  for (const song of songs) {
    const cachePath = getCachePath(song.id);
    if (fs.existsSync(cachePath)) {
      count++;
    }
  }
  return count;
}

/**
 * 记录音频播放错误
 */
export async function logAudioError(params: {
  trackId: string;
  userId?: number;
  errorType: string;
  urlSource?: string;
  statusCode?: number;
  userAgent?: string;
  details?: string;
}): Promise<void> {
  try {
    await prisma.audioErrorLog.create({
      data: {
        trackId: params.trackId,
        userId: params.userId,
        errorType: params.errorType,
        urlSource: params.urlSource,
        statusCode: params.statusCode,
        userAgent: params.userAgent,
        details: params.details,
      },
    });
    // 同时更新Song表的urlFailureCount
    await prisma.song.update({
      where: { id: params.trackId },
      data: {
        urlLastFailure: new Date(),
        urlFailureCount: { increment: 1 },
      },
    }).catch(() => {});
  } catch (err) {
    console.error('[AUDIO-CACHE] 记录错误日志失败:', err);
  }
}
