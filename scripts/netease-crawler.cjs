/**
 * 网易云音乐爬虫 - 获取真实可播放歌曲
 * 
 * 功能：
 * 1. 从网易云搜索API获取歌曲列表
 * 2. 获取每首歌曲的真实播放URL
 * 3. 验证URL有效性
 * 4. 保存到数据库和tracks.json
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TRACKS_FILE = path.resolve(__dirname, '..', 'shared', 'tracks.json');
const API_BASE = 'http://localhost:3000/api';

// 热门搜索关键词列表
const SEARCH_KEYWORDS = [
  '周杰伦', '林俊杰', '陈奕迅', '薛之谦', '李荣浩',
  '邓紫棋', '毛不易', '华晨宇', '张学友', '刘德华',
  '王菲', '那英', '汪峰', '许嵩', '徐佳莹',
  '田馥甄', '五月天', '苏打绿', '周深', '李健'
];

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

// HTTP POST 请求
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON解析失败: ${body.substring(0, 100)}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// HEAD 请求验证URL
function headCheck(url, timeout = 6000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method: 'HEAD', headers: NETEASE_HEADERS, timeout }, (res) => {
      const size = parseInt(res.headers['content-length'] || '0', 10);
      resolve({ valid: res.statusCode === 200 && size > 1024 * 512, sizeBytes: size, status: res.statusCode || 0 });
      res.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve({ valid: false, sizeBytes: 0, status: 0 }); });
    req.on('error', () => resolve({ valid: false, sizeBytes: 0, status: 0 }));
    req.end();
  });
}

// 搜索网易云歌曲
async function searchNeteaseSongs(keyword, limit = 30) {
  try {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=0`;
    const text = await httpsGet(url);
    const json = JSON.parse(text);
    
    if (json.code !== 200 || !json.result || !json.result.songs) {
      console.log(`  ⚠️ 搜索 "${keyword}" 无结果`);
      return [];
    }

    return json.result.songs.map(song => ({
      id: song.id.toString(),
      title: song.name,
      artist: song.artists.map(a => a.name).join(', '),
      album: song.album.name,
      albumCover: song.album.picUrl ? `${song.album.picUrl}?param=300y300` : '',
      duration: song.duration,
    }));
  } catch (err) {
    console.log(`  ❌ 搜索 "${keyword}" 失败: ${err.message}`);
    return [];
  }
}

// 获取歌曲播放URL
async function getSongUrl(songId) {
  // 尝试多个码率
  for (const br of [128000, 192000, 320000]) {
    try {
      const url = `https://music.163.com/api/song/enhance/player/url?ids=[${songId}]&br=${br}`;
      const text = await httpsGet(url);
      const json = JSON.parse(text);
      const data = json.data && json.data[0];
      
      if (data && data.url && data.size > 1024 * 512) {
        return { url: data.url, size: data.size, br: br };
      }
    } catch (err) {
      // 继续尝试下一码率
    }
  }
  return null;
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 生成随机颜色
function generateColor(title) {
  const colors = ['#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#3B82F6', '#14B8A6', '#6366F1'];
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// 主函数
async function main() {
  console.log('🕷️  网易云音乐爬虫启动\n');
  console.log('目标: 获取50首可播放歌曲\n');

  // 读取现有tracks
  let existingTracks = [];
  try {
    existingTracks = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  } catch (e) {
    existingTracks = [];
  }
  console.log(`📁 现有歌曲: ${existingTracks.length} 首`);

  const existingIds = new Set(existingTracks.map(t => t.id));
  const targetCount = 50;
  const newSongs = [];
  let keywordIndex = 0;

  console.log('\n📡 开始爬取歌曲...\n');

  while (newSongs.length < targetCount && keywordIndex < SEARCH_KEYWORDS.length) {
    const keyword = SEARCH_KEYWORDS[keywordIndex];
    console.log(`[${keywordIndex + 1}/${SEARCH_KEYWORDS.length}] 搜索: ${keyword}`);

    // 搜索歌曲
    const songs = await searchNeteaseSongs(keyword, 15);
    console.log(`  找到 ${songs.length} 首歌曲`);

    // 处理每首歌曲
    for (const song of songs) {
      if (newSongs.length >= targetCount) break;

      const trackId = `netease:${song.id}`;
      
      // 跳过已存在的歌曲
      if (existingIds.has(trackId)) {
        console.log(`  ⏭️  跳过已存在: ${song.title}`);
        continue;
      }

      // 获取播放URL
      console.log(`  🔍 获取URL: ${song.title}...`);
      const urlInfo = await getSongUrl(song.id);

      if (urlInfo) {
        // 验证URL有效性
        const check = await headCheck(urlInfo.url, 5000);
        
        if (check.valid) {
          const track = {
            id: trackId,
            platform: 'netease',
            title: song.title,
            artist: song.artist,
            album: song.album,
            albumCover: song.albumCover,
            audioUrl: urlInfo.url,
            playable: true,
            coverColor: generateColor(song.title),
            duration: song.duration,
          };

          newSongs.push(track);
          existingIds.add(trackId);
          console.log(`  ✅ [${newSongs.length}/${targetCount}] ${song.title} - ${song.artist} (${Math.round(check.sizeBytes / 1024)}KB)`);
        } else {
          console.log(`  ❌ URL验证失败: ${song.title} (status=${check.status})`);
        }
      } else {
        console.log(`  ❌ 无法获取URL: ${song.title}`);
      }

      // 添加延迟避免请求过快
      await delay(300);
    }

    keywordIndex++;
    await delay(500);
  }

  // 合并歌曲
  const allTracks = [...existingTracks, ...newSongs];

  // 保存到tracks.json
  fs.writeFileSync(TRACKS_FILE, JSON.stringify(allTracks, null, 2), 'utf8');

  // 保存到数据库
  console.log('\n💾 保存到数据库...');
  let dbSaved = 0;
  for (const song of newSongs) {
    try {
      await httpPost(`${API_BASE}/songs`, {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        albumCover: song.albumCover,
        audioUrl: song.audioUrl,
        platform: song.platform,
        playable: true,
      });
      dbSaved++;
    } catch (err) {
      console.log(`  ❌ 保存失败: ${song.title} - ${err.message}`);
    }
  }

  // 输出统计
  console.log('\n' + '='.repeat(50));
  console.log('📊 爬取统计');
  console.log('='.repeat(50));
  console.log(`✅ 新增歌曲: ${newSongs.length} 首`);
  console.log(`💾 数据库保存: ${dbSaved} 首`);
  console.log(`📁 总歌曲数: ${allTracks.length} 首`);
  console.log(`🎯 达标状态: ${allTracks.length >= 50 ? '✅ 已达标' : '❌ 未达标'}`);

  if (newSongs.length > 0) {
    console.log('\n🎵 新增歌曲列表:');
    newSongs.slice(0, 10).forEach((song, i) => {
      console.log(`  ${i + 1}. ${song.title} - ${song.artist}`);
    });
    if (newSongs.length > 10) {
      console.log(`  ... 还有 ${newSongs.length - 10} 首`);
    }
  }
}

main().catch(err => {
  console.error('❌ 爬取失败:', err);
  process.exit(1);
});
