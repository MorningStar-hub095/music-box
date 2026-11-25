#!/usr/bin/env node
/**
 * 全量音频预下载脚本
 * 下载所有可播放歌曲到本地缓存，彻底解决URL失效问题
 *
 * 用法: node scripts/download-all-audio.cjs [并发数] [每批数量]
 * 示例: node scripts/download-all-audio.cjs 3 50
 */

const path = require('path');
const fs = require('fs');

const serverPath = path.resolve(__dirname, '..', 'server');
process.chdir(serverPath);

const CONCURRENCY = parseInt(process.argv[2] || '3', 10);
const BATCH_SIZE = parseInt(process.argv[3] || '100', 10);

async function main() {
  const { PrismaClient } = require(path.join(serverPath, 'node_modules', '@prisma/client'));
  const prisma = new PrismaClient();

  const audioCacheDir = path.resolve(serverPath, 'data', 'audio-cache');
  if (!fs.existsSync(audioCacheDir)) {
    fs.mkdirSync(audioCacheDir, { recursive: true });
  }

  // 统计当前缓存状态
  const cachedFiles = new Set();
  if (fs.existsSync(audioCacheDir)) {
    for (const f of fs.readdirSync(audioCacheDir)) {
      if (f.endsWith('.mp3') && fs.statSync(path.join(audioCacheDir, f)).size > 100000) {
        cachedFiles.add(f.replace('.mp3', ''));
      }
    }
  }
  console.log(`[下载] 当前已缓存: ${cachedFiles.size} 首`);

  // 查找所有可播放但未缓存的歌曲
  const songs = await prisma.song.findMany({
    where: {
      archived: false,
      playable: true,
      audioUrl: { not: '' },
    },
    orderBy: { hotScore: 'desc' },
    select: { id: true, title: true, artist: true, hotScore: true },
  });

  const uncached = songs.filter((s) => {
    const filename = s.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return !cachedFiles.has(filename);
  });

  console.log(`[下载] 总歌曲: ${songs.length}, 已缓存: ${cachedFiles.size}, 待下载: ${uncached.length}`);

  if (uncached.length === 0) {
    console.log('[下载] 所有歌曲已缓存，无需下载');
    await prisma.$disconnect();
    return;
  }

  const toDownload = uncached.slice(0, BATCH_SIZE);
  console.log(`[下载] 本次下载: ${toDownload.length} 首, 并发: ${CONCURRENCY}`);

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();

  // 并发下载
  const queue = [...toDownload];
  const workers = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(downloadWorker(i, queue, audioCacheDir, prisma, (result) => {
      if (result === 'success') success++;
      else if (result === 'failed') failed++;
      else skipped++;
    }));
  }

  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalCached = fs.readdirSync(audioCacheDir).filter(f => f.endsWith('.mp3') && fs.statSync(path.join(audioCacheDir, f)).size > 100000).length;
  const totalSizeMB = fs.readdirSync(audioCacheDir)
    .filter(f => f.endsWith('.mp3'))
    .reduce((sum, f) => sum + fs.statSync(path.join(audioCacheDir, f)).size, 0) / 1024 / 1024;

  console.log('');
  console.log(`[下载] 完成! 耗时: ${elapsed}s`);
  console.log(`[下载] 成功: ${success}, 失败: ${failed}, 跳过: ${skipped}`);
  console.log(`[下载] 缓存总计: ${totalCached} 首, ${totalSizeMB.toFixed(1)}MB`);

  await prisma.$disconnect();
}

async function downloadWorker(workerId, queue, cacheDir, prisma, onResult) {
  while (queue.length > 0) {
    const song = queue.shift();
    if (!song) break;

    const filename = song.id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp3';
    const destPath = path.join(cacheDir, filename);

    try {
      // 获取URL
      const url = await getAudioUrl(song.id, prisma);
      if (!url) {
        onResult('failed');
        continue;
      }

      // 下载
      const ok = await downloadFile(url, destPath);
      if (ok && fs.existsSync(destPath) && fs.statSync(destPath).size > 100000) {
        const sizeKB = (fs.statSync(destPath).size / 1024).toFixed(0);
        process.stdout.write(`\r[Worker${workerId}] ✓ ${song.title} (${sizeKB}KB) | 成功:${queue.length === 0 ? 'done' : queue.length + ' left'}   `);
        onResult('success');
      } else {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        onResult('failed');
      }
    } catch (err) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      onResult('failed');
    }
  }
}

async function getAudioUrl(trackId, prisma) {
  // 1. DB查询
  const song = await prisma.song.findUnique({
    where: { id: trackId },
    select: { audioUrl: true, urlExpiresAt: true },
  });
  if (!song?.audioUrl) return null;

  // 如果URL未过期，直接返回
  if (song.urlExpiresAt && song.urlExpiresAt.getTime() > Date.now() + 60000) {
    return song.audioUrl;
  }

  // 2. Python刷新
  return await refreshUrl(trackId, prisma);
}

async function refreshUrl(trackId, prisma) {
  const { execFile } = require('child_process');
  const scriptPath = path.resolve(__dirname, '..', 'tools', 'refresh_song_url.py');

  return new Promise((resolve) => {
    const child = execFile('python', [scriptPath, trackId], { timeout: 30000 }, async (err, stdout) => {
      if (err) { resolve(null); return; }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.success && result.url) {
          // 更新DB
          await prisma.song.update({
            where: { id: trackId },
            data: {
              audioUrl: result.url,
              playable: true,
              urlCheckedAt: new Date(),
              urlExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
              urlRefreshCount: { increment: 1 },
            },
          }).catch(() => {});
          resolve(result.url);
        } else {
          resolve(null);
        }
      } catch { resolve(null); }
    });
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    let settled = false;
    const settle = (ok) => { if (!settled) { settled = true; resolve(ok); } };

    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, destPath).then(settle);
        return;
      }
      if (res.statusCode !== 200) { settle(false); return; }

      const tmpPath = destPath + '.tmp';
      const ws = fs.createWriteStream(tmpPath);
      const { pipeline } = require('stream/promises');
      pipeline(res, ws).then(() => {
        try {
          fs.renameSync(tmpPath, destPath);
          settle(true);
        } catch { settle(false); }
      }).catch(() => {
        try { fs.unlinkSync(tmpPath); } catch {}
        settle(false);
      });
    });

    req.on('error', () => settle(false));
    req.on('timeout', () => { req.destroy(); settle(false); });
  });
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
