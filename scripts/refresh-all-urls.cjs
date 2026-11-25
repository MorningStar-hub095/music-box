/**
 * 刷新所有歌曲URL
 * 使用audio-refresher插件验证和刷新URL
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');
const VITE_BASE = 'http://localhost:5173';

// HTTP GET 请求
function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON解析失败: ${data.substring(0, 100)}`));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

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

// 刷新单首歌曲URL
async function refreshTrackUrl(trackId) {
  try {
    const result = await httpGet(`${VITE_BASE}/api/refresh-track?id=${encodeURIComponent(trackId)}`);
    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主函数
async function main() {
  console.log('🔄 刷新所有歌曲URL...\n');

  // 读取tracks.json
  let tracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  console.log(`📁 总歌曲数: ${tracks.length}`);

  let refreshedCount = 0;
  let validCount = 0;
  let failedCount = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    
    // 检查当前URL是否有效（>1MB）
    const check = await headCheck(track.audioUrl, 5000);
    
    if (check.valid) {
      validCount++;
      console.log(`[${i + 1}/${tracks.length}] ✅ ${track.title} (${Math.round(check.sizeBytes / 1024)}KB)`);
    } else {
      console.log(`[${i + 1}/${tracks.length}] 🔄 ${track.title} - 刷新中...`);
      
      // 使用audio-refresher刷新URL
      const result = await refreshTrackUrl(track.id);
      
      if (result.success && result.new_url) {
        // 验证新URL
        const newCheck = await headCheck(result.new_url, 5000);
        
        if (newCheck.valid) {
          tracks[i].audioUrl = result.new_url;
          refreshedCount++;
          console.log(`  ✅ 刷新成功 (${Math.round(newCheck.sizeBytes / 1024)}KB)`);
        } else {
          failedCount++;
          console.log(`  ❌ 新URL仍然无效`);
        }
      } else {
        failedCount++;
        console.log(`  ❌ 刷新失败: ${result.message || '未知错误'}`);
      }
    }
    
    await delay(100);
  }

  // 保存更新后的tracks.json
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(tracks, null, 2), 'utf8');

  console.log('\n' + '='.repeat(50));
  console.log('📊 刷新统计');
  console.log('='.repeat(50));
  console.log(`✅ 有效URL: ${validCount} 首`);
  console.log(`🔄 成功刷新: ${refreshedCount} 首`);
  console.log(`❌ 刷新失败: ${failedCount} 首`);
  console.log(`📁 总歌曲数: ${tracks.length}`);
}

main().catch(err => {
  console.error('❌ 刷新失败:', err);
  process.exit(1);
});
