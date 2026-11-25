/**
 * Jamendo 接入服务（2026-11-18 三层供给架构 · 方案 C + 方案 A 下载管线）
 *
 * Jamendo 是官方 CC 授权音乐平台（https://developer.jamendo.com）：
 *  - 搜索/流媒体/下载均有官方 API 授权，audiodownload 链接持久有效
 *  - 曲目自带 genre/mood 标签，可直接映射进 song_genres/song_moods
 *
 * 运行模式：
 *  - 真实模式：config.jamendo.clientId 非空（JAMENDO_CLIENT_ID 环境变量）
 *  - stub 模式：未配置 client_id，所有网络调用直接返回明确提示，不发起请求
 *
 * 入库红线（复用 audio-validate）：容器魔数 / 时长 / 试听片段 / 码率校验全部通过才允许入库，
 * 并强制写入 audio_licenses 授权登记。
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import prisma from '../../lib/prisma';
import { config } from '../../config';
import { validateAudioFile } from './audio-validate';
import { trackIdToLibraryFilename } from './audio-source.service';

const DOWNLOAD_TIMEOUT = 60_000;

export function isJamendoConfigured(): boolean {
  return Boolean(config.jamendo.clientId);
}

function stubResult<T>(action: string): { ok: false; stub: true; reason: string; data?: T } {
  return {
    ok: false,
    stub: true,
    reason: `JAMENDO_CLIENT_ID 未配置，${action} 处于 stub 模式。请在 developer.jamendo.com 注册应用后设置环境变量 JAMENDO_CLIENT_ID`,
  };
}

/** GET 请求（跟随一次重定向），超时 60s */
function httpGetBuffer(url: string, maxBytes = 30 * 1024 * 1024): Promise<{ status: number; body: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: DOWNLOAD_TIMEOUT }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGetBuffer(new URL(res.headers.location, url).toString(), maxBytes).then(resolve, reject);
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (d: Buffer) => {
        size += d.length;
        if (size > maxBytes) { req.destroy(); reject(new Error('response_too_large')); return; }
        chunks.push(d);
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

interface JamendoTrack {
  id: string;
  name: string;
  artist_name?: string;
  artist_site?: string;
  album_name?: string;
  album_image?: string;
  duration: number;      // 秒
  license_ccurl?: string;
  audiodownload?: string;
  audiodownload_allowed: boolean;
  audio?: string;
  tags?: string[];
}

export interface JamendoSearchResult {
  ok: boolean;
  stub?: boolean;
  reason?: string;
  tracks: Array<Partial<JamendoTrack>>;
}

/** 展平 Jamendo musicinfo.tags 嵌套结构（genres/instruments/vartags）为字符串数组 */
function flattenTags(t: any): string[] {
  const tg = t?.musicinfo?.tags;
  if (!tg) return [];
  return [...(tg.genres || []), ...(tg.instruments || []), ...(tg.vartags || [])];
}

/** 搜索 CC 曲目（tag 可传 genre/instrument/mood，见 Jamendo 文档）
 *  2026-11-20 搜索升级：新增 opts.groupby（默认 true 保持既有导入管线行为不变）。
 *  旧实现（保留备查）：恒带 groupby: 'artist_id' —— 每位歌手只返回 1 首，导致
 *  "搜歌手名"场景线上最多命中 1 首该歌手的歌曲；搜索路径现传 groupby=false，
 *  让 Jamendo 按相关性返回该歌手的全部候选歌曲。 */
export async function searchJamendoTracks(opts: { q?: string; tag?: string; limit?: number; offset?: number; groupby?: boolean }): Promise<JamendoSearchResult> {
  if (!isJamendoConfigured()) return { ...stubResult<JamendoTrack[]>('搜索'), tracks: [] };
  const limit = Math.min(opts.limit ?? 20, config.jamendo.maxImportCount);
  const params = new URLSearchParams({
    client_id: config.jamendo.clientId,
    format: 'json',
    limit: String(limit),
    offset: String(opts.offset ?? 0),
    audioformat: 'mp32',
    audiodownload_allowed: 'true',
    // 注意：Jamendo API 存在怪癖，双 include（"musicinfo licenses"）配合部分 tags（如 piano）
    // 会返回 0 结果；license_ccurl 是默认字段无需显式 include，故只带 musicinfo
    include: 'musicinfo',
    // 旧实现（保留备查）：groupby: 'artist_id',
    ...(opts.groupby !== false ? { groupby: 'artist_id' } : {}),
  });
  if (opts.q) params.set('search', opts.q);
  if (opts.tag) params.set('tags', opts.tag);
  const url = `${config.jamendo.apiBase}/tracks/?${params.toString()}`;
  // Jamendo API 实测怪癖：同一 URL 约 50% 概率返回空 results（status 仍 success，与 UA 无关），
  // 因此对"成功但空"的响应做最多 3 次重试（真无结果的标签重试后仍为空，语义不受影响）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status, body } = await httpGetBuffer(url, 5 * 1024 * 1024);
      if (status !== 200) return { ok: false, reason: `api_http_${status}`, tracks: [] };
      const json = JSON.parse(body.toString('utf8'));
      const results = json.results || [];
      if (results.length > 0 || attempt === 2) {
        return { ok: true, tracks: results.map((t: any) => ({ ...t, tags: flattenTags(t) })) };
      }
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    } catch (e: any) {
      if (attempt === 2) return { ok: false, reason: e.message, tracks: [] };
    }
  }
  return { ok: true, tracks: [] };
}

export interface ImportOutcome {
  ok: boolean;
  imported: number;
  skipped: Array<{ trackId: string; reason: string }>;
  stub?: boolean;
  reason?: string;
}

/**
 * 导入曲目到曲库（按 id 查询详情后走通用管线）
 */
export async function importJamendoTracks(trackIds: string[]): Promise<ImportOutcome> {
  if (!isJamendoConfigured()) return { imported: 0, skipped: [], ...stubResult('导入') };
  if (!trackIds.length || trackIds.length > config.jamendo.maxImportCount) {
    return { ok: false, imported: 0, skipped: [{ trackId: '*', reason: `count_out_of_range(1..${config.jamendo.maxImportCount})` }] };
  }

  const params = new URLSearchParams({
    client_id: config.jamendo.clientId,
    format: 'json',
    id: trackIds.join(','),
    audioformat: 'mp32',
    audiodownload_allowed: 'true',
    include: 'musicinfo', // 单 include 避开 Jamendo 双 include + tags 的 0 结果怪癖
  });
  let tracks: JamendoTrack[] = [];
  const detailUrl = `${config.jamendo.apiBase}/tracks/?${params.toString()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status, body } = await httpGetBuffer(detailUrl, 5 * 1024 * 1024);
      if (status !== 200) return { ok: false, imported: 0, skipped: [{ trackId: '*', reason: `api_http_${status}` }] };
      tracks = JSON.parse(body.toString('utf8')).results || [];
      if (tracks.length > 0 || attempt === 2) break;
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); // 同搜索：空结果重试
    } catch (e: any) {
      if (attempt === 2) return { ok: false, imported: 0, skipped: [{ trackId: '*', reason: e.message }] };
    }
  }
  return importTrackObjects(tracks);
}

/**
 * 通用导入管线：下载 → 四道校验（魔数/时长/试听/码率）→ 入库 songs + song_genres/song_moods + audio_licenses
 * 直接接收搜索结果对象（importByTag 路径零二次 API 调用，绕开 Jamendo 间歇空响应怪癖）
 */
export async function importTrackObjects(tracks: Array<Partial<JamendoTrack>>): Promise<ImportOutcome> {
  if (!isJamendoConfigured()) return { imported: 0, skipped: [], ...stubResult('导入') };
  if (tracks.length > config.jamendo.maxImportCount) {
    return { ok: false, imported: 0, skipped: [{ trackId: '*', reason: `count_out_of_range(1..${config.jamendo.maxImportCount})` }] };
  }

  fs.mkdirSync(config.audioLibraryDir, { recursive: true });
  const outcome: ImportOutcome = { ok: true, imported: 0, skipped: [] };

  for (const t of tracks) {
    const jamendoId = `jamendo:${t.id}`;
    const fileName = trackIdToLibraryFilename(jamendoId);
    const destPath = path.join(config.audioLibraryDir, fileName);
    try {
      // 1. 下载（audiodownload 持久链接，CC 授权允许）
      const dl = t.audiodownload || t.audio;
      if (!dl) { outcome.skipped.push({ trackId: jamendoId, reason: 'no_download_url' }); continue; }
      if (!t.audiodownload_allowed) { outcome.skipped.push({ trackId: jamendoId, reason: 'download_not_allowed' }); continue; }
      const { status, body } = await httpGetBuffer(dl);
      if (status !== 200 || body.length < 100_000) {
        outcome.skipped.push({ trackId: jamendoId, reason: `download_failed(${status},${body.length}B)` });
        continue;
      }
      const tmpPath = destPath + '.tmp';
      fs.writeFileSync(tmpPath, body);

      // 2. 四道校验（试听红线在 validateAudioFile 内）
      const meta = t.duration && t.duration > 0 ? t.duration : null;
      const v = validateAudioFile(tmpPath, meta);
      if (!v.ok) {
        fs.unlinkSync(tmpPath);
        outcome.skipped.push({ trackId: jamendoId, reason: `validate:${v.reason}` });
        continue;
      }

      fs.renameSync(tmpPath, destPath);

      // 3. 入库（upsert 幂等）+ license 登记 + 标签映射
      const songData = {
        title: (t.name || 'Unknown').slice(0, 200),
        artist: (t.artist_name || 'Unknown').slice(0, 200),
        album: t.album_name ? t.album_name.slice(0, 200) : null,
        albumCover: t.album_image || null,
        audioUrl: `/audio-lib/${fileName}`,
        duration: Math.round(v.seconds ?? 0) || null,
        platform: 'jamendo',
        playable: true,
        dataSource: 'api' as const,
        urlSource: 'jamendo',
        sourceUrl: t.license_ccurl || null,
        urlCheckedAt: new Date(),
      };
      await prisma.song.upsert({
        where: { id: jamendoId },
        create: { id: jamendoId, ...songData },
        update: songData,
      });

      await prisma.audioLicense.upsert({
        where: { songId: jamendoId },
        create: {
          songId: jamendoId,
          source: 'jamendo',
          licenseType: 'CC',
          sourcePage: t.license_ccurl || null,
          artistPage: t.artist_site || null,
        },
        update: { licenseType: 'CC', sourcePage: t.license_ccurl || null },
      });

      // 4. 标签映射（genre → song_genres，mood/instrument 归入 song_moods）
      if (t.tags?.length) await mapJamendoTags(jamendoId, t.tags);

      // 5. 中性声学特征占位（genome 相似度推荐 join song_features，缺行会被排除；
      //    语义维度由运行时 extractor 从标签生成，声学维度先给中性值 0.5）
      await prisma.$executeRawUnsafe(
        `insert into song_features (song_id, "subBass", bass, "lowMid", mid, "highMid", presence, brilliance, air, bpm, computed_at)
         values ($1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, now()) on conflict (song_id) do nothing`,
        jamendoId,
      ).catch(() => { /* 特征占位失败不阻塞导入 */ });

      outcome.imported++;
    } catch (e: any) {
      try { if (fs.existsSync(destPath + '.tmp')) fs.unlinkSync(destPath + '.tmp'); } catch { /* ignore */ }
      outcome.skipped.push({ trackId: jamendoId, reason: e.message?.slice(0, 80) || 'import_error' });
    }
  }
  return outcome;
}

const GENRE_TAG_MAP: Record<string, string> = {
  pop: '流行', rock: '摇滚', folk: '民谣', electronic: '电子', hiphop: '嘻哈',
  jazz: '爵士', classical: '古典', metal: '金属', ambient: '氛围', blues: '蓝调',
  country: '乡村', rnb: 'R&B', soundtrack: '原声', world: '世界音乐', punk: '朋克',
  reggae: '雷鬼', dance: '舞曲', latin: '拉丁', acoustic: '原声', experimental: '实验',
};

/** Jamendo 标签 → 本库维度表映射（genres/moods 维度按 name 查找，不存在自动创建） */
async function mapJamendoTags(songId: string, tags: string[]): Promise<void> {
  for (const raw of tags.slice(0, 8)) {
    const tag = raw.toLowerCase().trim();
    if (!tag) continue;
    const isGenre = tag in GENRE_TAG_MAP;
    try {
      if (isGenre) {
        const name = GENRE_TAG_MAP[tag];
        let g = await prisma.genre.findFirst({ where: { name } });
        if (!g) g = await prisma.genre.create({ data: { name, level: 1 } });
        await prisma.songGenre.upsert({
          where: { songId_genreId: { songId, genreId: g.id } },
          create: { songId, genreId: g.id },
          update: {},
        });
      } else {
        let m = await prisma.mood.findFirst({ where: { name: tag } });
        if (!m) m = await prisma.mood.create({ data: { name: tag } });
        await prisma.songMood.upsert({
          where: { songId_moodId: { songId, moodId: m.id } },
          create: { songId, moodId: m.id },
          update: {},
        });
      }
    } catch { /* 标签映射失败不阻塞导入 */ }
  }
}

/** 按 tag 抓取一批可下载曲目并导入（补库入口） */
export async function importByTag(tag: string, count: number): Promise<ImportOutcome> {
  if (!isJamendoConfigured()) return { imported: 0, skipped: [], ...stubResult('按标签导入') };
  const search = await searchJamendoTracks({ tag, limit: Math.min(count, config.jamendo.maxImportCount) });
  if (!search.ok) return { ok: false, imported: 0, skipped: [{ trackId: '*', reason: search.reason || 'search_failed' }] };
  // 过滤：允许下载 + 时长 >= 60s（粗筛，细校验在导入管线）；
  // 直接把搜索结果对象传给导入管线（避免二次 API 调用触发 Jamendo 间歇空响应）
  const eligible = search.tracks
    .filter((t: any) => t.audiodownload_allowed && (t.duration ?? 0) >= 60)
    .slice(0, count);
  return importTrackObjects(eligible);
}
