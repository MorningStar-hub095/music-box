// src/data/tracks.ts
// 曲库数据源：内置兜底集（50 首）+ 可选的服务端曲库加载
// 完整曲库不再打包进主包（微信主包限 2MB，且内置的网易云直链会过期）

import Taro from '@tarojs/taro';
import { Track } from '@/types';
import { builtinTracks } from './tracks-builtin';

/** 当前生效的播放列表（默认内置兜底集） */
export const tracks: Track[] = builtinTracks;

/**
 * 【长期方案占位】从服务端拉取完整曲库并替换内置兜底集。
 *
 * 接入步骤（部署到正式域名后）：
 * 1. 服务端确认 GET /api/songs?page=1&pageSize=500 返回 Track[] 兼容结构
 * 2. 在微信公众平台配置 downloadFile/request 合法域名（https）
 * 3. 在 app.tsx 启动时调用：fetchTracksFromApi('https://your-domain.com')
 *    成功后用返回值替换各页面的 playlist 数据源（需将 usePlaylist 的
 *    defaultTracks 改为响应式状态），失败静默保留内置兜底集
 *
 * @param baseUrl 服务端根地址，如 https://your-domain.com（必须 https）
 * @returns 成功返回曲目数组；网络失败/结构不符返回 null（调用方应保留兜底数据）
 */
export async function fetchTracksFromApi(baseUrl: string): Promise<Track[] | null> {
  try {
    const res = await Taro.request({
      url: `${baseUrl.replace(/\/+$/, '')}/api/songs?page=1&pageSize=500`,
      method: 'GET',
      timeout: 8000,
    });
    const payload = res.data as { success?: boolean; data?: { items?: any[] } | any[] };
    const items = Array.isArray(payload?.data) ? payload.data : payload?.data?.items;
    if (!Array.isArray(items) || items.length === 0) return null;
    const mapped: Track[] = items
      .filter((t: any) => t?.audioUrl && t?.playable !== false)
      .map((t: any) => ({
        id: String(t.id),
        title: t.title ?? '未知曲目',
        artist: t.artist ?? '未知歌手',
        audioUrl: t.audioUrl,
        lyricContent: t.lyricContent,
        coverColor: t.coverColor,
        albumCover: t.albumCover,
        album: t.album,
        platform: t.platform,
        playable: true,
      }));
    return mapped.length > 0 ? mapped : null;
  } catch (e) {
    console.warn('[tracks] 服务端曲库加载失败，使用内置兜底集:', e);
    return null;
  }
}
