import { useCallback, useEffect, useMemo } from 'react';
import { Track, PlayMode } from '@/types';
import { tracks as defaultTracks } from '@/data/tracks';
import { useStorage } from './useStorage';

const PLAY_MODE_ORDER: PlayMode[] = ['sequential', 'listLoop', 'singleLoop', 'shuffle'];

// 播放列表最少歌曲数量要求
export const MIN_PLAYLIST_SIZE = 20;

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

function shuffleIndex(len: number, exclude: number): number {
  if (len <= 1) return 0;
  let next = Math.floor(Math.random() * len);
  while (next === exclude) next = Math.floor(Math.random() * len);
  return next;
}

export function usePlaylist(extraTracks: Track[] = []) {
  const [playMode, setPlayMode] = useStorage<PlayMode>('mb_play_mode', 'listLoop');
  const [favoriteIds, setFavoriteIds] = useStorage<string[]>('mb_favorites', []);
  const [recentIds, setRecentIds] = useStorage<string[]>('mb_recent', []);

  // 合并本地曲库与额外歌曲（搜索结果、分类歌单API返回的）
  const playlist: Track[] = useMemo(() => [...defaultTracks, ...extraTracks], [extraTracks]);
  const [index, setIndex] = useStorage<number>('mb_current_index', 0);

  // 检查播放列表是否满足最少歌曲要求
  const canPlay = playlist.length > 0; // 有歌曲即可播放
  const playlistWarning = playlist.length < MIN_PLAYLIST_SIZE
    ? `播放列表歌曲数量较少（当前${playlist.length}首，建议${MIN_PLAYLIST_SIZE}首以上），部分功能可能受限`
    : null;

  const currentTrack: Track | undefined = useMemo(() => {
    if (playlist.length === 0 || !canPlay) return undefined;
    const i = Math.min(index, playlist.length - 1);
    return playlist[i];
  }, [playlist, index, canPlay]);

  const next = useCallback((): Track | undefined => {
    if (playlist.length === 0 || !canPlay) return undefined;
    let nextIdx = index;
    if (playMode === 'singleLoop') {
      nextIdx = index;
    } else if (playMode === 'shuffle') {
      nextIdx = shuffleIndex(playlist.length, index);
    } else if (playMode === 'sequential') {
      nextIdx = index + 1;
      if (nextIdx >= playlist.length) return undefined;
    } else {
      nextIdx = (index + 1) % playlist.length;
    }
    setIndex(nextIdx);
    return playlist[nextIdx];
  }, [playlist, index, playMode, setIndex, canPlay]);

  /** 预览下一首但不修改播放状态（用于预加载，不会触发 currentTrack 变化） */
  const peekNext = useCallback((): Track | undefined => {
    if (playlist.length === 0 || !canPlay) return undefined;
    let nextIdx = index;
    if (playMode === 'singleLoop') {
      nextIdx = index;
    } else if (playMode === 'shuffle') {
      nextIdx = shuffleIndex(playlist.length, index);
    } else if (playMode === 'sequential') {
      nextIdx = index + 1;
      if (nextIdx >= playlist.length) return undefined;
    } else {
      nextIdx = (index + 1) % playlist.length;
    }
    return playlist[nextIdx];
  }, [playlist, index, playMode, canPlay]);

  const prev = useCallback((): Track | undefined => {
    if (playlist.length === 0 || !canPlay) return undefined;
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
  }, [playlist, index, playMode, setIndex, canPlay]);

  const select = useCallback((trackId: string) => {
    if (!canPlay) return undefined;
    const i = playlist.findIndex(t => t.id === trackId);
    if (i >= 0) setIndex(i);
    return i >= 0 ? playlist[i] : undefined;
  }, [playlist, setIndex, canPlay]);

  const togglePlayMode = useCallback(() => {
    const cur = PLAY_MODE_ORDER.indexOf(playMode);
    const nxt = PLAY_MODE_ORDER[(cur + 1) % PLAY_MODE_ORDER.length];
    setPlayMode(nxt);
  }, [playMode, setPlayMode]);

  const isFavorite = useCallback((trackId: string) => favoriteIds.includes(trackId), [favoriteIds]);
  const toggleFavorite = useCallback((trackId: string) => {
    const exists = favoriteIds.includes(trackId);
    const nextList = exists
      ? favoriteIds.filter(id => id !== trackId)
      : [trackId, ...favoriteIds];
    setFavoriteIds(nextList);
    return !exists;
  }, [favoriteIds, setFavoriteIds]);

  const addToRecent = useCallback((trackId: string) => {
    setRecentIds(prev => [trackId, ...prev.filter(id => id !== trackId)].slice(0, 50));
  }, [setRecentIds]);

  const favorites = useMemo(() =>
    favoriteIds.map(id => playlist.find(t => t.id === id)).filter(Boolean) as Track[],
    [favoriteIds, playlist]);

  const recentTracks = useMemo(() =>
    recentIds.map(id => playlist.find(t => t.id === id)).filter(Boolean) as Track[],
    [recentIds, playlist]);

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
    canPlay,
    playlistWarning,
    minPlaylistSize: MIN_PLAYLIST_SIZE,
    next,
    peekNext,
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
