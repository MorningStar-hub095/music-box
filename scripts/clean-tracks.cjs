/**
 * 清理tracks.json中的假歌曲数据
 * 只保留真实的、有有效URL的歌曲
 */

const fs = require('fs');
const path = require('path');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');

// 读取现有tracks.json
const tracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));

console.log(`📊 清理前: ${tracks.length} 首歌曲`);

// 过滤条件：
// 1. 排除mock歌曲
// 2. 排除example.com的假URL
// 3. 排除generated歌曲
// 4. 只保留有真实音频URL的歌曲
const validTracks = tracks.filter(track => {
  // 排除mock歌曲
  if (track.id && track.id.includes('mock_')) {
    return false;
  }
  
  // 排除generated歌曲
  if (track.id && track.id.startsWith('generated:')) {
    return false;
  }
  
  // 排除example.com的假URL
  if (track.audioUrl && track.audioUrl.includes('example.com')) {
    return false;
  }
  
  // 排除没有audioUrl的歌曲
  if (!track.audioUrl || track.audioUrl.trim() === '') {
    return false;
  }
  
  // 只保留netease平台的歌曲（可以被audio-refresher刷新）
  if (track.platform !== 'netease') {
    return false;
  }
  
  return true;
});

console.log(`✅ 清理后: ${validTracks.length} 首有效歌曲`);
console.log(`❌ 移除假歌曲: ${tracks.length - validTracks.length} 首`);

// 显示保留的歌曲
console.log('\n🎵 保留的歌曲:');
validTracks.slice(0, 10).forEach((track, i) => {
  console.log(`  ${i + 1}. ${track.title} - ${track.artist} (${track.platform})`);
});
if (validTracks.length > 10) {
  console.log(`  ... 还有 ${validTracks.length - 10} 首`);
}

// 写入清理后的数据
fs.writeFileSync(TRACKS_FILE, JSON.stringify(validTracks, null, 2), 'utf8');

console.log('\n✅ tracks.json 已更新');

// 检查是否满足20首要求
if (validTracks.length < 20) {
  console.log('\n⚠️  警告: 歌曲数量不足20首，可能影响播放功能');
  console.log('💡 建议: 运行爬虫添加更多歌曲');
} else {
  console.log(`\n✅ 满足播放要求 (${validTracks.length} >= 20)`);
}
