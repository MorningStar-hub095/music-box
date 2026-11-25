/**
 * 刷新所有歌曲URL并添加更多歌曲
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');
const API_BASE = 'http://localhost:3000/api';
const VITE_BASE = 'http://localhost:5173';

// HTTP GET 请求
function httpGet(url, timeout = 10000) {
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

// 刷新单首歌曲URL
async function refreshTrackUrl(trackId) {
  try {
    const result = await httpGet(`${VITE_BASE}/api/refresh-track?id=${encodeURIComponent(trackId)}`);
    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function main() {
  console.log('🔄 开始刷新歌曲URL...\n');

  // 1. 读取现有tracks.json
  let tracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  console.log(`📁 当前歌曲数: ${tracks.length}`);

  // 2. 刷新所有歌曲URL
  console.log('\n📡 刷新歌曲URL:');
  let refreshedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    console.log(`  [${i + 1}/${tracks.length}] ${track.title}...`);
    
    const result = await refreshTrackUrl(track.id);
    
    if (result.success) {
      // 更新URL
      if (result.new_url) {
        tracks[i].audioUrl = result.new_url;
      }
      tracks[i].playable = true;
      refreshedCount++;
      console.log(`    ✅ ${result.message}`);
    } else {
      failedCount++;
      console.log(`    ❌ ${result.message}`);
    }
    
    // 添加延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n📊 刷新结果: ${refreshedCount} 成功, ${failedCount} 失败`);

  // 3. 从数据库获取更多歌曲
  console.log('\n📥 从数据库获取更多歌曲...');
  let dbSongs = [];
  try {
    const response = await httpGet(`${API_BASE}/songs?limit=100`);
    if (response.success && response.data && response.data.songs) {
      dbSongs = response.data.songs;
    }
  } catch (e) {
    console.error('❌ 获取API数据失败:', e.message);
  }

  // 4. 筛选netease平台且不在当前列表中的歌曲
  const existingIds = new Set(tracks.map(t => t.id));
  const newSongs = dbSongs.filter(s => 
    s.platform === 'netease' && 
    !existingIds.has(s.id) &&
    s.audioUrl && 
    !s.audioUrl.includes('example.com')
  ).slice(0, 20 - tracks.length);

  console.log(`🎵 找到 ${newSongs.length} 首新歌曲可添加`);

  // 5. 添加新歌曲
  if (newSongs.length > 0) {
    const newTracks = newSongs.map(song => ({
      id: song.id,
      platform: song.platform,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      albumCover: song.albumCover || '',
      lyricContent: song.lyricContent || '',
      audioUrl: song.audioUrl || '',
      playable: true,
      coverColor: song.coverColor || '#3B82F6',
    }));

    tracks = [...tracks, ...newTracks];
    console.log(`✅ 添加了 ${newTracks.length} 首新歌曲`);
  }

  // 6. 写入更新后的tracks.json
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(tracks, null, 2), 'utf8');

  console.log('\n✅ 更新完成!');
  console.log(`   - 总歌曲数: ${tracks.length}`);
  console.log(`   - 满足播放要求: ${tracks.length >= 20 ? '是' : '否'}`);

  // 7. 显示歌曲列表
  console.log('\n🎵 歌曲列表:');
  tracks.slice(0, 15).forEach((track, i) => {
    console.log(`  ${i + 1}. ${track.title} - ${track.artist}`);
  });
  if (tracks.length > 15) {
    console.log(`  ... 还有 ${tracks.length - 15} 首`);
  }
}

main().catch(err => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
