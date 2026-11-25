// src/hooks/usePlaylist.ts
// 播放列表管理 Hook：当前曲目/索引、播放模式、收藏、最近播放
import { useCallback, useEffect, useMemo } from 'react';
import { Track, PlayMode } from '@/types';
import { tracks as defaultTracks } from '@/data/tracks';
import { useStorage } from './useStorage';

const PLAY_MODE_ORDER: PlayMode[] = ['sequential', 'listLoop', 'singleLoop', 'shuffle'];

export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  sequential: '顺序播放',
  listLoop: '列表循环',
  singleLoop: '单曲循环',
  shuffle: '随机播放'
};

export const PLAY_MODE_ICON: Record<PlayMode, string> = {
  sequential: '→',
  listLoop: '↻',
  singleLoop: '⟳',
  shuffle: '⤮'
};

// Fisher-Yates 洗牌
function shuffleIndex(len: number, exclude: number): number {
  if (len <= 1) return 0;
  let next = Math.floor(Math.random() * len);
  while (next === exclude) next = Math.floor(Math.random() * len);
  return next;
}

export function usePlaylist() {
  // 持久化的播放模式与收藏列表、最近播放
  const [playMode, setPlayMode] = useStorage<PlayMode>('mb_play_mode', 'listLoop');
  const [favoriteIds, setFavoriteIds] = useStorage<string[]>('mb_favorites', []);
  const [recentIds, setRecentIds] = useStorage<string[]>('mb_recent', []);

  // 当前播放列表（基于内置曲目；可按收藏过滤）
  const playlist: Track[] = defaultTracks;

  const [index, setIndex] = useStorage<number>('mb_current_index', 0);

  const currentTrack: Track | undefined = useMemo(() => {
    if (playlist.length === 0) return undefined;
    const i = Math.min(index, playlist.length - 1);
    return playlist[i];
  }, [playlist, index]);

  // 切换到下一首（按播放模式）
  const next = useCallback((): Track | undefined => {
    if (playlist.length === 0) return undefined;
    let nextIdx = index;
    if (playMode === 'singleLoop') {
      nextIdx = index; // 单曲循环不变
    } else if (playMode === 'shuffle') {
      nextIdx = shuffleIndex(playlist.length, index);
    } else if (playMode === 'sequential') {
      nextIdx = index + 1;
      if (nextIdx >= playlist.length) return undefined; // 顺序播放结束
    } else {
      // listLoop
      nextIdx = (index + 1) % playlist.length;
    }
    setIndex(nextIdx);
    return playlist[nextIdx];
  }, [playlist, index, playMode, setIndex]);

  // 上一首
  const prev = useCallback((): Track | undefined => {
    if (playlist.length === 0) return undefined;
    let prevIdx: number;
    if (playMode === 'shuffle') {
      prevIdx = shuffleIndex(playlist.length, index);
    } else {
      prevIdx = index - 1;
      if (prevIdx < 0) {
        prevIdx = playMode === 'listLoop' ? playlist.length - 1 : 0;
      }
    }
    setIndex(prevIdx);
    return playlist[prevIdx];
  }, [playlist, index, playMode, setIndex]);

  // 选择指定曲目
  const select = useCallback((trackId: string) => {
    const i = playlist.findIndex(t => t.id === trackId);
    if (i >= 0) setIndex(i);
    return i >= 0 ? playlist[i] : undefined;
  }, [playlist, setIndex]);

  // 切换播放模式（顺序循环切换）
  const togglePlayMode = useCallback(() => {
    const cur = PLAY_MODE_ORDER.indexOf(playMode);
    const nxt = PLAY_MODE_ORDER[(cur + 1) % PLAY_MODE_ORDER.length];
    setPlayMode(nxt);
  }, [playMode, setPlayMode]);

  // 收藏切换
  const isFavorite = useCallback((trackId: string) => favoriteIds.includes(trackId), [favoriteIds]);
  const toggleFavorite = useCallback((trackId: string) => {
    const exists = favoriteIds.includes(trackId);
    const next = exists
      ? favoriteIds.filter(id => id !== trackId)
      : [trackId, ...favoriteIds];
    setFavoriteIds(next);
    return !exists;
  }, [favoriteIds, setFavoriteIds]);

  // 加入最近播放（去重，置顶，限制 50 条）
  const addToRecent = useCallback((trackId: string) => {
    const next = [trackId, ...recentIds.filter(id => id !== trackId)].slice(0, 50);
    setRecentIds(next);
  }, [recentIds, setRecentIds]);

  // 派生：收藏曲目列表与最近播放列表
  const favorites = useMemo(() =>
    favoriteIds.map(id => playlist.find(t => t.id === id)).filter(Boolean) as Track[],
    [favoriteIds, playlist]);

  const recentTracks = useMemo(() =>
    recentIds.map(id => playlist.find(t => t.id === id)).filter(Boolean) as Track[],
    [recentIds, playlist]);

  // 当索引越界时自动修正
  useEffect(() => {
    if (playlist.length > 0 && index >= playlist.length) {
      setIndex(0);
    }
  }, [playlist.length, index, setIndex]);

  return {
    playlist,
    currentTrack,
    currentIndex: index,
    playMode,
    next,
    prev,
    select,
    togglePlayMode,
    isFavorite,
    toggleFavorite,
    addToRecent,
    favorites,
    recentTracks
  };
}
