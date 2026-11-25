import { Track } from '@/types';

// 【2026-11-25 隐私合规重构】
// 原实现直接 import shared/tracks.json（爬取曲库，含完整歌词与已过期第三方直链），
// 该数据属版权/隐私敏感内容，已从公开仓库排除，前端构建不能再依赖它。
// 现改为内置 12 首"自有曲库"演示数据（与 server/scripts/seed-demo.js 的 seed:demo
// 完全一致：无真实歌词、无第三方音频直链），核心逻辑不变。
// 本地开发如需完整曲库：由服务端 API 提供（GET /api/songs），或运行 npm run seed:demo
// 后将音频放入 local-music/。

/** 演示曲库（与 server seed:demo 同源，12 首自有曲库元数据） */
const demoTracks: Track[] = [
  { id: 'demo-01', title: '晨光漫步', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-01-morning-walk.mp3', lyricContent: '', coverColor: '#17C3B2', album: 'Music Box 自有曲库', playable: true, duration: 186 },
  { id: 'demo-02', title: '夜色温柔', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-02-gentle-night.mp3', lyricContent: '', coverColor: '#6C5CE7', album: 'Music Box 自有曲库', playable: true, duration: 214 },
  { id: 'demo-03', title: '雨后街道', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-03-after-rain.mp3', lyricContent: '', coverColor: '#0984E3', album: 'Music Box 自有曲库', playable: true, duration: 198 },
  { id: 'demo-04', title: '山间清风', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-04-mountain-breeze.mp3', lyricContent: '', coverColor: '#00B894', album: 'Music Box 自有曲库', playable: true, duration: 242 },
  { id: 'demo-05', title: '午夜电台', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-05-midnight-radio.mp3', lyricContent: '', coverColor: '#636E72', album: 'Music Box 自有曲库', playable: true, duration: 227 },
  { id: 'demo-06', title: '夏日冰饮', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-06-summer-soda.mp3', lyricContent: '', coverColor: '#FDCB6E', album: 'Music Box 自有曲库', playable: true, duration: 173 },
  { id: 'demo-07', title: '旧书页', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-07-old-pages.mp3', lyricContent: '', coverColor: '#E17055', album: 'Music Box 自有曲库', playable: true, duration: 205 },
  { id: 'demo-08', title: '城市脉搏', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-08-city-pulse.mp3', lyricContent: '', coverColor: '#D63031', album: 'Music Box 自有曲库', playable: true, duration: 189 },
  { id: 'demo-09', title: '云端漫游', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-09-cloud-drift.mp3', lyricContent: '', coverColor: '#74B9FF', album: 'Music Box 自有曲库', playable: true, duration: 231 },
  { id: 'demo-10', title: '篝火旁', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-10-campfire.mp3', lyricContent: '', coverColor: '#E58E26', album: 'Music Box 自有曲库', playable: true, duration: 258 },
  { id: 'demo-11', title: '极简练习曲', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-11-minimal-etude.mp3', lyricContent: '', coverColor: '#A29BFE', album: 'Music Box 自有曲库', playable: true, duration: 264 },
  { id: 'demo-12', title: '归途', artist: 'Demo 曲库', audioUrl: '/api/library/audio/demo-12-way-home.mp3', lyricContent: '', coverColor: '#55EFC4', album: 'Music Box 自有曲库', playable: true, duration: 209 },
];

export const tracks: Track[] = demoTracks;

/* ===== 旧实现（保留注释以便回滚；依赖仓库外的 shared/tracks.json，不能公开发布）=====
import { Track } from '@/types';
// 从共享 JSON 数据库导入（由 tools/netease_crawler.py export 生成）
import sharedTracks from '../../../shared/tracks.json';

export const tracks: Track[] = sharedTracks.map((t: any) => ({
  id: t.id,
  title: t.title,
  artist: t.artist,
  audioUrl: t.audioUrl,
  lyricContent: t.lyricContent,
  coverColor: t.coverColor,
  albumCover: t.albumCover,
  album: t.album,
  platform: t.platform,
  playable: t.playable,
  duration: t.duration,
})).filter(t => t.audioUrl && t.playable !== false);
===== 旧实现结束 ===== */
