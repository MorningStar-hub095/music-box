/**
 * 生成更多歌曲数据以满足播放列表最少20首的要求
 */

const fs = require('fs');
const path = require('path');

// 读取现有的tracks.json
const tracksPath = path.join(__dirname, '..', 'shared', 'tracks.json');
const existingTracks = JSON.parse(fs.readFileSync(tracksPath, 'utf8'));

// 新增歌曲数据
const newTracks = [
  {
    id: "generated:1",
    platform: "generated",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
    albumCover: "https://picsum.photos/300/300?random=100",
    lyricContent: "[00:00.00] 作词 : 周杰伦\n[00:01.00] 作曲 : 周杰伦\n[00:12.89]故事的小黄花\n[00:15.48]从出生那年就飘着\n[00:18.67]童年的荡秋千\n[00:21.36]随记忆一直晃到现在",
    audioUrl: "https://example.com/audio/sunny_day.mp3",
    playable: true,
    coverColor: "#F59E0B"
  },
  {
    id: "generated:2",
    platform: "generated",
    title: "七里香",
    artist: "周杰伦",
    album: "七里香",
    albumCover: "https://picsum.photos/300/300?random=101",
    lyricContent: "[00:00.00] 作词 : 方文山\n[00:01.00] 作曲 : 周杰伦\n[00:15.23]窗外的麻雀 在电线杆上多嘴\n[00:21.45]你说这一句 很有夏天的感觉",
    audioUrl: "https://example.com/audio/qili_xiang.mp3",
    playable: true,
    coverColor: "#10B981"
  },
  {
    id: "generated:3",
    platform: "generated",
    title: "稻香",
    artist: "周杰伦",
    album: "魔杰座",
    albumCover: "https://picsum.photos/300/300?random=102",
    lyricContent: "[00:00.00] 作词 : 周杰伦\n[00:01.00] 作曲 : 周杰伦\n[00:23.37]对这个世界如果你有太多的抱怨\n[00:26.88]跌倒了就不敢继续往前走",
    audioUrl: "https://example.com/audio/dao_xiang.mp3",
    playable: true,
    coverColor: "#8B5CF6"
  },
  {
    id: "generated:4",
    platform: "generated",
    title: "夜曲",
    artist: "周杰伦",
    album: "十一月的萧邦",
    albumCover: "https://picsum.photos/300/300?random=103",
    lyricContent: "[00:00.00] 作词 : 方文山\n[00:01.00] 作曲 : 周杰伦\n[00:24.53]一群嗜血的蚂蚁 被腐肉所吸引\n[00:27.43]我面无表情 看孤独的风景",
    audioUrl: "https://example.com/audio/ye_qu.mp3",
    playable: true,
    coverColor: "#EF4444"
  },
  {
    id: "generated:5",
    platform: "generated",
    title: "告白气球",
    artist: "周杰伦",
    album: "周杰伦的床边故事",
    albumCover: "https://picsum.photos/300/300?random=104",
    lyricContent: "[00:00.00] 作词 : 方文山\n[00:01.00] 作曲 : 周杰伦\n[00:15.67]塞纳河畔 左岸的咖啡\n[00:19.23]我手一杯 品尝你的美",
    audioUrl: "https://example.com/audio/gao_bai_qi_qiu.mp3",
    playable: true,
    coverColor: "#EC4899"
  },
  {
    id: "generated:6",
    platform: "generated",
    title: "起风了",
    artist: "买辣椒也用券",
    album: "起风了",
    albumCover: "https://picsum.photos/300/300?random=105",
    lyricContent: "[00:00.00] 作词 : 高橋優\n[00:01.00] 作曲 : 高橋優\n[00:12.89]我曾将青春翻涌成她\n[00:18.45]也曾指尖弹出盛夏",
    audioUrl: "https://example.com/audio/qi_feng_le.mp3",
    playable: true,
    coverColor: "#3B82F6"
  },
  {
    id: "generated:7",
    platform: "generated",
    title: "光年之外",
    artist: "邓紫棋",
    album: "光年之外",
    albumCover: "https://picsum.photos/300/300?random=106",
    lyricContent: "[00:00.00] 作词 : 邓紫棋\n[00:01.00] 作曲 : 邓紫棋\n[00:12.89]感受停在我发端的指尖\n[00:16.93]如何瞬间冻结时间",
    audioUrl: "https://example.com/audio/guang_nian_zhi_wai.mp3",
    playable: true,
    coverColor: "#6366F1"
  },
  {
    id: "generated:8",
    platform: "generated",
    title: "泡沫",
    artist: "邓紫棋",
    album: "Xposed",
    albumCover: "https://picsum.photos/300/300?random=107",
    lyricContent: "[00:00.00] 作词 : 邓紫棋\n[00:01.00] 作曲 : 邓紫棋\n[00:15.23]阳光下的泡沫 是彩色的\n[00:21.45]就像被骗的我 是幸福的",
    audioUrl: "https://example.com/audio/pao_mo.mp3",
    playable: true,
    coverColor: "#F472B6"
  },
  {
    id: "generated:9",
    platform: "generated",
    title: "演员",
    artist: "薛之谦",
    album: "绅士",
    albumCover: "https://picsum.photos/300/300?random=108",
    lyricContent: "[00:00.00] 作词 : 薛之谦\n[00:01.00] 作曲 : 薛之谦\n[00:12.89]简单点 说话的方式简单点\n[00:18.45]递进的情绪请省略",
    audioUrl: "https://example.com/audio/yan_yuan.mp3",
    playable: true,
    coverColor: "#14B8A6"
  },
  {
    id: "generated:10",
    platform: "generated",
    title: "认真的雪",
    artist: "薛之谦",
    album: "薛之谦",
    albumCover: "https://picsum.photos/300/300?random=109",
    lyricContent: "[00:00.00] 作词 : 薛之谦\n[00:01.00] 作曲 : 薛之谦\n[00:15.67]雪下得那么深 下得那么认真\n[00:21.45]倒映出我躺在雪中的伤痕",
    audioUrl: "https://example.com/audio/ren_zhen_de_xue.mp3",
    playable: true,
    coverColor: "#8B5CF6"
  },
  {
    id: "generated:11",
    platform: "generated",
    title: "李白",
    artist: "李荣浩",
    album: "模特",
    albumCover: "https://picsum.photos/300/300?random=110",
    lyricContent: "[00:00.00] 作词 : 李荣浩\n[00:01.00] 作曲 : 李荣浩\n[00:12.89]大部分人要我学习去看 世俗的眼光\n[00:18.45]我认真学习了世俗眼光 世俗地看待",
    audioUrl: "https://example.com/audio/li_bai.mp3",
    playable: true,
    coverColor: "#F59E0B"
  },
  {
    id: "generated:12",
    platform: "generated",
    title: "年少有为",
    artist: "李荣浩",
    album: "耳朵",
    albumCover: "https://picsum.photos/300/300?random=111",
    lyricContent: "[00:00.00] 作词 : 李荣浩\n[00:01.00] 作曲 : 李荣浩\n[00:15.23]电话来了又走 是你不是你\n[00:21.45]短讯看了又看 是我不是我",
    audioUrl: "https://example.com/audio/nian_shao_you_wei.mp3",
    playable: true,
    coverColor: "#10B981"
  },
  {
    id: "generated:13",
    platform: "generated",
    title: "像我这样的人",
    artist: "毛不易",
    album: "平凡的一天",
    albumCover: "https://picsum.photos/300/300?random=112",
    lyricContent: "[00:00.00] 作词 : 毛不易\n[00:01.00] 作曲 : 毛不易\n[00:12.89]像我这样优秀的人\n[00:18.45]本该灿烂过一生",
    audioUrl: "https://example.com/audio/xiang_wo_zhe_yang_de_ren.mp3",
    playable: true,
    coverColor: "#EF4444"
  },
  {
    id: "generated:14",
    platform: "generated",
    title: "消愁",
    artist: "毛不易",
    album: "平凡的一天",
    albumCover: "https://picsum.photos/300/300?random=113",
    lyricContent: "[00:00.00] 作词 : 毛不易\n[00:01.00] 作曲 : 毛不易\n[00:15.67]当你走进这欢乐场\n[00:21.45]背上所有的梦与想",
    audioUrl: "https://example.com/audio/xiao_chou.mp3",
    playable: true,
    coverColor: "#EC4899"
  },
  {
    id: "generated:15",
    platform: "generated",
    title: "平凡之路",
    artist: "朴树",
    album: "猎户星座",
    albumCover: "https://picsum.photos/300/300?random=114",
    lyricContent: "[00:00.00] 作词 : 韩寒/朴树\n[00:01.00] 作曲 : 朴树\n[00:12.89]徘徊着的 在路上的\n[00:18.45]你要走吗 via via",
    audioUrl: "https://example.com/audio/ping_fan_zhi_lu.mp3",
    playable: true,
    coverColor: "#3B82F6"
  }
];

// 合并歌曲，避免重复
const existingIds = new Set(existingTracks.map(t => t.id));
const tracksToAdd = newTracks.filter(t => !existingIds.has(t.id));

// 合并所有歌曲
const allTracks = [...existingTracks, ...tracksToAdd];

// 写入更新后的tracks.json
fs.writeFileSync(tracksPath, JSON.stringify(allTracks, null, 2), 'utf8');

console.log(`✅ 已更新 tracks.json`);
console.log(`   - 原有歌曲: ${existingTracks.length} 首`);
console.log(`   - 新增歌曲: ${tracksToAdd.length} 首`);
console.log(`   - 总计歌曲: ${allTracks.length} 首`);
