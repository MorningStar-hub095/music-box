#!/usr/bin/env node
/**
 * 批量刷新所有过期 URL
 *
 * 用途：服务器重启后 URL 大面积失效时快速恢复
 * 特点：
 *   - 并发控制（默认 3 个 Python 进程同时运行）
 *   - 优先刷新热门歌曲（按 hotScore 降序）
 *   - 实时进度输出
 *   - 跳过最近 30 分钟内已检查过的歌曲
 *
 * 用法：node scripts/refresh-expired-urls.cjs [并发数] [最大数量]
 * 示例：node scripts/refresh-expired-urls.cjs 3 100
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const SCRIPT_PATH = path.resolve(__dirname, '..', 'tools', 'refresh_song_url.py');
const CONCURRENCY = parseInt(process.argv[2] || '2', 10);
const MAX_SONGS = parseInt(process.argv[3] || '500', 10);
const REFRESH_DEBOUNCE_MS = 30 * 60 * 1000; // 30 分钟内已检查的跳过

// 动态导入 Prisma（从 server 目录加载）
async function getPrisma() {
  // 确保从 server/node_modules 加载 @prisma/client
  const serverPath = path.resolve(__dirname, '..', 'server');
  const { PrismaClient } = require(path.join(serverPath, 'node_modules', '@prisma/client'));
  return new PrismaClient();
}

async function refreshSong(songId) {
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, songId.toString()], {
      timeout: 30000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(stdout.trim());
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  const prisma = await getPrisma();
  const startTime = Date.now();

  try {
    // 步骤1：重置所有 playable=false 的歌曲状态，让新的优化逻辑重新检查
    const RESET = process.argv.includes('--reset');
    if (RESET) {
      const resetCount = await prisma.song.updateMany({
        where: { playable: false, archived: false },
        data: {
          playable: true,
          urlFailureCount: 0,
          urlLastFailure: null,
          urlCheckedAt: null,
        },
      });
      console.log(`已重置 ${resetCount.count} 首歌曲的可播放状态\n`);
    }

    // 查找需要刷新的歌曲：playable=false 或 URL 过期，且最近 30 分钟未检查
    const cutoff = new Date(Date.now() - REFRESH_DEBOUNCE_MS);
    const songs = await prisma.song.findMany({
      where: {
        archived: false,
        AND: [
          {
            OR: [
              { playable: false },
              { urlExpiresAt: { lt: new Date() } },
              { urlCheckedAt: null },
            ],
          },
          {
            OR: [
              { urlCheckedAt: null },
              { urlCheckedAt: { lt: cutoff } },
            ],
          },
        ],
      },
      orderBy: { hotScore: 'desc' },
      take: MAX_SONGS,
      select: { id: true, title: true, artist: true },
    });

    console.log(`\n=== URL 批量刷新工具 ===`);
    console.log(`待刷新: ${songs.length} 首 (并发: ${CONCURRENCY}, 上限: ${MAX_SONGS})\n`);

    if (songs.length === 0) {
      console.log('无需刷新的歌曲');
      return;
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    let completed = 0;

    // 并发控制
    const queue = [...songs];
    const workers = [];

    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const song = queue.shift();
          if (!song) break;

          const result = await refreshSong(song.id);
          completed++;

          if (result.success && result.url) {
            // 更新数据库
            await prisma.song.update({
              where: { id: song.id },
              data: {
                audioUrl: result.url,
                playable: true,
                urlSource: 'netease',
                urlCheckedAt: new Date(),
                urlExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
                urlFailureCount: 0,
                urlLastFailure: null,
                urlRefreshCount: { increment: 1 },
              },
            });
            success++;
            const pct = ((completed / songs.length) * 100).toFixed(1);
            console.log(`  [${completed}/${songs.length}] ${pct}% ✓ ${song.title} - ${song.artist}`);
          } else {
            // 标记失败
            await prisma.song.update({
              where: { id: song.id },
              data: {
                playable: false,
                urlCheckedAt: new Date(),
                urlFailureCount: { increment: 1 },
                urlLastFailure: new Date(),
              },
            });
            failed++;
            const pct = ((completed / songs.length) * 100).toFixed(1);
            console.log(`  [${completed}/${songs.length}] ${pct}% ✗ ${song.title} - ${result.error || '未知错误'}`);
          }
        }
      })());
    }

    await Promise.all(workers);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== 刷新完成 ===`);
    console.log(`成功: ${success} | 失败: ${failed} | 耗时: ${elapsed}s`);
    console.log(`有效率: ${((success / songs.length) * 100).toFixed(1)}%`);

    // 统计总体有效率
    const [total, valid] = await Promise.all([
      prisma.song.count({ where: { archived: false } }),
      prisma.song.count({ where: { archived: false, playable: true } }),
    ]);
    console.log(`\n总体: ${valid}/${total} 首歌曲 URL 有效 (${((valid / total) * 100).toFixed(1)}%)`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('致命错误:', err);
  process.exit(1);
});
