/**
 * 修复缺失歌词的歌曲
 * 为所有没有歌词的歌曲获取歌词
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');

// 网易云API请求头
const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://music.163.com/',
  'Cookie': 'os=pc; osver=Microsoft-Windows-10-Professional-build-19045-64bit; appver=2.10.14; MUSIC_U=00C0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0; __remember_me=true; NMTID=00O0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0FFC0',
};

// HTTP GET 请求
function httpsGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: NETEASE_HEADERS, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, timeout).then(resolve, reject);
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// 获取歌词
async function getLyrics(songId) {
  try {
    const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&tv=1`;
    const text = await httpsGet(url);
    const json = JSON.parse(text);
    
    if (json.code === 200) {
      const lrc = json.lrc && json.lrc.lyric;
      return lrc || '';
    }
  } catch (err) {
    // 静默失败
  }
  return '';
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主函数
async function main() {
  console.log('🔧 修复缺失歌词的歌曲...\n');

  // 读取tracks.json
  let tracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  console.log(`📁 总歌曲数: ${tracks.length}`);

  // 找出没有歌词的歌曲
  const tracksWithoutLyrics = tracks.filter(t => !t.lyricContent || t.lyricContent.trim() === '');
  console.log(`❌ 缺失歌词歌曲: ${tracksWithoutLyrics.length} 首`);

  if (tracksWithoutLyrics.length === 0) {
    console.log('✅ 所有歌曲都有歌词');
    return;
  }

  // 为每首歌曲获取歌词
  let fixedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < tracksWithoutLyrics.length; i++) {
    const track = tracksWithoutLyrics[i];
    const songId = track.id.replace('netease:', '');
    
    console.log(`[${i + 1}/${tracksWithoutLyrics.length}] ${track.title} - ${track.artist}`);
    
    const lyrics = await getLyrics(songId);
    
    if (lyrics && lyrics.trim().length > 0) {
      // 更新tracks数组中的歌曲
      const index = tracks.findIndex(t => t.id === track.id);
      if (index !== -1) {
        tracks[index].lyricContent = lyrics;
        fixedCount++;
        console.log(`  ✅ 获取成功 (${lyrics.length} 字符)`);
      }
    } else {
      failedCount++;
      console.log(`  ❌ 无歌词`);
    }
    
    // 延迟避免请求过快
    await delay(200);
  }

  // 保存更新后的tracks.json
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(tracks, null, 2), 'utf8');

  console.log('\n' + '='.repeat(50));
  console.log('📊 修复统计');
  console.log('='.repeat(50));
  console.log(`✅ 成功获取歌词: ${fixedCount} 首`);
  console.log(`❌ 无歌词可用: ${failedCount} 首`);
  console.log(`📁 总歌曲数: ${tracks.length}`);
  
  // 统计有歌词的歌曲
  const withLyrics = tracks.filter(t => t.lyricContent && t.lyricContent.trim().length > 0);
  console.log(`📝 有歌词歌曲: ${withLyrics.length} 首`);
}

main().catch(err => {
  console.error('❌ 修复失败:', err);
  process.exit(1);
});
