import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { authenticate, authorize } from '../../middleware/auth';
import { config } from '../../config';
import prisma from '../../lib/prisma';
import { isJamendoConfigured, searchJamendoTracks, importByTag, importJamendoTracks } from './jamendo.service';
import { getLibraryStats, isInLibrary } from './audio-source.service';

/**
 * 音频来源管理路由（2026-11-18 三层供给架构）
 * 挂载点：app.use('/api/audio-source', audioSourceRoutes)
 *
 * GET  /status                    曲库/缓存/授权覆盖统计（公开）
 * GET  /jamendo/search            Jamendo CC 曲目搜索（stub 模式返回提示）
 * POST /jamendo/import            导入指定曲目（管理员）
 * POST /jamendo/import-by-tag     按标签批量补库（管理员）
 * POST /library/publish           把磁盘缓存编目为曲库永久资产（管理员，硬链接零拷贝）
 */
const router = Router();

// ---- 状态 ----
router.get('/status', async (_req: Request, res: Response) => {
  const lib = getLibraryStats();
  const [cacheFiles] = await Promise.all([
    prisma.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::int n from songs`),
  ]);
  const bySource = await prisma.$queryRawUnsafe<{ url_source: string | null; n: number }[]>(
    `select url_source, count(*)::int n from songs group by 1 order by 2 desc`,
  );
  const total = Number(cacheFiles[0].n);
  const licensed = await prisma.audioLicense.count();
  const inLibrary = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `select count(*)::int n from songs where url_source = 'self-hosted' and playable = true`,
  );
  res.json({
    success: true,
    data: {
      library: lib,
      songsTotal: total,
      byUrlSource: bySource,
      licensed,
      licenseCoverage: total > 0 ? Math.round((licensed / total) * 100) : 0,
      selfHostedPlayable: inLibrary[0].n,
      jamendoConfigured: isJamendoConfigured(),
      neteaseFallbackEnabled: config.neteaseFallbackEnabled,
    },
  });
});

// ---- Jamendo 搜索 ----
router.get('/jamendo/search', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
  const tag = typeof req.query.tag === 'string' ? req.query.tag.slice(0, 50) : undefined;
  const limit = Math.min(Number(req.query.limit) || 20, config.jamendo.maxImportCount);
  const result = await searchJamendoTracks({ q, tag, limit });
  res.json({ success: result.ok, stub: result.stub || false, reason: result.reason, data: result.tracks });
});

// ---- Jamendo 导入 ----
router.post('/jamendo/import', authenticate, authorize('admin', 'super_admin'), async (req: Request, res: Response) => {
  const ids: unknown = req.body?.trackIds;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    return res.status(400).json({ error: 'trackIds: string[] required' });
  }
  const outcome = await importJamendoTracks(ids as string[]);
  res.json({ success: outcome.ok, stub: outcome.stub || false, reason: outcome.reason, ...outcome });
});

router.post('/jamendo/import-by-tag', authenticate, authorize('admin', 'super_admin'), async (req: Request, res: Response) => {
  const tag = typeof req.body?.tag === 'string' ? req.body.tag.slice(0, 50) : '';
  const count = Math.min(Number(req.body?.count) || 10, config.jamendo.maxImportCount);
  if (!tag) return res.status(400).json({ error: 'tag required' });
  const outcome = await importByTag(tag, count);
  res.json({ success: outcome.ok, stub: outcome.stub || false, reason: outcome.reason, ...outcome });
});

// ---- 曲库发布（缓存 → 永久曲库；NTFS 硬链接零拷贝） ----
router.post('/library/publish', authenticate, authorize('admin', 'super_admin'), async (_req: Request, res: Response) => {
  const result = await publishCacheToLibrary();
  res.json({ success: true, ...result });
});

import { getCachePath, isCached } from '../audio-cache/audio-cache.service';

/** 把所有有磁盘缓存的歌发布进曲库目录（硬链接优先，跨卷回退复制），并更新 url_source */
async function publishCacheToLibrary(): Promise<{ published: number; linked: number; copied: number; skipped: number; cataloged: number }> {
  fs.mkdirSync(config.audioLibraryDir, { recursive: true });
  const songs = await prisma.song.findMany({ select: { id: true } });
  const publishedIds: string[] = [];
  let linked = 0, copied = 0, skipped = 0;
  for (const s of songs) {
    if (!isCached(s.id)) { skipped++; continue; }
    const dest = path.join(config.audioLibraryDir, path.basename(getCachePath(s.id)));
    if (fs.existsSync(dest)) {
      publishedIds.push(s.id);
      continue;
    }
    try {
      fs.linkSync(getCachePath(s.id), dest);
      linked++;
      publishedIds.push(s.id);
    } catch {
      try {
        fs.copyFileSync(getCachePath(s.id), dest);
        copied++;
        publishedIds.push(s.id);
      } catch { skipped++; }
    }
  }
  // 编目：url_source=self-hosted，audio_url 指向 /audio-lib 相对路径（换端口/域名无需改库）。
  // 文件名规则与 trackIdToLibraryFilename 一致：非 [a-zA-Z0-9_-] 字符替换为 _
  let cataloged = 0;
  if (publishedIds.length) {
    await prisma.$executeRawUnsafe(
      `update songs set url_source = 'self-hosted', audio_url = '/audio-lib/' || regexp_replace(id, '[^a-zA-Z0-9_-]', '_', 'g') || '.mp3', url_checked_at = now(), url_failure_count = 0 where id = any($1::text[])`,
      publishedIds,
    );
    cataloged = publishedIds.length;
  }
  console.log(`[LIBRARY-PUBLISH] cataloged=${cataloged} linked=${linked} copied=${copied} skipped=${skipped}`);
  return { published: publishedIds.length, linked, copied, skipped, cataloged };
}

// 供启动时日志引用：检查曲库就绪数量（内存态，不访问 DB）
router.get('/library/check', (_req: Request, res: Response) => {
  const lib = getLibraryStats();
  const sample = fs.existsSync(lib.dir) ? fs.readdirSync(lib.dir).slice(0, 3) : [];
  res.json({ success: true, data: { ...lib, sampleFiles: sample } });
});

export default router;
