// src/data/tracks-builtin.ts
// 【2026-11-25 隐私合规重构】原文件由 tools/gen_miniapp_builtin_tracks.py 从
// shared/tracks.json（爬取曲库）生成，含第三方曲目元数据与已过期网易云临时直链，
// 属版权敏感内容，不能随公开仓库发布。
// 现改为内置 12 首"自有曲库"演示数据（与 server/scripts/seed-demo.js 的 seed:demo
// 同源：无真实歌词、无第三方直链），接口结构不变（export const builtinTracks: Track[]）。
// 本地如需恢复原兜底集：python tools/gen_miniapp_builtin_tracks.py（生成结果仅本地保留）
// 长期方案见 fetchTracksFromApi()（改走 /api/songs 接口）。
import { Track } from '@/types';

export const builtinTracks: Track[] = [
  { id: 'demo-01', title: '晨光漫步', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-01-morning-walk.mp3', lyricContent: '', coverColor: '#17C3B2', platform: 'library', playable: true, duration: 186 },
  { id: 'demo-02', title: '夜色温柔', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-02-gentle-night.mp3', lyricContent: '', coverColor: '#6C5CE7', platform: 'library', playable: true, duration: 214 },
  { id: 'demo-03', title: '雨后街道', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-03-after-rain.mp3', lyricContent: '', coverColor: '#0984E3', platform: 'library', playable: true, duration: 198 },
  { id: 'demo-04', title: '山间清风', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-04-mountain-breeze.mp3', lyricContent: '', coverColor: '#00B894', platform: 'library', playable: true, duration: 242 },
  { id: 'demo-05', title: '午夜电台', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-05-midnight-radio.mp3', lyricContent: '', coverColor: '#636E72', platform: 'library', playable: true, duration: 227 },
  { id: 'demo-06', title: '夏日冰饮', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-06-summer-soda.mp3', lyricContent: '', coverColor: '#FDCB6E', platform: 'library', playable: true, duration: 173 },
  { id: 'demo-07', title: '旧书页', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-07-old-pages.mp3', lyricContent: '', coverColor: '#E17055', platform: 'library', playable: true, duration: 205 },
  { id: 'demo-08', title: '城市脉搏', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-08-city-pulse.mp3', lyricContent: '', coverColor: '#D63031', platform: 'library', playable: true, duration: 189 },
  { id: 'demo-09', title: '云端漫游', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-09-cloud-drift.mp3', lyricContent: '', coverColor: '#74B9FF', platform: 'library', playable: true, duration: 231 },
  { id: 'demo-10', title: '篝火旁', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-10-campfire.mp3', lyricContent: '', coverColor: '#E58E26', platform: 'library', playable: true, duration: 258 },
  { id: 'demo-11', title: '极简练习曲', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-11-minimal-etude.mp3', lyricContent: '', coverColor: '#A29BFE', platform: 'library', playable: true, duration: 264 },
  { id: 'demo-12', title: '归途', artist: 'Demo 曲库', album: 'Music Box 自有曲库', audioUrl: '/api/library/audio/demo-12-way-home.mp3', lyricContent: '', coverColor: '#55EFC4', platform: 'library', playable: true, duration: 209 },
];
