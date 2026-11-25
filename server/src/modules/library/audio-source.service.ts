/**
 * 音频来源解析层（Source-Adapter，2026-11-18）
 *
 * 三层供给架构（详见 docs/音频数据优化与开源项目调研-20261118.md）：
 *   A 内置曲库  —— audio-library 目录永久资产（随包分发 / Jamendo 导入）
 *   B 自托管源  —— 本地模拟静态路由 /audio-lib，未来平滑切对象存储+CDN
 *   C 在线 API  —— Jamendo CC 授权实时接入（stub 模式待 client_id）
 *
 * 解析优先级（serveAudio 缓存未命中时调用）：
 *   1. 曲库文件存在 → 直接本地文件服务（零网络依赖，不被 LRU 淘汰）
 *   2. url_source='self-hosted' 且 audio_url 非空 → 远程代理（换机/CDN 场景）
 *   3. url_source='jamendo' 且 audio_url 非空 → 远程代理（Jamendo 下载链接持久有效）
 *   4. ENABLE_NETEASE_FALLBACK=true 时走旧网易路径（默认关闭，教学演示用）
 */

import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
import { config } from '../../config';

/** 与 audio-cache.trackIdToFilename 同规则：非安全字符替换为下划线 */
export function trackIdToLibraryFilename(trackId: string): string {
  return trackId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
}

/** 曲库目录内文件完整路径 */
export function getLibraryFilePath(trackId: string): string {
  return path.join(config.audioLibraryDir, trackIdToLibraryFilename(trackId));
}

/** 曲库文件是否存在（>100KB 才算有效，与磁盘缓存同标准） */
export function isInLibrary(trackId: string): boolean {
  try {
    const st = fs.statSync(getLibraryFilePath(trackId));
    return st.isFile() && st.size > 100_000;
  } catch {
    return false;
  }
}

export type ResolvedAudio =
  | { kind: 'library'; filePath: string }
  | { kind: 'remote'; url: string; source: string }
  | { kind: 'none'; reason: string };

/**
 * 解析一首歌的可播音频来源（缓存未命中时的兜底链路）。
 */
export async function resolveTrackAudio(trackId: string): Promise<ResolvedAudio> {
  // 1. 曲库永久资产（最高优先级：本地文件、零网络、不被淘汰）
  if (isInLibrary(trackId)) {
    return { kind: 'library', filePath: getLibraryFilePath(trackId) };
  }

  const song = await prisma.song.findUnique({
    where: { id: trackId },
    select: { audioUrl: true, urlSource: true, platform: true },
  });
  if (!song) return { kind: 'none', reason: 'song_not_found' };

  const url = (song.audioUrl || '').trim();

  // 2/3. 自托管源与 Jamendo：audio_url 即权威播放地址（持久、可授权）
  if (url && (song.urlSource === 'self-hosted' || song.urlSource === 'jamendo')) {
    return { kind: 'remote', url: absolutize(url), source: song.urlSource };
  }

  // 4. 旧网易路径（默认关闭）
  if (config.neteaseFallbackEnabled && (song.platform === 'netease' || song.platform === 'qq')) {
    return { kind: 'none', reason: 'legacy_netease_fallback_disabled_or_unhandled' };
  }

  return { kind: 'none', reason: 'no_available_source' };
}

/** 相对路径（如 /audio-lib/x.mp3）→ 绝对 URL（未来 CDN 场景直接配完整域名） */
function absolutize(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${config.port}`;
  return new URL(url, base).toString();
}

/** 曲库目录统计（供 /api/audio-source/status） */
export function getLibraryStats(): { dir: string; files: number; totalBytes: number } {
  const dir = config.audioLibraryDir;
  let files = 0;
  let totalBytes = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.mp3')) continue;
      try {
        totalBytes += fs.statSync(path.join(dir, f)).size;
        files++;
      } catch { /* ignore */ }
    }
  }
  return { dir, files, totalBytes };
}
