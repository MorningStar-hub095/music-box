/**
 * 清理无效歌曲
 * 移除URL大小 <1MB 的歌曲（45秒预览）
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');

// HEAD 请求验证URL大小
function headCheck(url, timeout = 6000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method: 'HEAD', timeout }, (res) => {
      const size = parseInt(res.headers['content-length'] || '0', 10);
      resolve({ valid: res.statusCode === 200 && size > 1024 * 1024, sizeBytes: size, status: res.statusCode || 0 });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve({ valid: false, sizeBytes: 0, status: 0 }); });
    req.on('error', () => resolve({ valid: false, sizeBytes: 0, status: 0 }));
    req.end();
  });
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主函数
async function main() {
  console.log('🧹 清理无效歌曲...\n');

  // 读取tracks.json
  let tracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  console.log(`📁 原始歌曲数: ${tracks.length}`);

  const validTracks = [];
  const removedTracks = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    
    // 验证URL有效性（>1MB）
    const check = await headCheck(track.audioUrl, 5000);
    
    if (check.valid) {
      validTracks.push(track);
      console.log(`[${i + 1}/${tracks.length}] ✅ ${track.title} (${Math.round(check.sizeBytes / 1024)}KB)`);
    } else {
      removedTracks.push(track);
      console.log(`[${i + 1}/${tracks.length}] ❌ ${track.title} (${Math.round(check.sizeBytes / 1024)}KB) - 移除`);
    }
    
    await delay(50);
  }

  // 保存有效歌曲
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(validTracks, null, 2), 'utf8');

  console.log('\n' + '='.repeat(50));
  console.log('📊 清理统计');
  console.log('='.repeat(50));
  console.log(`✅ 有效歌曲: ${validTracks.length} 首`);
  console.log(`❌ 移除歌曲: ${removedTracks.length} 首`);
  
  if (validTracks.length >= 50) {
    console.log(`🎯 达标状态: ✅ 已达标 (≥50首)`);
  } else {
    console.log(`🎯 达标状态: ❌ 未达标 (需要补充 ${50 - validTracks.length} 首)`);
  }
}

main().catch(err => {
  console.error('❌ 清理失败:', err);
  process.exit(1);
});
