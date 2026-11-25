#!/usr/bin/env node
/**
 * 手动触发音频预下载
 * 用法: node pre-download-audio.cjs [数量]
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..', 'server'));

const { preDownloadPopular, getCacheStats } = require('../server/dist/modules/audio-cache/audio-cache.service');

async function main() {
  const limit = parseInt(process.argv[2] || '10', 10);
  console.log(`开始预下载 ${limit} 首热门歌曲...`);
  const stats = getCacheStats();
  console.log(`当前缓存: ${stats.totalFiles}首, ${stats.totalSizeMB}MB`);
  const start = Date.now();
  const downloaded = await preDownloadPopular(limit);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const newStats = getCacheStats();
  console.log(`预下载完成: ${downloaded}首成功, 耗时${elapsed}s`);
  console.log(`缓存: ${newStats.totalFiles}首, ${newStats.totalSizeMB}MB`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
