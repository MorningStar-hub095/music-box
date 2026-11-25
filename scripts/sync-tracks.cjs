/**
 * 从API获取真实歌曲数据并同步到tracks.json
 * 只保留netease平台的歌曲（可以被audio-refresher刷新）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');
const API_BASE = 'http://localhost:3000/api';

// HTTP GET 请求
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
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
    }).on('error', reject);
  });
}

async function syncTracks() {
  console.log('🔄 开始同步歌曲数据...\n');

  // 1. 读取现有tracks.json
  let existingTracks = [];
  try {
    existingTracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  } catch (e) {
    console.log('⚠️  读取tracks.json失败，将创建新文件');
  }

  // 保留有效的netease歌曲
  const validExisting = existingTracks.filter(t => 
    t.id && t.id.startsWith('netease:') && t.audioUrl && t.playable !== false
  );
  console.log(`📁 现有有效歌曲: ${validExisting.length} 首`);

  // 2. 从API获取数据库中的歌曲
  let dbSongs = [];
  try {
    const response = await httpGet(`${API_BASE}/songs?limit=100`);
    if (response.success && response.data && response.data.songs) {
      dbSongs = response.data.songs;
    }
  } catch (e) {
    console.error('❌ 获取API数据失败:', e.message);
    console.log('💡 请确保API服务器已启动 (npm run dev in server/)');
    process.exit(1);
  }

  console.log(`🎵 数据库歌曲总数: ${dbSongs.length} 首`);

  // 3. 筛选netease平台的歌曲
  const neteaseSongs = dbSongs.filter(s => s.platform === 'netease');
  console.log(`🎵 网易云歌曲: ${neteaseSongs.length} 首`);

  // 4. 转换为tracks.json格式
  const dbTracks = neteaseSongs.map(song => ({
    id: song.id,
    platform: song.platform,
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    albumCover: song.albumCover || '',
    lyricContent: song.lyricContent || '',
    audioUrl: song.audioUrl || '',
    playable: song.playable !== false,
    coverColor: song.coverColor || generateColor(song.title),
  }));

  // 5. 合并歌曲（去重）
  const existingIds = new Set(validExisting.map(t => t.id));
  const newTracks = dbTracks.filter(t => !existingIds.has(t.id));
  
  // 合并：保留原有的有效歌曲 + 数据库中的新歌曲
  const mergedTracks = [...validExisting, ...newTracks];

  // 6. 如果总数不足20首，添加qq平台歌曲作为补充
  let finalTracks = mergedTracks;
  if (mergedTracks.length < 20) {
    const qqSongs = dbSongs.filter(s => 
      s.platform === 'qq' && !mergedTracks.some(t => t.id === s.id)
    );
    const qqTracks = qqSongs.slice(0, 20 - mergedTracks.length).map(song => ({
      id: song.id,
      platform: song.platform,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      albumCover: song.albumCover || '',
      audioUrl: song.audioUrl || '',
      playable: song.playable !== false,
      coverColor: song.coverColor || generateColor(song.title),
    }));
    finalTracks = [...mergedTracks, ...qqTracks];
  }

  // 7. 写入文件
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(finalTracks, null, 2), 'utf8');

  console.log('\n✅ 同步完成!');
  console.log(`   - 保留原有歌曲: ${validExisting.length} 首`);
  console.log(`   - 新增数据库歌曲: ${newTracks.length} 首`);
  console.log(`   - 总计歌曲: ${finalTracks.length} 首`);
  
  // 8. 显示平台分布
  const platformCounts = {};
  finalTracks.forEach(t => {
    platformCounts[t.platform] = (platformCounts[t.platform] || 0) + 1;
  });
  console.log('\n📊 平台分布:');
  Object.entries(platformCounts).forEach(([platform, count]) => {
    console.log(`   - ${platform}: ${count} 首`);
  });
}

// 生成随机颜色
function generateColor(title) {
  const colors = ['#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#3B82F6', '#14B8A6', '#6366F1'];
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

syncTracks().catch(err => {
  console.error('❌ 同步失败:', err);
  process.exit(1);
});
